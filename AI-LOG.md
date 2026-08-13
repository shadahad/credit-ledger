# AI Log — Module B2: Abandoned Reservations Clean Up

This document logs the design choices, architectural tradeoffs, and testing strategy for **Module B2: Abandoned Reservations Clean Up**.

---

## Architectural Decisions

### 1. Distributed Concurrency Strategy: `FOR UPDATE SKIP LOCKED` vs. Redis Locks
- **Decision**: Used PostgreSQL's native `FOR UPDATE SKIP LOCKED` clause inside atomic transactions instead of an external distributed lock manager like Redis (Redlock).
- **Rationale**:
  - Eliminates external lock infrastructure dependencies and single points of failure.
  - Transactional consistency: Locking the job row, updating `users.reserved`, inserting into `ledger_entries`, and transitioning job status to `EXPIRED` happen within a single PostgreSQL ACID transaction.
  - If a worker crashes mid-cleanup, Postgres automatically aborts the transaction and releases the row lock immediately.

### 2. Audit Trail Integration (Module B1 Continuity)
- **Decision**: Every expired reservation cleanup calls `_recordLedgerEntry()` with type `'RELEASE'`.
- **Rationale**: Preserves the cryptographic hash chain (`prev_hash` -> `hash`) established in Module B1. Ensures all released credits are mathematically provable and fully audited.

### 3. Partial Indexing Optimization
- **Decision**: Created partial index `CREATE INDEX idx_jobs_reserved_expired ON jobs (status, expires_at) WHERE status = 'RESERVED'`.
- **Rationale**: Cleanup queries only target active pending reservations that have passed their `expires_at` timestamp. Filtering out `COMPLETED`, `FAILED`, and `EXPIRED` rows keeps the index small and lookups near-instantaneous.

---

## Implementation & Testing Verification

### Concurrency Safety Proof
To prove that the cleanup mechanism can run on multiple machines concurrently without race conditions:
- **Simulation**: Created an integration test (`tests/integration/concurrency.test.js`) spawning 4 concurrent worker promises using `Promise.all()`.
- **Validation**:
  1. Exactly 10 expired jobs were processed in total.
  2. Each job was locked and processed by exactly 1 worker instance (0 duplicate releases).
  3. User `reserved` balance dropped to 0 without calculation errors.
  4. Exactly 10 immutable `RELEASE` ledger entries were generated with unbroken hash chains.

---

## Outcome Summary

- **Total Test Pass Rate**: 13/13 passing tests (`node --test`).
- **Operational Readiness**: Delivered `bin/cleanup-reservations.js` runnable via `npm run job:cleanup`.