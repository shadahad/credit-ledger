const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const pool = require('../../src/config/db');
const app = require('../../src/app');
const ledgerService = require('../../src/services/ledger.service');

const WEBHOOK_SECRET = 'test-secret-key-123';
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;

function generateSignature(payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
}

describe('Module B3: Hostile Network Webhook Provider', () => {
  let server;
  let baseUrl;
  let userId;
  let jobId;

  before(async () => {
    // Start test server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const u = await pool.query('INSERT INTO users (balance, reserved) VALUES (100, 0) RETURNING id');
    userId = u.rows[0].id;
  });

  after(async () => {
    // Safe async server close (avoids deleting immutable trigger-protected tables)
    await new Promise((resolve) => server.close(resolve));
  });

  test('Rejects request without signature header (401)', async () => {
    const res = await fetch(`${baseUrl}/webhooks/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: 'ev-1', jobId: '00000000-0000-0000-0000-000000000000', result: 'success' })
    });
    assert.equal(res.status, 401);
  });

  test('Rejects tampered / forged payload signature (403)', async () => {
    const payload = { eventId: 'ev-1', jobId: '00000000-0000-0000-0000-000000000000', result: 'success' };
    const res = await fetch(`${baseUrl}/webhooks/provider`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': 'deadbeef00000000000000000000000000000000000000000000000000000000'
      },
      body: JSON.stringify(payload)
    });
    assert.equal(res.status, 403);
  });

  test('Processes valid success webhook, completes job, and commits ledger entry', async () => {
    const job = await ledgerService.createAndReserveJob(userId, 20, 'Test prompt for webhook');
    jobId = job.id;

    const payload = {
      eventId: `evt-unique-${Date.now()}-1`,
      jobId: job.id,
      result: 'success',
      output: 'AI generated output text'
    };
    const bodyStr = JSON.stringify(payload);
    const sig = generateSignature(bodyStr);

    const res = await fetch(`${baseUrl}/webhooks/provider`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sig
      },
      body: bodyStr
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'processed');

    // Verify job status and result in DB
    const dbJob = await pool.query('SELECT status, result FROM jobs WHERE id = $1', [job.id]);
    assert.equal(dbJob.rows[0].status, 'COMPLETED');
    assert.equal(dbJob.rows[0].result, 'AI generated output text');

    // Verify user balance committed (100 - 20 = 80, reserved = 0)
    const dbUser = await pool.query('SELECT balance, reserved FROM users WHERE id = $1', [userId]);
    assert.equal(Number(dbUser.rows[0].balance), 80);
    assert.equal(Number(dbUser.rows[0].reserved), 0);
  });

  test('Duplicate webhook delivery with same eventId is idempotent (no-op)', async () => {
    const repeatEventId = `evt-repeat-${Date.now()}`;
    const payload = {
      eventId: repeatEventId,
      jobId,
      result: 'success',
      output: 'AI generated output text'
    };
    const bodyStr = JSON.stringify(payload);
    const sig = generateSignature(bodyStr);

    // 1st delivery
    const res1 = await fetch(`${baseUrl}/webhooks/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature': sig },
      body: bodyStr
    });
    assert.equal(res1.status, 200);

    // 2nd delivery (duplicate)
    const res2 = await fetch(`${baseUrl}/webhooks/provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature': sig },
      body: bodyStr
    });
    assert.equal(res2.status, 200);
    const data = await res2.json();
    assert.equal(data.status, 'duplicate');
  });

  test('Webhook failure result releases reserved credit', async () => {
    const job = await ledgerService.createAndReserveJob(userId, 15, 'Failure prompt');

    const payload = {
      eventId: `evt-fail-${Date.now()}`,
      jobId: job.id,
      result: 'failure',
      output: 'Provider timeout error'
    };
    const bodyStr = JSON.stringify(payload);
    const sig = generateSignature(bodyStr);

    const res = await fetch(`${baseUrl}/webhooks/provider`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': sig
      },
      body: bodyStr
    });

    assert.equal(res.status, 200);
    const dbJob = await pool.query('SELECT status, result FROM jobs WHERE id = $1', [job.id]);
    assert.equal(dbJob.rows[0].status, 'FAILED');

    // Balance remains 80, reserved released back to 0
    const dbUser = await pool.query('SELECT balance, reserved FROM users WHERE id = $1', [userId]);
    assert.equal(Number(dbUser.rows[0].balance), 80);
    assert.equal(Number(dbUser.rows[0].reserved), 0);
  });
});