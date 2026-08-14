# Module B4: Zero-Downtime Job Audit Notes & Production Schema Evolution

## Summary
Module B4 evolves the live credit ledger platform by introducing a lightweight, per-job audit note capability without taking downtime, breaking existing API contracts, or invalidating any existing automated tests. It demonstrates a safe, production-grade schema migration strategy that preserves database immutability rules, transactional performance, and backward compatibility across all system modules.

## Design Decisions & Core Guarantees

1. **Additive, Non-Breaking Schema Evolution (Expand & Contract Pattern)**:
   - All database changes are purely additive. Tables and indexes are provisioned using `IF NOT EXISTS` to avoid breaking existing queries or table structures.
   - Existing endpoint contracts (`POST /jobs`, `GET /jobs/:id`, `POST /jobs/:id/complete`, `POST /jobs/:id/fail`) remain completely unchanged.
2. **Terminal State Immutability Preservation**:
   - The `jobs` table enforces terminal state immutability via a PostgreSQL trigger (`prevent_job_modification`) that rejects `UPDATE` and `DELETE` queries on jobs in `COMPLETED`, `FAILED`, or `EXPIRED` states.
   - Placing audit notes into a dedicated `job_audit_notes` table allows operators and automated auditors to attach observations to completed or failed jobs without violating or altering database-level immutability triggers.
3. **Idempotent Migration Runner**:
   - Schema updates are tracked in a dedicated `schema_migrations` table inside an atomic transaction block (`BEGIN ... COMMIT`).
   - Running migrations on startup or across multiple distributed instances is safe, idempotent, and resilient against race conditions.
4. **Strict Input Validation**:
   - Empty or whitespace-only audit notes are rejected with `400 Bad Request` (`ValidationError`).
   - Audit note requests for non-existent job UUIDs return `404 Not Found` (`NotFoundError`).

## Architectural Assumptions

- **Financial Ledger Isolation**: Core credit movements (reservations, commits, releases, refunds) take lock precedence on the `users` and `jobs` tables. Operational auditing runs independently and never introduces table or row locks on active financial transactions.
- **Append-Only Auditing**: Audit notes are immutable, append-only chronological records of operator actions, AI routing diagnostics, and compliance verifications.
- **Zero Downtime**: Migrations introduce zero exclusive locks on hot tables, ensuring that high-throughput credit processing runs uninterrupted during deployments.

## Data Model Separation Note

Instead of altering the `jobs` table directly, which would lock the table and conflict with terminal immutability triggers, the audit capability is decoupled into its own relation:

## Changes Made

1. **Database Schema & Migrations**:
   - Added `db/migrations/002_add_job_audit_notes.sql` defining `job_audit_notes` and its index.
   - Updated `db/schema.sql` to include the new table and index for fresh database initializations.
   - Updated `src/config/migrate.js` to run and track versioned migrations via `schema_migrations`.
2. **Service Layer**:
   - Created `src/services/jobNote.service.js` with `addNote(jobId, note, author)` and `getNotesByJobId(jobId)`.
3. **Error Handling**:
   - Added `ValidationError` to `src/errors/AppError.js` mapping to HTTP 400.
4. **Controllers & Routing**:
   - Added `addJobNote` and `getJobNotes` methods to `src/controllers/jobs.controller.js`.
   - Registered `POST /jobs/:id/notes` and `GET /jobs/:id/notes` in `src/app.js`.
5. **Testing Suite**:
   - Added `tests/integration/auditNotes.test.js` covering note creation on active jobs, terminal-state jobs, non-existent job errors, and empty note validations.

## Prerequisites

- **Node.js**: `v18.0.0` or higher
- **PostgreSQL**: `v14` or higher
- Environment file (`.env`) with database connection parameters:
  ```env
  PORT=3000
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/credit_ledger
  WEBHOOK_SECRET=your-shared-webhook-secret

## How to Run and Test
1. Run Migrations & Start Server
#### Setup database and apply migrations
```npm run db:setup```

#### Start application server
```npm start```

2. Run Automated Test Suite
```npm test```

3. Manual Testing via curl (Git Bash)  
  **A. Create a Job**
   ```JOB_ID=$(curl -s -X POST http://localhost:3000/jobs \
   -H "Content-Type: application/json" \
   -d '{
    "userId": "11111111-1111-1111-1111-111111111111",
    "cost": 50,
    "prompt": "Analyze transaction risk profile"
    }' | grep -o '"id":"[^"]*' | head -n 1 | cut -d'"' -f4)

   echo "Job ID: $JOB_ID"```
  
  **B. Attach an Audit Note to an Active Job**
   ```
   curl -i -X POST http://localhost:3000/jobs/$JOB_ID/notes \
  -H "Content-Type: application/json" \
  -d '{
    "note": "Job routed to secondary worker pool for priority processing",
    "author": "ops-daemon"
  }'
   ```
  **C. Complete the Job (Terminal State)**
   ```
   curl -i -X POST http://localhost:3000/jobs/$JOB_ID/complete \
   -H "Content-Type: application/json" \
   -d '{"result": "Risk analysis complete: Low Risk."}'
   ```
  **D. Attach a Compliance Audit Note to the Completed Job**
   ```
   curl -i -X POST http://localhost:3000/jobs/$JOB_ID/notes \
  -H "Content-Type: application/json" \
  -d '{
    "note": "Post-completion compliance review verified.",
    "author": "auditor-01"
   }'
   ```
  **E. Attach a Compliance Audit Note to the Completed Job**
  ```curl -i -X GET http://localhost:3000/jobs/$JOB_ID/notes```