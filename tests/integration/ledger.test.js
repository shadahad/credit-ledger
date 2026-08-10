const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../../src/config/db');
const ledgerService = require('../../src/services/ledger.service');

describe('Ledger Core Integration Workflow', () => {
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

  test('Reserves credits on job creation', async () => {
    const job = await ledgerService.createAndReserveJob(userId, 30, 'Generate summary');
    assert.ok(job.id);

    const bal = await ledgerService.getUserBalance(userId);
    assert.equal(bal.balance, 100);
    assert.equal(bal.reserved, 30);
  });

  test('Completes job, deducting balance and reserved', async () => {
    const job = await ledgerService.createAndReserveJob(userId, 40, 'Generate image');
    await ledgerService.completeJob(job.id);

    const bal = await ledgerService.getUserBalance(userId);
    assert.equal(bal.balance, 60);
    assert.equal(bal.reserved, 0);
  });

  test('Fails job, releasing reserved credits', async () => {
    const job = await ledgerService.createAndReserveJob(userId, 40, 'Failing prompt');
    await ledgerService.failJob(job.id);

    const bal = await ledgerService.getUserBalance(userId);
    assert.equal(bal.balance, 100);
    assert.equal(bal.reserved, 0);
  });

  test('Prevents spending beyond balance', async () => {
    await assert.rejects(
      async () => {
        await ledgerService.createAndReserveJob(userId, 150, 'Overspend prompt');
      },
      { name: 'InsufficientCreditsError' }
    );
  });
});