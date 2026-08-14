const pool = require('../config/db');
const ledgerService = require('./ledger.service');
const aiClient = require('./ai.client');

/**
 * Claims and processes the next pending RESERVED job using FOR UPDATE SKIP LOCKED.
 * Supports optional userId filter for isolated processing.
 */
async function claimAndProcessNextJob(options = {}) {
  const { userId } = options;
  const client = await pool.connect();
  let claimedJob = null;

  try {
    await client.query('BEGIN');

    const whereClause = userId 
      ? `WHERE user_id = $1 AND status = 'RESERVED' AND expires_at > NOW()`
      : `WHERE status = 'RESERVED' AND expires_at > NOW()`;
    const params = userId ? [userId] : [];

    const selectRes = await client.query(
      `SELECT * FROM jobs 
       ${whereClause}
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      params
    );

    if (selectRes.rowCount === 0) {
      await client.query('COMMIT');
      return null;
    }

    claimedJob = selectRes.rows[0];
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Execute AI Call
  try {
    const output = await aiClient.generateText(claimedJob.prompt);
    await ledgerService.completeJob(claimedJob.id, output, { throwOnConflict: false });
    return { jobId: claimedJob.id, status: 'COMPLETED', result: output };
  } catch (err) {
    await ledgerService.failJob(claimedJob.id, err.message, { throwOnConflict: false });
    return { jobId: claimedJob.id, status: 'FAILED', error: err.message };
  }
}

async function processJobById(jobId) {
  const client = await pool.connect();
  let job = null;

  try {
    const res = await client.query(
      `SELECT * FROM jobs WHERE id = $1 AND status = 'RESERVED' AND expires_at > NOW()`,
      [jobId]
    );
    if (res.rowCount === 0) return null;
    job = res.rows[0];
  } finally {
    client.release();
  }

  try {
    const output = await aiClient.generateText(job.prompt);
    const outcome = await ledgerService.completeJob(job.id, output, { throwOnConflict: false });
    return outcome;
  } catch (err) {
    const outcome = await ledgerService.failJob(job.id, err.message, { throwOnConflict: false });
    return outcome;
  }
}

module.exports = {
  claimAndProcessNextJob,
  processJobById
};