# Credit Ledger REST API

A lightweight, standalone REST API built with Node.js, Express, and PostgreSQL that provides atomic transaction control for user credit balance reservations and job processing.

## Design Decisions & Guarantees

- **Strict Balance Invariants**:
	Total credits equation: Available = Balance - Reserved.
	PostgreSQL CHECK (balance >= 0) and CHECK (reserved <= balance) constraints ensure balance integrity at the database engine layer.
- **Race Condition Immunity**:
	Jobs reserve credits using SELECT FOR UPDATE locks within atomic transactions (BEGIN ... COMMIT).
	Simultaneous requests attempting to overspend credits are rejected safely without race condition windows.
- **Immutability of Terminal Jobs**:
	Completed or Failed jobs cannot be modified or charged again, enforced both via logic and Postgres database triggers (prevent_job_modification).
- **Sanitization & Anonymization**:
	PII (emails, phone numbers, UUIDs) are stripped from incoming job prompts. System override tags ([INST], ignore instructions) are neutralized prior to persistence.

## Architectural Assumptions
- User accounts are provisioned via separate identity systems (seeded user provided for testing: 11111111-1111-1111-1111-111111111111).
- Credits are whole integers without fractional amounts.

## Data Model Separation Note
If this system expands, the User Ledger database (users balance and ledger logs) and the Runner/Job Execution database (jobs and execution artifacts) would be decoupled into separate physical databases, communicating via asynchronous events or transactional messaging. They stay coupled inside single local transactions only for exact balance reservation checks and immediate row-level locking during ledger deduction, whereas job state transitions after reservation complete independently.

## Summary of Completed Invariants

- **Strict Financial Invariants**: PostgreSQL database-level CHECK constraints (balance >= 0, reserved >= 0, reserved <= balance) guarantee that even raw SQL queries outside the application cannot overspend balance.
- **Concurrency Safety**: SELECT ... FOR UPDATE row locking inside database transactions isolates concurrent reservations, ensuring parallel jobs never spend unreserved funds.
- **Immutability Trigger**: A PL/pgSQL database trigger (prevent_job_modification) prevents updating or deleting jobs in COMPLETED or FAILED states.
- **Decoupled Architecture**: No foreign key links the users and jobs tables (Requirement 9), enabling future database sharding/separation.
- **Prompt Injection & PII Redaction**: PII markers (emails, UUIDs, phone numbers) are stripped, and system prompt override patterns are neutralized prior to storage.
---

## Prerequisites
- Node.js v18+
- PostgreSQL server

## Setup Instructions

1. **Clone project and install dependencies**:
   ```Bash
   npm install

2. **Copy .env.example to .env and Configure Environment Variables**:
   ```Bash
   cp .env.example .env

## Test API
   ```Bash
   npm test
   
## OR run all tests with Node native test runner
   ```Bash
   node --test --test-concurrency=1 tests/**/*.test.js

## OR run test one by one with Node native test runner   
   ### Run only prompt sanitization unit tests
   ```Bash
   node --test tests/unit/prompt.test.js

   ### Run only ledger integration tests
   ```Bash
   node --test tests/integration/ledger.test.js

   ### Run only concurrency tests
   ```Bash
   node --test tests/integration/concurrency.test.js

## Start/Run/Use API
1. ```Bash
   npm start  

2. Open a second Git Bash window within the project folder   
   ```Bash (Check user balance - It shows the balance and 0 reserved amount)
   curl -X GET http://localhost:3000/users/<UserId>/balance
   
   ```Bash (Post a new job)
   curl -X POST http://localhost:3000/jobs \
    -H "Content-Type: application/json" \
    -d '{
    "userId": "UUID 36-character text string",
    "cost": 30,
    "prompt": "Analyze sales report for Q3"
   }'

   ```Bash (Check user balance - It shows the balance and the reserved amount)
   curl -X GET http://localhost:3000/users/:id/balance
   
   ```Bash (Complete the job)
   curl -X POST http://localhost:3000/jobs/<JobId>/complete

   ```Bash (Check user balance - It shows the remaining balance and 0 reserved amount)
   curl -X GET http://localhost:3000/users/<UserId>/balance

   ```Bash (Post another new job)
   curl -X POST http://localhost:3000/jobs \
    -H "Content-Type: application/json" \
    -d '{
    "userId": "UUID 36-character text string",
    "cost": 20,
    "prompt": "Generate image of a cat"
   }'

   ```Bash (Check user balance - It shows the balance and the reserved amount)
   curl -X GET http://localhost:3000/users/:id/balance

   ```Bash (Fail the job)
   curl -X POST http://localhost:3000/jobs/<JobId>/fail

   ```Bash (Check user balance - It shows the balance (no-charges) and 0 reserved amount)
   curl -X GET http://localhost:3000/users/<UserId>/balance


