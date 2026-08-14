-- =============================================================================
-- Module B4 Migration: Per-Job Audit Note Capability
-- Safe, zero-downtime, non-locking migration for production environments
-- =============================================================================

CREATE TABLE IF NOT EXISTS job_audit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    note TEXT NOT NULL CHECK (char_length(trim(note)) > 0),
    author VARCHAR(100) NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Fast chronological index per job
CREATE INDEX IF NOT EXISTS idx_job_audit_notes_job_id ON job_audit_notes (job_id, created_at ASC);