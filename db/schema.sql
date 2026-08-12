-- Idempotent Schema - uses IF NOT EXISTS and CREATE OR REPLACE --

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
    CREATE TYPE job_status AS ENUM ('RESERVED', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Create Jobs Table
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    cost BIGINT NOT NULL CHECK (cost > 0),
    prompt TEXT NOT NULL,
    status job_status NOT NULL DEFAULT 'RESERVED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create Ledger Entry Type ENUM safely
DO $$ BEGIN
    CREATE TYPE ledger_entry_type AS ENUM ('TOPUP', 'RESERVE', 'COMMIT', 'RELEASE', 'REFUND');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 5. Create Ledger Entries Table
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    job_id UUID NULL,
    entry_type ledger_entry_type NOT NULL,
    amount BIGINT NOT NULL CHECK (amount >= 0),
    balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
    reserved_after BIGINT NOT NULL CHECK (reserved_after >= 0),
    prev_hash VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_ledger_entries_user ON ledger_entries (user_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs (user_id);

-- 7. Immutability Trigger for Jobs
CREATE OR REPLACE FUNCTION prevent_job_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('COMPLETED', 'FAILED') THEN
        RAISE EXCEPTION 'Terminal state reached: Completed or Failed jobs cannot be updated or deleted.'
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

-- 8. Immutability Trigger for Ledger Entries
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