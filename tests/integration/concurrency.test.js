const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../../src/config/db');
const ledgerService = require('../../src/services/ledger.service');

describe('Concurrency & Isolation Edge Cases', () => {
  let userId;

  beforeEach(async () => {
    // 1. Truncate tables to ensure a clean state for every test
    await pool.query('TRUNCATE users, jobs, ledger_entries CASCADE');

    // 2. Isolated user per test run
    userId = crypto.randomUUID();
    await pool.query(
      'INSERT INTO users (id, balance, reserved) VALUES ($1, 100, 0)',
      [userId]
    );
  });

  after(async () => {
    await pool.end();
  });

  test('Simultaneous reserve requests never exceed balance', async () => {
    // Attempt 5 parallel requests each requesting 30 credits (Total 150 > Available 100)
    const requests = Array.from({ length: 5 }, (_, i) =>
      ledgerService.createAndReserveJob(userId, 30, `Parallel prompt ${i}`)
        .then(() => 'SUCCESS')
        .catch((err) => err.name)
    );

    const results = await Promise.all(requests);
    const successes = results.filter((r) => r === 'SUCCESS');
    const failures = results.filter((r) => r === 'InsufficientCreditsError');

    assert.equal(successes.length, 3); // 3 * 30 = 90 <= 100
    assert.equal(failures.length, 2);

    const finalBal = await ledgerService.getUserBalance(userId);
    assert.equal(finalBal.reserved, 90);
    assert.equal(finalBal.balance, 100);
  });

  test('Cannot complete a job twice', async () => {
    const job = await ledgerService.createAndReserveJob(userId, 20, 'Double complete');
    await ledgerService.completeJob(job.id);

    await assert.rejects(
      async () => {
        await ledgerService.completeJob(job.id);
      },
      { name: 'ConflictError' }
    );
  });

  test('Abandoned expired reservation is safely released by cleanup', async () => {
    // Reserve 40 credits
    const job = await ledgerService.createAndReserveJob(userId, 40, 'Abandoned job prompt');

    // Force job expiration timestamp into the past
    await pool.query(
      "UPDATE jobs SET expires_at = NOW() - INTERVAL '10 minutes' WHERE id = $1",
      [job.id]
    );

    // Run cleanup sweep
    const result = await ledgerService.releaseAbandonedReservations(10);

    assert.equal(result.processedCount, 1);
    assert.ok(result.releasedJobIds.includes(job.id));

    // Verify user balance state (reserved reset to 0)
    const userBal = await ledgerService.getUserBalance(userId);
    assert.equal(userBal.reserved, 0);
    assert.equal(userBal.balance, 100);

    // Verify job status changed to EXPIRED
    const jobRes = await pool.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    assert.equal(jobRes.rows[0].status, 'EXPIRED');

    // Verify immutable RELEASE entry was recorded in ledger
    const ledgerRes = await pool.query(
      "SELECT entry_type, amount FROM ledger_entries WHERE job_id = $1 AND entry_type = 'RELEASE'",
      [job.id]
    );
    assert.equal(ledgerRes.rows.length, 1);
    assert.equal(ledgerRes.rows[0].entry_type, 'RELEASE');
    assert.equal(ledgerRes.rows[0].amount, '40');
  });

  test('Distributed cleanup: Multiple workers running concurrently never double-release expired jobs', async () => {
    // Top up user balance for bulk testing
    await pool.query('UPDATE users SET balance = 1000 WHERE id = $1', [userId]);

    // Create 10 reserved jobs (10 * 30 = 300 credits reserved)
    for (let i = 0; i < 10; i++) {
      await ledgerService.createAndReserveJob(userId, 30, `Bulk prompt ${i}`);
    }

    // Force all 10 reserved jobs to be expired
    await pool.query(
      "UPDATE jobs SET expires_at = NOW() - INTERVAL '5 minutes' WHERE user_id = $1",
      [userId]
    );

    // Simulate 4 concurrent cleanup worker machines running at the exact same instant
    const NUM_WORKERS = 4;
    const workerPromises = Array.from({ length: NUM_WORKERS }, () =>
      ledgerService.releaseAbandonedReservations(3) // Batch size 3 per worker
    );

    const workerResults = await Promise.all(workerPromises);

    const totalProcessed = workerResults.reduce((sum, r) => sum + r.processedCount, 0);
    const allReleasedIds = workerResults.flatMap((r) => r.releasedJobIds);

    // 1. Assert exactly 10 jobs were processed in total without duplicate releases
    assert.equal(totalProcessed, 10);
    assert.equal(new Set(allReleasedIds).size, 10);

    // 2. Assert user reserved credits dropped back to 0
    const finalBal = await ledgerService.getUserBalance(userId);
    assert.equal(finalBal.reserved, 0);
    assert.equal(finalBal.balance, 1000);

    // 3. Assert exactly 10 RELEASE entries were recorded in ledger
    const ledgerCount = await pool.query(
      "SELECT COUNT(*) FROM ledger_entries WHERE user_id = $1 AND entry_type = 'RELEASE'",
      [userId]
    );
    assert.equal(parseInt(ledgerCount.rows[0].count, 10), 10);
  });
});