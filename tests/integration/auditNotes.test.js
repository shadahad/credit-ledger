const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../src/config/db');
const ledgerService = require('../../src/services/ledger.service');
const jobNoteService = require('../../src/services/jobNote.service');

describe('Module B4: Per-Job Audit Notes Capability', () => {
  let userId;
  let jobId;

  before(async () => {
    const userRes = await pool.query(
      'INSERT INTO users (balance, reserved) VALUES ($1, $2) RETURNING id',
      [500, 0]
    );
    userId = userRes.rows[0].id;

    const job = await ledgerService.createAndReserveJob(
      userId,
      50,
      'Generate financial report summary'
    );
    jobId = job.id;
  });

  after(async () => {
    // Only cleanup non-immutable entities.
    // Ledger entries and terminal jobs are protected by PostgreSQL immutability triggers.
    await pool.query('DELETE FROM job_audit_notes WHERE job_id = $1', [jobId]);
    await pool.end();
  });

  test('should append an audit note to an active job', async () => {
    const note = await jobNoteService.addNote(
      jobId,
      'Routing to secondary model provider',
      'ops-agent'
    );

    assert.ok(note.id);
    assert.equal(note.jobId, jobId);
    assert.equal(note.note, 'Routing to secondary model provider');
    assert.equal(note.author, 'ops-agent');
    assert.ok(note.createdAt);
  });

  test('should allow appending audit notes even after a job reaches terminal state', async () => {
    await ledgerService.completeJob(jobId, 'Summary output generated');

    const terminalNote = await jobNoteService.addNote(
      jobId,
      'Post-completion manual compliance audit passed',
      'auditor-1'
    );

    assert.ok(terminalNote.id);
    assert.equal(terminalNote.note, 'Post-completion manual compliance audit passed');

    const allNotes = await jobNoteService.getNotesByJobId(jobId);
    assert.equal(allNotes.length, 2);
    assert.equal(allNotes[0].author, 'ops-agent');
    assert.equal(allNotes[1].author, 'auditor-1');
  });

  test('should throw NotFoundError when adding note for nonexistent job', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    await assert.rejects(
      async () => {
        await jobNoteService.addNote(nonExistentId, 'Some note');
      },
      { name: 'NotFoundError' }
    );
  });

  test('should reject empty or whitespace-only note', async () => {
    await assert.rejects(
      async () => {
        await jobNoteService.addNote(jobId, '   ');
      },
      { name: 'ValidationError' }
    );
  });
});