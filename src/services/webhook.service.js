const pool = require('../config/db');
const ledgerService = require('./ledger.service');
const errors = require('../errors/AppError');

const AppError = errors.AppError || errors;
const BadRequestError = errors.BadRequestError || class extends (AppError || Error) { constructor(msg) { super(msg); this.statusCode = 400; } };

async function handleProviderWebhook({ eventId, jobId, result, output }) {
  if (!eventId || !jobId || !result) {
    throw new BadRequestError('Invalid payload: eventId, jobId, and result are required');
  }

  const client = await pool.connect();
  let isDuplicate = false;

  try {
    await client.query('BEGIN');

    // Replay protection: insert eventId atomically
    const insertRes = await client.query(
      `INSERT INTO processed_webhooks (event_id, job_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, jobId, result]
    );

    if (insertRes.rowCount === 0) {
      isDuplicate = true;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (isDuplicate) {
    return { status: 'duplicate', message: 'Event already processed' };
  }

  // Settle job terminal state
  const isSuccess = String(result).toLowerCase() === 'success';
  if (isSuccess) {
    const outcome = await ledgerService.completeJob(
      jobId, 
      output || 'Completed via Provider Webhook', 
      { throwOnConflict: false }
    );
    return { status: 'processed', result: 'COMPLETED', noop: outcome.noop };
  } else {
    const outcome = await ledgerService.failJob(
      jobId, 
      output || 'Failed via Provider Webhook', 
      { throwOnConflict: false }
    );
    return { status: 'processed', result: 'FAILED', noop: outcome.noop };
  }
}

module.exports = {
  handleProviderWebhook
};