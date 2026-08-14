const crypto = require('crypto');
const pool = require('../config/db');
const { sanitizeAndAnonymizePrompt } = require('./prompt.service');
const { NotFoundError, InsufficientCreditsError, ConflictError, BadRequestError } = require('../errors/AppError');

const GENESIS_HASH = '0'.repeat(64);

class LedgerService {
  /**
   * Helper: Computes SHA-256 cryptographic hash for a ledger entry.
   */
  _calculateHash({ prevHash, userId, jobId, entryType, amount, balanceAfter, reservedAfter, createdAt }) {
    const payload = [
      prevHash,
      userId,
      jobId || '',
      entryType,
      amount.toString(),
      balanceAfter.toString(),
      reservedAfter.toString(),
      new Date(createdAt).toISOString()
    ].join('|');

    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Helper: Encodes cursor from createdAt and id.
   */
  _encodeCursor(createdAt, id) {
    const payload = JSON.stringify({ createdAt: new Date(createdAt).toISOString(), id });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }

  /**
   * Helper: Decodes base64url cursor.
   */
  _decodeCursor(cursorStr) {
    try {
      const decoded = Buffer.from(cursorStr, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (!parsed.createdAt || !parsed.id) {
        throw new Error('Invalid cursor payload structure');
      }
      return {
        createdAt: new Date(parsed.createdAt).toISOString(),
        id: parsed.id
      };
    } catch {
      throw new BadRequestError('Invalid pagination cursor');
    }
  }

  /**
   * Helper: Inserts an immutable log entry with continuous hash chaining.
   */
  async _recordLedgerEntry(client, { userId, jobId = null, entryType, amount, balanceAfter, reservedAfter }) {
    const latestEntryRes = await client.query(
      `SELECT hash FROM ledger_entries 
       WHERE user_id = $1 
       ORDER BY created_at DESC, id DESC 
       LIMIT 1 FOR UPDATE`,
      [userId]
    );

    const prevHash = latestEntryRes.rows.length > 0 
      ? latestEntryRes.rows[0].hash 
      : GENESIS_HASH;

    const createdAt = new Date();

    const hash = this._calculateHash({
      prevHash,
      userId,
      jobId,
      entryType,
      amount,
      balanceAfter,
      reservedAfter,
      createdAt
    });

    await client.query(
      `INSERT INTO ledger_entries (
        user_id, job_id, entry_type, amount, balance_after, reserved_after, prev_hash, hash, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        jobId,
        entryType,
        amount.toString(),
        balanceAfter.toString(),
        reservedAfter.toString(),
        prevHash,
        hash,
        createdAt
      ]
    );
  }

  /**
   * Module B5: Keyset cursor-paginated movement history & daily aggregate totals.
   */
  async getUserMovementHistory(userId, options = {}) {
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 20, 1), 100);
    const { cursor } = options;

    // 1. Verify user exists
    const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userRes.rowCount === 0) {
      throw new NotFoundError('User not found');
    }

    // 2. Build keyset query
    let query;
    let queryParams;

    if (cursor) {
      const decoded = this._decodeCursor(cursor);
      query = `
        SELECT 
          id,
          job_id AS "jobId",
          entry_type AS "entryType",
          amount,
          balance_after AS "balanceAfter",
          reserved_after AS "reservedAfter",
          hash,
          prev_hash AS "prevHash",
          created_at AS "createdAt"
        FROM ledger_entries
        WHERE user_id = $1
          AND (created_at, id) < ($2::timestamptz, $3::uuid)
        ORDER BY created_at DESC, id DESC
        LIMIT $4
      `;
      queryParams = [userId, decoded.createdAt, decoded.id, limit + 1];
    } else {
      query = `
        SELECT 
          id,
          job_id AS "jobId",
          entry_type AS "entryType",
          amount,
          balance_after AS "balanceAfter",
          reserved_after AS "reservedAfter",
          hash,
          prev_hash AS "prevHash",
          created_at AS "createdAt"
        FROM ledger_entries
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `;
      queryParams = [userId, limit + 1];
    }

    const [entriesRes, dailyTotalsRes] = await Promise.all([
      pool.query(query, queryParams),
      pool.query(
        `SELECT 
          DATE(created_at AT TIME ZONE 'UTC')::text AS date,
          COUNT(*)::int AS "totalEntries",
          COALESCE(SUM(CASE WHEN entry_type = 'TOPUP' THEN amount ELSE 0 END), 0)::text AS "totalTopUp",
          COALESCE(SUM(CASE WHEN entry_type = 'RESERVE' THEN amount ELSE 0 END), 0)::text AS "totalReserved",
          COALESCE(SUM(CASE WHEN entry_type = 'COMMIT' THEN amount ELSE 0 END), 0)::text AS "totalCommitted",
          COALESCE(SUM(CASE WHEN entry_type = 'RELEASE' THEN amount ELSE 0 END), 0)::text AS "totalReleased"
        FROM ledger_entries
        WHERE user_id = $1
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY date DESC
        LIMIT 30`,
        [userId]
      )
    ]);

    const hasNextPage = entriesRes.rows.length > limit;
    const items = hasNextPage ? entriesRes.rows.slice(0, limit) : entriesRes.rows;

    let nextCursor = null;
    if (hasNextPage && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = this._encodeCursor(lastItem.createdAt, lastItem.id);
    }

    return {
      userId,
      items,
      pagination: {
        limit,
        hasNextPage,
        nextCursor
      },
      dailyTotals: dailyTotalsRes.rows
    };
  }

  /**
   * Sweep and release abandoned reservations safely in batches (Module B2).
   */
  async releaseAbandonedReservations(batchSize = 100) {
    const client = await pool.connect();
    const releasedJobIds = [];

    try {
      await client.query('BEGIN');

      const fetchQuery = `
        SELECT id, user_id AS "userId", cost 
        FROM jobs 
        WHERE status = 'RESERVED' 
          AND expires_at <= NOW() 
        ORDER BY expires_at ASC 
        LIMIT $1 
        FOR UPDATE SKIP LOCKED
      `;
      const expiredJobsRes = await client.query(fetchQuery, [batchSize]);

      if (expiredJobsRes.rowCount === 0) {
        await client.query('COMMIT');
        return { processedCount: 0, releasedJobIds: [] };
      }

      for (const job of expiredJobsRes.rows) {
        await client.query(
          "UPDATE jobs SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1",
          [job.id]
        );

        const userRes = await client.query(
          `UPDATE users 
           SET reserved = reserved - $1 
           WHERE id = $2 
           RETURNING balance, reserved`,
          [job.cost, job.userId]
        );

        const balanceAfter = BigInt(userRes.rows[0].balance);
        const reservedAfter = BigInt(userRes.rows[0].reserved);

        await this._recordLedgerEntry(client, {
          userId: job.userId,
          jobId: job.id,
          entryType: 'RELEASE',
          amount: job.cost,
          balanceAfter,
          reservedAfter
        });

        releasedJobIds.push(job.id);
      }

      await client.query('COMMIT');
      return { processedCount: releasedJobIds.length, releasedJobIds };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Top up user balance and record ledger entry.
   */
  async topUpUser(userId, amount) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `UPDATE users 
         SET balance = balance + $1 
         WHERE id = $2 
         RETURNING balance, reserved`,
        [amount, userId]
      );

      if (userRes.rowCount === 0) {
        throw new NotFoundError('User not found');
      }

      const balanceAfter = BigInt(userRes.rows[0].balance);
      const reservedAfter = BigInt(userRes.rows[0].reserved);

      await this._recordLedgerEntry(client, {
        userId,
        entryType: 'TOPUP',
        amount,
        balanceAfter,
        reservedAfter
      });

      await client.query('COMMIT');
      return { balance: balanceAfter.toString(), reserved: reservedAfter.toString() };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Reserve credits and create job atomically.
   */
  async createAndReserveJob(userId, cost, rawPrompt) {
    const sanitizedPrompt = sanitizeAndAnonymizePrompt(rawPrompt);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        'SELECT balance, reserved FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );

      if (userRes.rowCount === 0) {
        throw new NotFoundError('User not found');
      }

      const user = userRes.rows[0];
      const availableBalance = BigInt(user.balance) - BigInt(user.reserved);

      if (availableBalance < BigInt(cost)) {
        throw new InsufficientCreditsError('Insufficient credit balance available');
      }

      const updateRes = await client.query(
        `UPDATE users 
         SET reserved = reserved + $1 
         WHERE id = $2 
         RETURNING balance, reserved`,
        [cost, userId]
      );

      const balanceAfter = BigInt(updateRes.rows[0].balance);
      const reservedAfter = BigInt(updateRes.rows[0].reserved);

      const jobRes = await client.query(
        `INSERT INTO jobs (user_id, cost, prompt, status) 
         VALUES ($1, $2, $3, 'RESERVED') 
         RETURNING id, user_id AS "userId", cost, prompt, status, created_at AS "createdAt"`,
        [userId, cost, sanitizedPrompt]
      );

      const job = jobRes.rows[0];

      await this._recordLedgerEntry(client, {
        userId,
        jobId: job.id,
        entryType: 'RESERVE',
        amount: cost,
        balanceAfter,
        reservedAfter
      });

      await client.query('COMMIT');
      return job;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Complete job and finalize charge atomically.
   */
  async completeJob(jobId, result = null, options = {}) {
    const { throwOnConflict = true } = options;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const jobRes = await client.query(
        'SELECT * FROM jobs WHERE id = $1 FOR UPDATE',
        [jobId]
      );

      if (jobRes.rowCount === 0) {
        throw new NotFoundError('Job not found');
      }

      const job = jobRes.rows[0];

      if (job.status !== 'RESERVED') {
        if (throwOnConflict) {
          throw new ConflictError(`Cannot complete job with status '${job.status}'`);
        }
        await client.query('COMMIT');
        return { id: job.id, status: job.status, result: job.result, noop: true };
      }

      await client.query(
        "UPDATE jobs SET status = 'COMPLETED', result = $2, updated_at = NOW() WHERE id = $1",
        [jobId, result]
      );

      const userRes = await client.query(
        `UPDATE users 
         SET balance = balance - $1, reserved = reserved - $1 
         WHERE id = $2 
         RETURNING balance, reserved`,
        [job.cost, job.user_id]
      );

      const balanceAfter = BigInt(userRes.rows[0].balance);
      const reservedAfter = BigInt(userRes.rows[0].reserved);

      await this._recordLedgerEntry(client, {
        userId: job.user_id,
        jobId: job.id,
        entryType: 'COMMIT',
        amount: job.cost,
        balanceAfter,
        reservedAfter
      });

      await client.query('COMMIT');
      return { id: job.id, status: 'COMPLETED', result, noop: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fail job and release reserved credits atomically.
   */
  async failJob(jobId, reason = null, options = {}) {
    const { throwOnConflict = true } = options;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const jobRes = await client.query(
        'SELECT * FROM jobs WHERE id = $1 FOR UPDATE',
        [jobId]
      );

      if (jobRes.rowCount === 0) {
        throw new NotFoundError('Job not found');
      }

      const job = jobRes.rows[0];

      if (job.status !== 'RESERVED') {
        if (throwOnConflict) {
          throw new ConflictError(`Cannot fail job with status '${job.status}'`);
        }
        await client.query('COMMIT');
        return { id: job.id, status: job.status, result: job.result, noop: true };
      }

      await client.query(
        "UPDATE jobs SET status = 'FAILED', result = $2, updated_at = NOW() WHERE id = $1",
        [jobId, reason]
      );

      const userRes = await client.query(
        `UPDATE users 
         SET reserved = reserved - $1 
         WHERE id = $2 
         RETURNING balance, reserved`,
        [job.cost, job.user_id]
      );

      const balanceAfter = BigInt(userRes.rows[0].balance);
      const reservedAfter = BigInt(userRes.rows[0].reserved);

      await this._recordLedgerEntry(client, {
        userId: job.user_id,
        jobId: job.id,
        entryType: 'RELEASE',
        amount: job.cost,
        balanceAfter,
        reservedAfter
      });

      await client.query('COMMIT');
      return { id: job.id, status: 'FAILED', result: reason, noop: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get user balance and reserved amount.
   */
  async getUserBalance(userId) {
    const res = await pool.query(
      'SELECT balance, reserved FROM users WHERE id = $1',
      [userId]
    );

    if (res.rowCount === 0) {
      throw new NotFoundError('User not found');
    }

    return {
      balance: parseInt(res.rows[0].balance, 10),
      reserved: parseInt(res.rows[0].reserved, 10),
    };
  }
}

module.exports = new LedgerService();