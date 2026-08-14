const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../src/config/db');
const app = require('../../src/app');
const ledgerService = require('../../src/services/ledger.service');
const runnerService = require('../../src/services/runner.service');
const aiClient = require('../../src/services/ai.client');

describe('Module B7: AI Runner Execution and Result Retrieval', () => {
  let server;
  let baseUrl;
  let userId;
  let originalGenerateText;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const u = await pool.query('INSERT INTO users (balance, reserved) VALUES (200, 0) RETURNING id');
    userId = u.rows[0].id;

    // Stub network AI calls for offline test execution
    originalGenerateText = aiClient.generateText;
    aiClient.generateText = async (prompt) => `Mock AI Response for: ${prompt}`;
  });

  after(async () => {
    aiClient.generateText = originalGenerateText;
    await new Promise((resolve) => server.close(resolve));
  });

  test('Runner claims and completes a reserved job without double-spending', async () => {
    const job = await ledgerService.createAndReserveJob(userId, 25, 'Translate hello to French');

    const outcome = await runnerService.claimAndProcessNextJob({ userId });
    assert.ok(outcome);
    assert.equal(outcome.jobId, job.id);
    assert.equal(outcome.status, 'COMPLETED');
    assert.equal(outcome.result, 'Mock AI Response for: Translate hello to French');

    // Retrieve via API (GET /jobs/:id)
    const getRes = await fetch(`${baseUrl}/jobs/${job.id}`);
    assert.equal(getRes.status, 200);
    const fetched = await getRes.json();
    assert.equal(fetched.status, 'COMPLETED');
    assert.equal(fetched.result, 'Mock AI Response for: Translate hello to French');

    // Verify balance was charged exactly once (200 - 25 = 175)
    const userRes = await pool.query('SELECT balance, reserved FROM users WHERE id = $1', [userId]);
    assert.equal(Number(userRes.rows[0].balance), 175);
    assert.equal(Number(userRes.rows[0].reserved), 0);
  });

  test('Concurrent runner workers claim distinct jobs without race conditions', async () => {
    const jobA = await ledgerService.createAndReserveJob(userId, 10, 'Prompt A');
    const jobB = await ledgerService.createAndReserveJob(userId, 10, 'Prompt B');

    // Run two workers simultaneously isolated to this test user
    const [res1, res2] = await Promise.all([
      runnerService.claimAndProcessNextJob({ userId }),
      runnerService.claimAndProcessNextJob({ userId })
    ]);

    assert.ok(res1);
    assert.ok(res2);
    assert.notEqual(res1.jobId, res2.jobId);
    assert.equal(res1.status, 'COMPLETED');
    assert.equal(res2.status, 'COMPLETED');

    const userRes = await pool.query('SELECT balance, reserved FROM users WHERE id = $1', [userId]);
    assert.equal(Number(userRes.rows[0].balance), 155);
    assert.equal(Number(userRes.rows[0].reserved), 0);
  });

  test('Runner handles AI failure and releases reservation safely', async () => {
    const job = await ledgerService.createAndReserveJob(userId, 15, 'Prompt that fails');

    // Force failure for this test
    aiClient.generateText = async () => {
      throw new Error('Rate limit exceeded from provider');
    };

    const outcome = await runnerService.claimAndProcessNextJob({ userId });
    assert.equal(outcome.status, 'FAILED');
    assert.ok(outcome.error.includes('Rate limit'));

    const getRes = await fetch(`${baseUrl}/jobs/${job.id}`);
    const fetched = await getRes.json();
    assert.equal(fetched.status, 'FAILED');

    // Balance remains 155, reserved restored to 0
    const userRes = await pool.query('SELECT balance, reserved FROM users WHERE id = $1', [userId]);
    assert.equal(Number(userRes.rows[0].balance), 155);
    assert.equal(Number(userRes.rows[0].reserved), 0);
  });
});