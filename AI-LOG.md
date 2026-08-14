# AI-LOG: Implementation of Modules B3 & B7

**Module Name**: Module B3 (Hostile Network Webhook Provider) & Module B7 (AI Job Runner and Result Retrieval)  
**Project**: Credit Ledger  
**Completion Status**: Completed & Fully Verified (21/21 Tests Passing)  

---

## Module Summary

Modules B3 and B7 establish the complete lifecycle of job execution and settlement for the Credit Ledger system:
1. **Module B3 (Provider Webhook Security)**: Provides a hardened webhook endpoint (`POST /webhooks/provider`) resilient to hostile network conditions (replay attacks, unauthorized requests, and payload tampering) using constant-time HMAC SHA-256 signature verification and atomic `eventId` idempotency logging.
2. **Module B7 (AI Runner & Result Retrieval)**: Implements an AI text completion client and a distributed background worker using PostgreSQL row locks (`SELECT FOR UPDATE SKIP LOCKED`). It guarantees that pending jobs are executed without race conditions or double-charging, records produced outputs in the database, allows output retrieval via `GET /jobs/:id`, and runs 100% offline during automated testing.

---

## Chronological Development & AI Engineering Log

### Step 1: Schema & Data Model Evolution
- **Objective**: Store AI execution outputs and track incoming webhook event identifiers for replay resistance.
- **Actions**:
  - Updated `db/schema.sql` to add `result TEXT NULL` to the `jobs` table.
  - Added `processed_webhooks` table with `event_id VARCHAR(255) PRIMARY KEY` and foreign key reference to `jobs(id)`.
  - Maintained PostgreSQL immutability triggers (`trg_prevent_job_modification` and `trg_prevent_ledger_tampering`).

### Step 2: Ledger Service Harmonization (`src/services/ledger.service.js`)
- **Objective**: Harmonize state transitions between the Runner (B7), Webhook (B3), and Reservation Cleaner (B2).
- **Actions**:
  - Updated `completeJob(jobId, result, options)` and `failJob(jobId, reason, options)` to persist result output into `jobs.result`.
  - Added `{ throwOnConflict = true }` support: API endpoints throw strict `ConflictError` on terminal jobs, while background workers (Runner/Webhook) pass `{ throwOnConflict: false }` to exit harmlessly as no-ops without double-spending.

### Step 3: Module B3 Webhook Architecture & Middleware
- **Objective**: Build hostile network defenses for provider webhooks.
- **Actions**:
  - Configured `express.json` with a custom `verify` callback in `src/app.js` to preserve `req.rawBody`.
  - Created `src/middleware/verifyWebhookSignature.js` using `crypto.createHmac('sha256', secret)` and `crypto.timingSafeEqual`.
  - Created `src/services/webhook.service.js` implementing atomic insertion into `processed_webhooks` for replay prevention and delegating terminal state settlement to `ledger.service.js`.
  - Added route `POST /webhooks/provider` in `src/app.js`.

### Step 4: Module B7 AI Client, Runner & Job Retrieval
- **Objective**: Execute jobs via real AI APIs, support concurrent multi-instance runners, and retrieve outputs.
- **Actions**:
  - Built `src/services/ai.client.js` accepting `AI_API_KEY`, `AI_API_URL`, and `AI_MODEL` environment variables.
  - Created `src/services/runner.service.js` using `SELECT ... FOR UPDATE SKIP LOCKED` for concurrency isolation.
  - Added `GET /jobs/:id` in `src/controllers/jobs.controller.js` to expose job metadata and outputs.
  - Implemented `bin/demo-runner.js` for standalone operational runs.

### Step 5: Test Development & Debugging Iterations
- **Issue 1: `AppError is not a constructor`**
  - *Diagnosis*: `AppError.js` exported an object of named error classes (`{ AppError, BadRequestError, UnauthorizedError, ... }`).
  - *Resolution*: Updated imports in middleware and services to extract named subclasses with resilient fallbacks.
- **Issue 2: Test teardown failure against immutability triggers**
  - *Diagnosis*: `tests/integration/webhook.test.js` attempted `DELETE FROM jobs` and `DELETE FROM ledger_entries` in `after()`, violating PostgreSQL trigger rules.
  - *Resolution*: Replaced raw `DELETE` operations with safe async `server.close()` promises, relying on UUID isolation.
- **Issue 3: Test runner picking up prior leftover reservations**
  - *Diagnosis*: Earlier integration tests left `RESERVED` jobs in the shared test database, causing global `ORDER BY created_at ASC` queries to claim stale jobs from previous suites.
  - *Resolution*: Extended `claimAndProcessNextJob({ userId })` with an optional `userId` filter for test isolation while keeping global sweeps as default.

---

## Verification & Testing Matrix

| Test Suite | File | Tests | Status | Key Assertions Verified |
|---|---|---|---|---|
| **Provable Ledger & Audit** | `tests/integration/audit.test.js` | 3 | **PASSED** | Hash chaining, trigger tamper resistance, audit trail verification |
| **Concurrency & Isolation** | `tests/integration/concurrency.test.js` | 4 | **PASSED** | Balance limits under race conditions, conflict errors on double-complete, distributed B2 cleanup |
| **Ledger Core Integration** | `tests/integration/ledger.test.js` | 4 | **PASSED** | Job reservation, balance deductions, release on failure, credit limits |
| **Module B7: AI Runner** | `tests/integration/runner.test.js` | 3 | **PASSED** | Single-spend claim via `SKIP LOCKED`, concurrent multi-worker isolation, AI error handling & release |
| **Module B3: Webhook Security** | `tests/integration/webhook.test.js` | 5 | **PASSED** | 401 on missing signature, 403 on forged signature, valid HMAC completion, replay idempotency, failure refund |
| **Prompt Sanitization** | `tests/unit/prompt.test.js` | 2 | **PASSED** | PII redaction, prompt injection token blocking |
| **Total** | **6 Suites** | **21 Tests** | **ALL PASSED** | **100% Pass Rate (36.3s full suite runtime)** |

---