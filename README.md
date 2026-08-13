# Module B2: Abandoned Reservations Clean Up

Part of the **Credit Ledger REST API** system. This module provides a robust, distributed-safe cleanup mechanism for credit reservations that have been abandoned (e.g., a job starts, but its result never arrives).

It guarantees that expired reservations are safely released and credited back to the user without double-spending, race conditions, or duplicate releases—even when multiple cleanup processes run simultaneously across different machines.

---

## Problem Statement & Solution

### The Problem
When a user initiates a task, credits are placed in a `RESERVED` state. If a job crashes, times out, or its result never arrives, those reserved credits remain locked indefinitely, leaving the user's available balance inaccurate.

### The Solution
1. **Automated Expiration**: Jobs default to an expiration timestamp (`expires_at`).
2. **Distributed Safety**: Cleanup uses PostgreSQL **`FOR UPDATE SKIP LOCKED`** row-level locking. Multiple worker nodes or CronJobs can execute cleanup concurrently without locking each other out or double-releasing funds.
3. **Ledger Integrity**: Every released reservation writes a cryptographically linked `RELEASE` record to `ledger_entries` (preserving Module B1 tamper-evidence).
4. **Ops Executable**: Shipped as a standalone CLI command (`npm run job:cleanup`) for operations teams, Kubernetes CronJobs, or systemd timers.

---

## Database Architecture

- **`jobs` table additions**:
  - `expires_at`: `TIMESTAMPTZ` indicating when a reservation times out.
  - `status`: ENUM featuring `'RESERVED'`, `'COMPLETED'`, `'FAILED'`, and `'EXPIRED'`.
- **Partial Compound Index**:
  ```sql
  CREATE INDEX idx_jobs_reserved_expired 
  ON jobs (status, expires_at) 
  WHERE status = 'RESERVED';