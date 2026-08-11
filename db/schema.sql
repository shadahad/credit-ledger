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

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs (user_id);

-- Immutability enforcement trigger (Requirement 9)
CREATE OR REPLACE FUNCTION prevent_job_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('COMPLETED', 'FAILED') THEN
        RAISE EXCEPTION 'Terminal state reached: Completed or Failed jobs cannot be updated or deleted.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_job_immutability ON jobs;
CREATE TRIGGER trg_enforce_job_immutability
BEFORE UPDATE OR DELETE ON jobs
FOR EACH ROW
EXECUTE FUNCTION prevent_job_modification();