const pool = require('../config/db');
const { sanitizeAndAnonymizePrompt } = require('./prompt.service');
const { NotFoundError, InsufficientCreditsError, ConflictError } = require('../errors/AppError');

class LedgerService {
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

      // Increment reserved credits
      await client.query(
        'UPDATE users SET reserved = reserved + $1 WHERE id = $2',
        [cost, userId]
      );

      // Create job record
      const jobRes = await client.query(
        `INSERT INTO jobs (user_id, cost, prompt, status) 
         VALUES ($1, $2, $3, 'RESERVED') 
         RETURNING id, user_id AS "userId", cost, prompt, status, created_at AS "createdAt"`,
        [userId, cost, sanitizedPrompt]
      );

      await client.query('COMMIT');
      return jobRes.rows[0];
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

      // Deduct cost from balance and reserved
      await client.query(
        'UPDATE users SET balance = balance - $1, reserved = reserved - $1 WHERE id = $2',
        [job.cost, job.user_id]
      );

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

      // Release reserved credits
      await client.query(
        'UPDATE users SET reserved = reserved - $1 WHERE id = $2',
        [job.cost, job.user_id]
      );

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