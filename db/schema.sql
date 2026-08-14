-- =============================================================================
-- Database Schema for Credit Ledger (Modules B1, B2, B3, B7)
-- =============================================================================

-- 1. Create Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_reserved_lte_balance CHECK (reserved <= balance)
);

-- 2. Create Jobs Status ENUM safely
DO $$ BEGIN
    CREATE TYPE job_status AS ENUM ('RESERVED', 'COMPLETED', 'FAILED', 'EXPIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'EXPIRED';

-- 3. Create Jobs Table (includes result column for B7)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    cost BIGINT NOT NULL CHECK (cost > 0),
    prompt TEXT NOT NULL,
    result TEXT NULL,
    status job_status NOT NULL DEFAULT 'RESERVED',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '5 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ensure result column exists if migrating existing table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS result TEXT NULL;

-- 4. Create Ledger Entry Type ENUM safely
DO $$ BEGIN
    CREATE TYPE ledger_entry_type AS ENUM ('TOPUP', 'RESERVE', 'COMMIT', 'RELEASE', 'REFUND');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 5. Create Ledger Entries Table (Module B1 Provability)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    job_id UUID NULL REFERENCES jobs(id),
    entry_type ledger_entry_type NOT NULL,
    amount BIGINT NOT NULL CHECK (amount >= 0),
    balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
    reserved_after BIGINT NOT NULL CHECK (reserved_after >= 0),
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Webhook Idempotency Table (Module B3 Hostile Network Defense)
CREATE TABLE IF NOT EXISTS processed_webhooks (
    event_id VARCHAR(255) PRIMARY KEY,
    job_id UUID NULL,
    status VARCHAR(50) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Safely drop foreign key constraint if it was previously created
ALTER TABLE processed_webhooks DROP CONSTRAINT IF EXISTS processed_webhooks_job_id_fkey;

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_ledger_entries_user ON ledger_entries (user_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_reserved_expired ON jobs (status, expires_at) WHERE status = 'RESERVED';

-- 8. Immutability Trigger for Jobs
CREATE OR REPLACE FUNCTION prevent_job_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('COMPLETED', 'FAILED', 'EXPIRED') THEN
        RAISE EXCEPTION 'Terminal state reached: Completed, Failed, or Expired jobs cannot be updated or deleted.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_job_modification ON jobs;
CREATE TRIGGER trg_prevent_job_modification
BEFORE UPDATE OR DELETE ON jobs
FOR EACH ROW
EXECUTE FUNCTION prevent_job_modification();

-- 9. Immutability Trigger for Ledger Entries
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

-- 10. Job Audit Notes Table (Module B4)
CREATE TABLE IF NOT EXISTS job_audit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    note TEXT NOT NULL CHECK (char_length(trim(note)) > 0),
    author VARCHAR(100) NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_audit_notes_job_id ON job_audit_notes (job_id, created_at ASC);

-- 11. Movement History Composite Index (Module B5 Keyset Pagination)
CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_history 
ON ledger_entries (user_id, created_at DESC, id DESC);