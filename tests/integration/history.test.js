const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../src/config/db');
const ledgerService = require('../../src/services/ledger.service');

describe('Module B5: Movement History and Daily Totals API', () => {
  let userId;

  before(async () => {
    const userRes = await pool.query(
      'INSERT INTO users (balance, reserved) VALUES (0, 0) RETURNING id'
    );
    userId = userRes.rows[0].id;
  });

  test('returns empty history and empty daily totals for fresh user', async () => {
    const history = await ledgerService.getUserMovementHistory(userId, { limit: 10 });
    assert.equal(history.userId, userId);
    assert.equal(history.items.length, 0);
    assert.equal(history.pagination.hasNextPage, false);
    assert.equal(history.pagination.nextCursor, null);
    assert.equal(history.dailyTotals.length, 0);
  });

  test('correctly records movements and aggregates daily totals', async () => {
    // 1. TOPUP 1000
    await ledgerService.topUpUser(userId, 1000);

    // 2. RESERVE 250 (Job 1)
    const job1 = await ledgerService.createAndReserveJob(userId, 250, 'Generate prompt 1');

    // 3. COMMIT Job 1
    await ledgerService.completeJob(job1.id, 'Output 1');

    // 4. RESERVE 100 (Job 2)
    const job2 = await ledgerService.createAndReserveJob(userId, 100, 'Generate prompt 2');

    // 5. FAIL Job 2
    await ledgerService.failJob(job2.id, 'Timeout failure');

    const history = await ledgerService.getUserMovementHistory(userId, { limit: 10 });
    
    // Total 5 entries: TOPUP, RESERVE, COMMIT, RESERVE, RELEASE
    assert.equal(history.items.length, 5);
    
    // Validate reverse chronological order
    const entryTypes = history.items.map((i) => i.entryType);
    assert.deepEqual(entryTypes, ['RELEASE', 'RESERVE', 'COMMIT', 'RESERVE', 'TOPUP']);

    // Validate daily totals aggregation
    assert.ok(history.dailyTotals.length >= 1);
    const todayAggregate = history.dailyTotals[0];
    assert.equal(todayAggregate.totalEntries, 5);
    assert.equal(todayAggregate.totalTopUp, '1000');
    assert.equal(todayAggregate.totalReserved, '350');
    assert.equal(todayAggregate.totalCommitted, '250');
    assert.equal(todayAggregate.totalReleased, '100');
  });

  test('keyset pagination seamlessly traverses entries without drift under concurrent writes', async () => {
    // Page 1 with limit 2
    const page1 = await ledgerService.getUserMovementHistory(userId, { limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.pagination.hasNextPage, true);
    assert.ok(page1.pagination.nextCursor);

    // Simulate concurrent insert while user is between pages
    await ledgerService.topUpUser(userId, 500);

    // Page 2 using cursor
    const page2 = await ledgerService.getUserMovementHistory(userId, {
      limit: 2,
      cursor: page1.pagination.nextCursor
    });
    assert.equal(page2.items.length, 2);
    assert.equal(page2.pagination.hasNextPage, true);

    // Page 3 using cursor
    const page3 = await ledgerService.getUserMovementHistory(userId, {
      limit: 2,
      cursor: page2.pagination.nextCursor
    });
    assert.equal(page3.items.length, 1);
    assert.equal(page3.pagination.hasNextPage, false);
    assert.equal(page3.pagination.nextCursor, null);

    // Ensure strictly disjoint items across pages (no duplicate IDs)
    const allIds = [
      ...page1.items.map((i) => i.id),
      ...page2.items.map((i) => i.id),
      ...page3.items.map((i) => i.id)
    ];
    const uniqueIds = new Set(allIds);
    assert.equal(uniqueIds.size, 5);
  });
});