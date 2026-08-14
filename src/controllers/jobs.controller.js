const pool = require('../config/db');
const ledgerService = require('../services/ledger.service');
const { NotFoundError } = require('../errors/AppError');

/**
 * Create and reserve a new job.
 */
async function createJob(req, res, next) {
  try {
    const { userId, cost, prompt } = req.body;
    const job = await ledgerService.createAndReserveJob(userId, cost, prompt);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieve a job and its produced result (Module B7).
 */
async function getJobById(req, res, next) {
  try {
    const { id } = req.params;
    const query = `
      SELECT 
        id, 
        user_id AS "userId", 
        cost, 
        prompt, 
        result, 
        status, 
        expires_at AS "expiresAt", 
        created_at AS "createdAt", 
        updated_at AS "updatedAt"
      FROM jobs 
      WHERE id = $1
    `;
    const resJob = await pool.query(query, [id]);

    if (resJob.rowCount === 0) {
      throw new NotFoundError('Job not found');
    }

    res.status(200).json(resJob.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * Complete a job and finalize credit commitment.
 */
async function completeJob(req, res, next) {
  try {
    const { id } = req.params;
    const { result } = req.body || {};
    const outcome = await ledgerService.completeJob(id, result);
    res.status(200).json(outcome);
  } catch (err) {
    next(err);
  }
}

/**
 * Fail a job and release credit reservation.
 */
async function failJob(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const outcome = await ledgerService.failJob(id, reason);
    res.status(200).json(outcome);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createJob,
  getJobById,
  completeJob,
  failJob
};