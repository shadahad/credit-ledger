const crypto = require('crypto');
const pool = require('../config/db');
const { sanitizeAndAnonymizePrompt } = require('./prompt.service');
const { NotFoundError, InsufficientCreditsError, ConflictError } = require('../errors/AppError');

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
   * Helper: Inserts an immutable log entry with continuous hash chaining within an active transaction client.
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

      // Lock user row for update to prevent concurrent updates
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

      // Increment reserved credits and return updated state
      const updateRes = await client.query(
        `UPDATE users 
         SET reserved = reserved + $1 
         WHERE id = $2 
         RETURNING balance, reserved`,
        [cost, userId]
      );

      const balanceAfter = BigInt(updateRes.rows[0].balance);
      const reservedAfter = BigInt(updateRes.rows[0].reserved);

      // Create job record
      const jobRes = await client.query(
        `INSERT INTO jobs (user_id, cost, prompt, status) 
         VALUES ($1, $2, $3, 'RESERVED') 
         RETURNING id, user_id AS "userId", cost, prompt, status, created_at AS "createdAt"`,
        [userId, cost, sanitizedPrompt]
      );

      const job = jobRes.rows[0];

      // Record immutable ledger entry
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
  async completeJob(jobId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Lock job row
      const jobRes = await client.query(
        'SELECT * FROM jobs WHERE id = $1 FOR UPDATE',
        [jobId]
      );

      if (jobRes.rowCount === 0) {
        throw new NotFoundError('Job not found');
      }

      const job = jobRes.rows[0];

      if (job.status !== 'RESERVED') {
        throw new ConflictError(`Cannot complete job with status '${job.status}'`);
      }

      // Update job to COMPLETED
      await client.query(
        "UPDATE jobs SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1",
        [jobId]
      );

      // Deduct cost from balance and reserved, returning updated user state
      const userRes = await client.query(
        `UPDATE users 
         SET balance = balance - $1, reserved = reserved - $1 
         WHERE id = $2 
         RETURNING balance, reserved`,
        [job.cost, job.user_id]
      );

      const balanceAfter = BigInt(userRes.rows[0].balance);
      const reservedAfter = BigInt(userRes.rows[0].reserved);

      // Record immutable ledger entry
      await this._recordLedgerEntry(client, {
        userId: job.user_id,
        jobId: job.id,
        entryType: 'COMMIT',
        amount: job.cost,
        balanceAfter,
        reservedAfter
      });

      await client.query('COMMIT');
      return { id: job.id, status: 'COMPLETED' };
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
  async failJob(jobId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Lock job row
      const jobRes = await client.query(
        'SELECT * FROM jobs WHERE id = $1 FOR UPDATE',
        [jobId]
      );

      if (jobRes.rowCount === 0) {
        throw new NotFoundError('Job not found');
      }

      const job = jobRes.rows[0];

      if (job.status !== 'RESERVED') {
        throw new ConflictError(`Cannot fail job with status '${job.status}'`);
      }

      // Update job to FAILED
      await client.query(
        "UPDATE jobs SET status = 'FAILED', updated_at = NOW() WHERE id = $1",
        [jobId]
      );

      // Release reserved credits, returning updated user state
      const userRes = await client.query(
        `UPDATE users 
         SET reserved = reserved - $1 
         WHERE id = $2 
         RETURNING balance, reserved`,
        [job.cost, job.user_id]
      );

      const balanceAfter = BigInt(userRes.rows[0].balance);
      const reservedAfter = BigInt(userRes.rows[0].reserved);

      // Record immutable ledger entry
      await this._recordLedgerEntry(client, {
        userId: job.user_id,
        jobId: job.id,
        entryType: 'RELEASE',
        amount: job.cost,
        balanceAfter,
        reservedAfter
      });

      await client.query('COMMIT');
      return { id: job.id, status: 'FAILED' };
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