const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../../src/app');

describe('Module B6: GET /knowledge/search Integration Tests', () => {
  let server;
  let baseUrl;

  before((_, done) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((_, done) => {
    server.close(done);
  });

  it('should return 400 when query parameter "q" is missing', async () => {
    const res = await fetch(`${baseUrl}/knowledge/search`);
    assert.strictEqual(res.status, 400);

    const body = await res.json();
    assert.ok(body.error);
    assert.match(body.error, /'q' is required/i);
  });

  it('should return 400 when query parameter "q" is empty whitespace', async () => {
    const res = await fetch(`${baseUrl}/knowledge/search?q=%20%20%20`);
    assert.strictEqual(res.status, 400);

    const body = await res.json();
    assert.ok(body.error);
  });

  it('should return 200 with top 3 matched documents for multi-concept query', async () => {
    const query = encodeURIComponent('system consistency prompt ledger');
    const res = await fetch(`${baseUrl}/knowledge/search?q=${query}`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.count, 3);
    assert.strictEqual(Array.isArray(body.results), true);
    assert.strictEqual(body.results.length, 3);

    // Verify all returned entries contain valid metadata and scores
    for (const doc of body.results) {
      assert.ok(doc.id);
      assert.ok(doc.title);
      assert.ok(doc.content);
      assert.ok(doc.score > 0);
    }

    // Verify deterministic descending score ordering
    assert.ok(body.results[0].score >= body.results[1].score);
    assert.ok(body.results[1].score >= body.results[2].score);
  });

  it('should return matched document for specific query', async () => {
    const query = encodeURIComponent('idempotency locks concurrency');
    const res = await fetch(`${baseUrl}/knowledge/search?q=${query}`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(body.results.length >= 1);
    assert.strictEqual(body.results[0].id, 'kb-003');
    assert.ok(body.results[0].title.includes('Idempotency'));
  });

  it('should respect custom limit parameter if provided', async () => {
    const query = encodeURIComponent('system prompt consistency ledger');
    const res = await fetch(`${baseUrl}/knowledge/search?q=${query}&limit=2`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.results.length, 2);
    assert.strictEqual(body.count, 2);
  });
});