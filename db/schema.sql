-- Drop existing tables and functions if present
DROP TRIGGER IF EXISTS enforce_job_immutability ON jobs;
DROP FUNCTION IF EXISTS prevent_job_modification();
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS users;

-- Users Table (No foreign keys link jobs to users, respecting Requirement 9)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    CONSTRAINT check_reserved_lte_balance CHECK (reserved <= balance)
);

-- Jobs Table (No Foreign Key to users table)
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    cost BIGINT NOT NULL CHECK (cost > 0),
    prompt TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMPLETED', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TRIGGER enforce_job_immutability
BEFORE UPDATE OR DELETE ON jobs
FOR EACH ROW
EXECUTE FUNCTION prevent_job_modification();