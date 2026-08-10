const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../../src/config/db');
const ledgerService = require('../../src/services/ledger.service');

describe('Concurrency & Isolation Edge Cases', () => {
  let userId;

  beforeEach(async () => {
    // Isolated user per test run
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
});