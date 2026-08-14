# Engineering Log: Module B4 — Zero-Downtime Job Audit Notes & Safe Schema Evolution

**Module Name**: Module B4 (Per-Job Audit Note Capability & Production Schema Migration)  
**Project**: Credit Ledger System  
**Completion Status**: Fully Implemented, Integrated, and Verified (25/25 Passing Tests)  

---

## Module Summary

Module B4 introduces an operational audit note capability to individual jobs on a live production ledger system. The enhancement was achieved without taking downtime, without altering or invalidating existing API contracts, and without violating database-level terminal immutability triggers.

- **Additive Schema Evolution**: Created the `job_audit_notes` table and supporting indexes with zero downtime using non-locking `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` migration scripts.
- **Terminal State Decoupling**: Implemented the audit notes mechanism outside of the core `jobs` table, allowing operators and auditors to append notes to jobs in any state (`RESERVED`, `COMPLETED`, `FAILED`, `EXPIRED`) without triggering the `prevent_job_modification` PostgreSQL trigger.
- **Zero-Downtime Migration Runner**: Extended `src/config/migrate.js` to track sequential, versioned migrations idempotently via a new `schema_migrations` tracking table.
- **REST Endpoints & Validation**: Exposed `POST /jobs/:id/notes` and `GET /jobs/:id/notes`, backed by strict input validation (`ValidationError` -> `400 Bad Request`) and relational existence checks (`NotFoundError` -> `404 Not Found`).

---

## Chronological Development & AI Engineering Log

### Phase 1: Database Migration Strategy & Immutability Analysis
- **Context & Constraints**:
  - The `jobs` table has a strict immutability trigger (`prevent_job_modification`) that raises exception `P0001` on any `UPDATE` or `DELETE` when a job reaches a terminal state (`COMPLETED`, `FAILED`, `EXPIRED`).
  - Directly altering the `jobs` table with an `audit_notes` column would either restrict note creation on finished jobs or require weakening the immutability trigger.
- **Architectural Decision**:
  - Apply the **Expand and Contract pattern**: Decouple the audit trail into a dedicated, normalized table `job_audit_notes` with a foreign key reference to `jobs(id)`.
  - Created migration file `db/migrations/002_add_job_audit_notes.sql` and updated `db/schema.sql`.

### Phase 2: Schema Migration Runner Implementation
- **Implementation**:
  - Updated `src/config/migrate.js` to create and maintain an atomic `schema_migrations` tracking table.
  - Ensured all migrations in `db/migrations/*.sql` run sequentially within a database transaction block (`BEGIN ... COMMIT`) and record applied versions to prevent duplicate execution across distributed application instances.

### Phase 3: Domain Service, Error Class, and Controller Implementation
- **Implementation**:
  - Created `src/services/jobNote.service.js` implementing `addNote(jobId, note, author)` and `getNotesByJobId(jobId)`.
  - Added `ValidationError` to `src/errors/AppError.js` to distinguish input validation failures (HTTP 400) from unexpected server errors.
  - Added controller functions `addJobNote` and `getJobNotes` in `src/controllers/jobs.controller.js`.
  - Registered route bindings in `src/app.js` using `validateUUIDParam('id')`.

### Phase 4: Test Suite Integration & Bug Resolution
- **Issue 1 (Error Constructor Mismatch)**:
  - During test execution, `assert.rejects` received `BadRequestError` when expecting `ValidationError` due to fallback resolution.
  - *Fix*: Exported `ValidationError` cleanly from `src/errors/AppError.js` and imported it directly into `jobNote.service.js`.
- **Issue 2 (Immutable Ledger Deletion in Test Tear-Down)**:
  - Integration test teardown failed with error `27000 (CRITICAL AUDIT ERROR: Ledger history is immutable)` because `tests/integration/auditNotes.test.js` attempted to run `DELETE FROM ledger_entries`.
  - *Fix*: Updated test teardown to only delete rows from mutable tables (`job_audit_notes`), honoring the ledger immutability trigger.

---

## Verification & Testing Matrix

| Module | Test File | Test Case | Invariant / Behavior Tested | Status |
| :--- | :--- | :--- | :--- | :--- |
| **B4** | `tests/integration/auditNotes.test.js` | Note on Active Job | Successfully appends an audit note to a `RESERVED` job | `PASS` |
| **B4** | `tests/integration/auditNotes.test.js` | Note on Terminal Job | Appends audit note to a `COMPLETED` job without violating triggers | `PASS` |
| **B4** | `tests/integration/auditNotes.test.js` | Non-Existent Job Check | Rejects note creation on unknown job UUID with `404 Not Found` | `PASS` |
| **B4** | `tests/integration/auditNotes.test.js` | Empty Note Validation | Rejects empty and whitespace-only note payload with `400 Bad Request` | `PASS` |
| **All**| `tests/**/*.test.js` | Regression Suite | All 25 tests across all 7 suites pass without regression | `PASS` |

---

## Final Architectural State
```
┌────────────────────────────────────────────────────────┐
                  │                   CLIENT HTTP API                      │
                  └──────────────────────────┬─────────────────────────────┘
                                             │
              ┌──────────────────────────────┴─────────────────────────────┐
              ▼                                                            ▼
[ Existing Core Job Routes ]                                 [ Module B4: Audit Note Routes ]
- POST /jobs                                                 - POST /jobs/:id/notes
- GET  /jobs/:id                                             - GET  /jobs/:id/notes
- POST /jobs/:id/complete                                                  │
- POST /jobs/:id/fail                                                      │
              │                                                            ▼
              │                                              ┌───────────────────────────┐
              │                                              │    JobNoteService         │
              │                                              │ - Job existence check     │
              │                                              │ - Input validation        │
              │                                              │ - Chronological retrieval │
              │                                              └─────────────┬─────────────┘
              ▼                                                            │
┌───────────────────────────┐                                              │
│      LedgerService        │                                              │
│ - Balance reservations    │                                              │
│ - Hash chain generation   │                                              │
└─────────────┬─────────────┘                                              │
              │                                                            │
              └──────────────────────────────┬─────────────────────────────┘
                                             │
                                             ▼
                   ┌──────────────────────────────────────────────────┐
                   │               PostgreSQL Database                │
                   │                                                  │
                   │ ┌────────────────┐         ┌───────────────────┐ │
                   │ │     jobs       │◀──1:N───│  job_audit_notes  │ │
                   │ │ (Immutable on  │         │ (Append-Only Log, │ │
                   │ │ terminal state)│         │  Zero Locks)      │ │
                   │ └────────────────┘         └───────────────────┘ │
                   │ ┌────────────────┐         ┌───────────────────┐ │
                   │ │ ledger_entries │         │schema_migrations  │ │
                   │ │ (SHA-256 Chain)│         │ (Version Tracker) │ │
                   │ └────────────────┘         └───────────────────┘ │
                   └──────────────────────────────────────────────────┘
```