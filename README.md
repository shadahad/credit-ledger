# Module B2: Abandoned Reservations Clean Up

## Summary
Module B2 introduces a distributed-safe, automated cleanup mechanism for abandoned credit reservations within the Credit Ledger API. When a job starts, its required credits are locked in a `RESERVED` state. If the job fails to report a result (due to timeouts, worker crashes, or network failures), Module B2 safely expires the reservation and restores the user's available credits.

The system ensures idempotency, concurrency safety across multiple worker nodes, and tamper-evident audit logging without double-spending or race conditions.

---

## Design Decisions & Core Guarantees

* **Distributed Concurrency via `FOR UPDATE SKIP LOCKED`**: Instead of relying on external lock managers (like Redis/Redlock), cleanup uses PostgreSQL row-level locking. Multiple concurrent worker instances automatically skip rows locked by active processes, eliminating race conditions, deadlocks, and duplicate releases.
* **Tamper-Evident Ledger Integrity (Module B1 Continuity)**: Every released reservation records an immutable `RELEASE` entry in `ledger_entries` using SHA-256 hash chaining (`prev_hash` -> `hash`).
* **Database-Enforced Immutability**: PostgreSQL triggers strictly block `UPDATE` or `DELETE` operations on `ledger_entries` and jobs in terminal states (`COMPLETED`, `FAILED`, `EXPIRED`).
* **Operational Readiness**: Delivered with a standalone CLI entry point (`bin/cleanup-reservations.js`) for scheduled execution via Kubernetes CronJobs, systemd timers, or manual Ops invocation.

---

## Architectural Assumptions

1. **ACID Database Guarantees**: PostgreSQL is the primary database providing transaction isolation and row-level locking.
2. **Explicit Expiration Window**: Every job created receives a default expiration timestamp (`expires_at`), defining the timeout threshold for non-arriving results.
3. **Common CommonJS Node Runtime**: Built for Node.js (v18+) using the native `node:test` runner and standard `pg` driver.

---

## Data Model Separation Note

* **Balance State (`users` table)**: Credits are strictly divided into `balance` (total funds owned) and `reserved` (funds encumbered by pending jobs). The available unencumbered balance is evaluated as `balance - reserved`.
* **Job State (`jobs` table)**: Jobs track state transitions (`RESERVED` -> `COMPLETED` / `FAILED` / `EXPIRED`).
* **Audit Source of Truth (`ledger_entries` table)**: Ledger entries are append-only audit records. Releasing an abandoned reservation decrements `users.reserved` and creates a `RELEASE` ledger entry, returning available purchasing power to the user without altering historical balance totals.

---

## Changes Made

* **Database Schema (`db/schema.sql`)**:
  * Added `expires_at TIMESTAMPTZ` column to `jobs`.
  * Added `'EXPIRED'` value to `job_status` ENUM.
  * Added partial index `idx_jobs_reserved_expired` on `(status, expires_at) WHERE status = 'RESERVED'` for millisecond sweep performance.
  * Updated trigger `prevent_job_modification()` to enforce `EXPIRED` as an immutable terminal state.
* **Ledger Service (`src/services/ledger.service.js`)**:
  * Added `releaseAbandonedReservations(batchSize)` method with atomic batching, row locking, and cryptographic hash logging.
* **Operations Tooling (`bin/cleanup-reservations.js` & `package.json`)**:
  * Created CLI executable and added `"job:cleanup"` script command to `package.json`.
* **Testing Suite (`tests/integration/concurrency.test.js`)**:
  * Added integration and multi-worker concurrent simulation tests verifying zero race conditions and correct ledger creation.

---

## Prerequisites

* **Node.js**: v18.0.0 or higher
* **PostgreSQL**: v12.0 or higher
* **Environment Variables**: Configured in `.env` (e.g., `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` or `DATABASE_URL`).

---

## How to Run and Test

### 1. Apply Database Schema
Initialize or update your PostgreSQL database schema:
```bash
npm run db:setup