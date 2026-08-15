const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const knowledgeService = require('../../src/services/knowledge.service');

describe('Module B6: Knowledge Store Unit Tests', () => {
  it('should return the most relevant document as top result for specific query', () => {
    const results = knowledgeService.search('cryptographic ledger balance invariants', 3);
    assert.ok(results.length >= 1);
    assert.strictEqual(results[0].id, 'kb-001'); // Financial Ledger Invariants & Double-Entry Principles
    assert.ok(results[0].score > 0);
  });

  it('should return top 3 relevant entries for a multi-topic query', () => {
    const results = knowledgeService.search('system consistency prompt ledger', 3);
    assert.strictEqual(results.length, 3);
    assert.ok(results[0].score >= results[1].score);
    assert.ok(results[1].score >= results[2].score);
  });

  it('should return relevant prompt guidelines for formatting queries', () => {
    const results = knowledgeService.search('JSON schema output formatting prompt', 3);
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].id, 'kb-002'); // Prompt Engineering: Output Formatting
    assert.ok(results[0].score > 0);
  });

  it('should return empty array for queries with no matching terms or empty input', () => {
    assert.deepStrictEqual(knowledgeService.search(''), []);
    assert.deepStrictEqual(knowledgeService.search('   '), []);
    assert.deepStrictEqual(knowledgeService.search('zyxwvutsrqp12345nonexistent'), []);
  });

  it('should produce deterministic ordering across repeated calls', () => {
    const res1 = knowledgeService.search('concurrency webhook system', 3);
    const res2 = knowledgeService.search('concurrency webhook system', 3);
    assert.deepStrictEqual(res1, res2);
  });

  it('should support dynamically adding new documents to the knowledge base', () => {
    const customDoc = {
      id: 'kb-test-099',
      title: 'Quantum Ledger Reconciliation',
      content: 'Quantum annealing algorithm for superluminal credit verification and consensus.'
    };

    knowledgeService.addDocument(customDoc);
    const results = knowledgeService.search('quantum annealing consensus', 1);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'kb-test-099');
  });
});