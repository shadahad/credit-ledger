# Credit Ledger — Secure Provider Webhooks & AI Job Runner (Modules B3 & B7)

## Summary
This release implements **Module B3 (Hostile Network Webhook Provider)** and **Module B7 (AI Job Runner and Result Retrieval)** on top of the provable, immutable credit ledger. It provides end-to-end job execution by integrating real AI text APIs, safe multi-instance concurrency controls, replay-resistant and tamper-evident webhook delivery, and post-execution result retrieval.

---

## Design Decisions & Core Guarantees

### 1. State Ownership (Module B3 vs Module B7)
> **State ownership:** The Runner (B7) and Webhook (B3) both finalize jobs through atomic database transactions (`SELECT ... FOR UPDATE`); whichever settles the job first claims the terminal state (`COMPLETED` or `FAILED`), and subsequent attempts on that job are harmless no-ops.

### 2. Hostile Network Defense (Module B3)
- **HMAC SHA-256 Signatures**: Incoming webhook requests on `POST /webhooks/provider` require an `x-signature` header computed against the raw payload and the shared `WEBHOOK_SECRET`.
- **Timing-Safe Verification**: Cryptographic signatures are verified using `crypto.timingSafeEqual` to prevent side-channel timing attacks.
- **Replay Attack Resistance**: Every delivery carries an `eventId`. Unique event IDs are recorded atomically in the database (`processed_webhooks`); repeat deliveries return an idempotent `200 OK` response without duplicate ledger entries.

### 3. Concurrency & Distributed Isolation (Module B7)
- **Zero Double-Processing / Double-Charging**: Workers lock pending jobs using PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`. Multiple runner instances operate concurrently without deadlocking, duplicating work, or double-charging user balances.
- **Offline Test Suite Compliance**: The entire test suite runs with 100% offline isolation by stubbing the AI client, while live API execution is demonstrable via dedicated CLI scripts.
- **Graceful Failure Handling**: If an external AI provider fails or rates limits, the job transitions to `FAILED`, the error message is recorded, and reserved credits are safely returned via a `RELEASE` ledger entry.

---

## Architectural Assumptions

1. **At-Least-Once Delivery**: External providers may resend identical events multiple times or with network delay. The ledger treats event processing as idempotent.
2. **Provider Key Secrecy**: The `AI_API_KEY` and `WEBHOOK_SECRET` are managed strictly via environment variables and never committed to version control.
3. **Pluggable AI Endpoint**: The AI client assumes OpenAI-compatible HTTP endpoints (e.g., OpenAI, Groq, OpenRouter) and can be configured with custom endpoints and models.

---

## Data Model Separation Note

- **Jobs Table (`jobs`)**: Stores user-submitted prompts, the current job status (`RESERVED`, `COMPLETED`, `FAILED`, `EXPIRED`), expiration timestamps, and the produced output (`result`).
- **Ledger Entries Table (`ledger_entries`)**: A distinct, immutable audit log maintaining point-in-time balances and cryptographic SHA-256 hash chaining (`TOPUP`, `RESERVE`, `COMMIT`, `RELEASE`, `REFUND`).
- **Processed Webhooks Table (`processed_webhooks`)**: Dedicated table recording incoming provider `eventId` records to enforce webhook idempotency independently of the job state.

---

## Changes Made

1. **Database Schema (`db/schema.sql`)**:
   - Added `result TEXT NULL` to the `jobs` table to persist produced AI responses and error descriptions.
   - Added `processed_webhooks` table with primary key `event_id` for replay protection.
2. **Ledger Service (`src/services/ledger.service.js`)**:
   - Updated `completeJob` and `failJob` to accept result payloads and support harmless resolution (`{ throwOnConflict: false }`) for background workers.
3. **Webhook Subsystem (`src/middleware/verifyWebhookSignature.js`, `src/services/webhook.service.js`, `src/controllers/webhook.controller.js`)**:
   - Added HMAC SHA-256 signature verification middleware and idempotency-backed webhook handler.
4. **AI Runner Subsystem (`src/services/ai.client.js`, `src/services/runner.service.js`, `bin/demo-runner.js`)**:
   - Created AI API client, `SKIP LOCKED` distributed worker runner, and live demonstration CLI script.
5. **Jobs API (`src/controllers/jobs.controller.js`, `src/app.js`)**:
   - Added `GET /jobs/:id` route to retrieve job metadata and produced output.
   - Configured `express.json` raw-body retention for HMAC validation.
6. **Automated Integration Tests**:
   - Added `tests/integration/webhook.test.js` (B3 security, replay protection, ledger commits).
   - Added `tests/integration/runner.test.js` (B7 AI runner execution, concurrency locking, and failure recovery).

---

## Prerequisites

- **Node.js**: `v18.x` or higher
- **PostgreSQL**: `v14.x` or higher
- **Environment Variables**:
  - `DATABASE_URL`: PostgreSQL connection string.
  - `WEBHOOK_SECRET`: Shared secret for HMAC SHA-256 webhook signatures.
  - `AI_API_KEY`: API key for AI text generation.
  - `AI_API_URL`: Optional (default: `https://api.openai.com/v1/chat/completions`).
  - `AI_MODEL`: Optional (default: `gpt-4o-mini`).

---

## How to Run and Test

### 1. Database Setup
```bash
# Initialize schema, triggers, and indexes
npm run db:setup