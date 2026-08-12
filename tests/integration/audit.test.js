const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../src/config/db');
const ledgerService = require('../../src/services/ledger.service');
const auditService = require('../../src/services/audit.service');

describe('Module B1 Integration: Provable Ledger & Audit Chain', () => {
  let testUserId;

  before(async () => {
    // 1. Ensure schema and trigger exist in test DB
    await pool.query(`
      DO $$ BEGIN
          CREATE TYPE ledger_entry_type AS ENUM ('TOPUP', 'RESERVE', 'COMMIT', 'RELEASE', 'REFUND');
      EXCEPTION
          WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS ledger_entries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          job_id UUID NULL,
          entry_type ledger_entry_type NOT NULL,
          amount NUMERIC(12, 4) NOT NULL CHECK (amount >= 0),
          balance_after NUMERIC(12, 4) NOT NULL CHECK (balance_after >= 0),
          reserved_after NUMERIC(12, 4) NOT NULL CHECK (reserved_after >= 0),
          prev_hash VARCHAR(64) NOT NULL,
          hash VARCHAR(64) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE OR REPLACE FUNCTION prevent_ledger_tampering()
      RETURNS TRIGGER AS $$
      BEGIN
          RAISE EXCEPTION 'CRITICAL AUDIT ERROR: Ledger history is immutable. Operation % denied on record %', TG_OP, OLD.id
              USING ERRCODE = '27000';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_ledger_tampering ON ledger_entries;
      CREATE TRIGGER trg_prevent_ledger_tampering
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION prevent_ledger_tampering();
    `);

    // 2. Create isolated test user
    const res = await pool.query(
      `INSERT INTO users (balance, reserved) 
       VALUES (0, 0) 
       RETURNING id`
    );
    testUserId = res.rows[0].id;
  });

  after(async () => {
    if (!testUserId) return;

    // Disable triggers on ledger_entries to clean up test entries
    await pool.query('ALTER TABLE ledger_entries DISABLE TRIGGER trg_prevent_ledger_tampering');
    await pool.query('DELETE FROM ledger_entries WHERE user_id = $1', [testUserId]);
    await pool.query('ALTER TABLE ledger_entries ENABLE TRIGGER trg_prevent_ledger_tampering');

    // Disable triggers on jobs to clean up completed/failed test jobs
    await pool.query('ALTER TABLE jobs DISABLE TRIGGER ALL');
    await pool.query('DELETE FROM jobs WHERE user_id = $1', [testUserId]);
    await pool.query('ALTER TABLE jobs ENABLE TRIGGER ALL');

    // Clean up test user
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
  });

  test('1. Verified audit trail succeeds after multiple transactions', async () => {
    await ledgerService.topUpUser(testUserId, 100);
    
    // Create and reserve job
    const job = await ledgerService.createAndReserveJob(testUserId, 40, 'Test prompt');
    
    // Complete job
    await ledgerService.completeJob(job.id);

    const audit = await auditService.verifyUserAuditTrail(testUserId);
    
    assert.strictEqual(audit.verified, true);
    assert.strictEqual(audit.totalEntries, 3); // 1 TOPUP + 1 RESERVE + 1 COMMIT
    assert.strictEqual(audit.currentBalance, '60');
    assert.strictEqual(audit.currentReserved, '0');
  });

  test('2. Database trigger prevents UPDATE on ledger entries', async () => {
    const { rows } = await pool.query(
      'SELECT id FROM ledger_entries WHERE user_id = $1 LIMIT 1',
      [testUserId]
    );
    assert.ok(rows.length > 0, 'Ledger entry should exist');
    const entryId = rows[0].id;

    // Attempt direct SQL modification - expect database trigger exception
    await assert.rejects(
      async () => {
        await pool.query('UPDATE ledger_entries SET amount = 9999 WHERE id = $1', [entryId]);
      },
      (err) => {
        return err.message.includes('Ledger history is immutable');
      }
    );
  });

  test('3. Detection of unauthorized database tampering via audit service', async () => {
    // Disable trigger temporarily (Simulates rogue DB admin modification)
    await pool.query('ALTER TABLE ledger_entries DISABLE TRIGGER trg_prevent_ledger_tampering');
    
    // Tamper with ledger amount
    await pool.query(
      "UPDATE ledger_entries SET amount = 500 WHERE user_id = $1 AND entry_type = 'TOPUP'",
      [testUserId]
    );

    // Re-enable trigger
    await pool.query('ALTER TABLE ledger_entries ENABLE TRIGGER trg_prevent_ledger_tampering');

    // Audit verification must catch the tampered entry or broken hash chain
    const audit = await auditService.verifyUserAuditTrail(testUserId);
    
    assert.strictEqual(audit.verified, false);
    assert.ok(
      ['RECORD_TAMPERED', 'HASH_CHAIN_BROKEN', 'BALANCE_MISMATCH'].includes(audit.reason),
      `Expected a security breach reason but got ${audit.reason}`
    );
  });
});