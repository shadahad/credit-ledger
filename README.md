# Module B1 - Verifiable Credit Ledger

Establish a complete, immutable record of every credit movement. Every transaction is cryptographically linked using SHA-256 hash chaining to ensure total state traceability.

## Design Decisions & Core Guarantees
This system operates on a Zero-Trust Financial Architecture: critical invariants are enforced at the PostgreSQL engine level and verified through cryptographic proofs, ensuring data integrity even if application logic is bypassed or SQL is executed directly.
1. ### Hard Guarantees
   - **Zero-Overspend Guarantee**: PostgreSQL CHECK constraints (balance >= 0, reserved >= 0, reserved <= balance) prevent overdrafts at the database engine level.
   - **Concurrency Safety**: Explicit SELECT ... FOR UPDATE row locks inside atomic transactions isolate parallel requests and prevent race conditions or double-spending.
   - **Uncompromised Immutability**: PL/pgSQL database triggers block UPDATE and DELETE queries on ledger_entries and finalized jobs (COMPLETED / FAILED).
   - **Cryptographic Tamper-Evidence**: Every credit movement writes a SHA-256 hashed ledger record linked to the previous entry (Hn = SHA256(Hn - 1 || data)).
   - **Shard-Ready Architecture**: Decoupled table structures with zero foreign keys enable horizontal database partitioning by user_id.
   - **Boundary PII & Injection Defense**: Strips emails, UUIDs, phone numbers, and prompt-override patterns prior to database storage.
2. ### Key Architectural Decisions
   | Decision | Why It Was Made | Benefit |
   | --- | --- | --- |
   | **Database-Level Invariants** | Application code can have bugs or bypasses. | Raw SQL queries outside the app cannot overspend or mutate history.|
   |**SHA-256 Hash Chaining**|Rogue DB admins or compromised credentials could modify logs.|Retroactive record editing breaks the chain and fails audit checks.|
   |**Dual-State Accounting**|Calculating balance from millions of logs creates O(N) read latency.|Fast O(1) balance reads in users with O(N) verifiable replay proof via ledger_entries.|
   |**Pessimistic Row Locking** (FOR UPDATE)|Parallel job reservations can create race conditions.|Guarantees strict serialization without complex retry loops.|
   |**Zero Foreign Keys**|FKs block microservice isolation and horizontal scaling.|Systems can shard users and jobs across distinct database nodes.|
3. ### Security & Threat Mitigation
   |Threat Vector|System Mitigation|
   |---|---|
   |**Direct DB Editing / Rogue Admin**|Invalidates SHA-256 signature chain; flagged instantly by /users/:id/audit.|
   |**Race Conditions / Double-Spend**|Sequenced via FOR UPDATE lock; excess reservations rejected by DB constraint.|
   |**Prompt Injection Attacks**|System override patterns neutralized at the boundary layer before storage.|
   |**Accidental Record Deletion**|Rejected by BEFORE UPDATE OR DELETE database triggers (ERRCODE 27000).|
### Architectural Assumptions
- **PostgreSQL as Source of Truth**: Relies on PostgreSQL's strict ACID compliance, PL/pgSQL engine, and row-level locking (FOR UPDATE) for state safety.
- **Upstream Identity Validation**: Assumes caller authentication and ID existence (user_id, job_id) are validated at the API boundary, enabling a decoupled schema with no foreign keys.
- **Monotonic Transaction Time**: Relies on database clock consistency (TIMESTAMPTZ) to maintain chronological ordering for cryptographic hash chaining.
- **Read/Write Access Pattern**: Designed for high-frequency O(1) live balance updates in the users table, with historical audit replays executed on-demand or via background workers.
### Data Model Separation Note
> Zero Foreign Key Constraint Design

 This architecture intentionally omits database-level FOREIGN KEY constraints between the users, jobs, and ledger_entries tables, referencing records strictly through logical **UUIDs**.
#### Why This Choice Was Made:
1. **Sharding & Horizontal Scalability**: Allows users, jobs, and audit logs to be partitioned or split across separate physical database instances or microservices as volume grows, without relational cross-node blocking.
2. **Domain Isolation**: Prevents cascading locks and schema coupling, allowing job processing and user billing domains to evolve independently.
3. **High-Throughput Writes**: Eliminates constraint-lookup overhead on high-frequency insertions into ledger_entries.
#### How Integrity Is Maintained:
- **Application Boundary Validation**: Foreign identifiers are validated before transaction execution.
- **Atomic Transactions & Row Locking**: Concurrent operations lock hot rows using SELECT ... FOR UPDATE explicitly.
- **Cryptographic Verification**: Auditability is proven through immutable SHA-256 hash chains rather than relational relational integrity checks.
### Prerequisites
1. **Clone the Repository**
```Bash
git clone https://github.com/your-username/credit-ledger.git
```
2. **Configure Environment Variables**

Ensure .env contains PostgreSQL settings:
   ```Env
   PORT=3000
   NODE_ENV=development
   DATABASE_URL=postgres://username:password@localhost:5432/credit_ledger
   ```
3. **Initialize the Database Schema**

Run schema.sql against your PostgreSQL database to create tables, ENUM types, constraints, indexes, and immutability triggers:

  Using psql CLI:
  ```Bash
  psql -d credit_ledger -f db/schema.sql
  ```
  Optional: Seed initial test data
  ```Bash
  psql -d credit_ledger -f db/seed.sql
  ```
4. **Run the Test Suite**
   ```Bash
   npm test
   ```
5. **Start the REST API Server**
   
   Production mode
   ```Bash
    npm start
    ```
   Development mode (with auto-reload) 
   ```Bash
       npm run dev
   ```
The server will start at http://localhost:3000
### How to Run a Clean Audit Test
To maintain mathematical provability, credit additions must be logged in ledger_entries via topUpUser.

Run this script in **Git Bash** to create a fresh user, top up 100 credits through the ledger, execute a job, and verify the audit trail:
#### Run in Git Bash:
1. Create a fresh test user ID
   ```Bash
   NEW_USER_ID="a1234567-89ab-cdef-0123-456789abcdef"
   ```
2. Insert user into DB with 0 balance
   ```Bash
   psql "postgres://username:password@localhost:5432/credit_ledger" -c \
   "INSERT INTO users (id, balance, reserved) VALUES ('$NEW_USER_ID', 0, 0) ON CONFLICT (id) DO NOTHING;"
   ```
3. Top-Up 100 credits via Node script (writes TOPUP entry to ledger_entries)
   ```Bash
   node -e "
   const ledgerService = require('./src/services/ledger.service');
   ledgerService.topUpUser('$NEW_USER_ID', 100).then(() => {
   console.log('Top-up successful!');
   process.exit(0);
   });
   "
  ```
4. Create and Reserve a Job for 35 credits
   ```Bash
   JOB_RES=$(curl -s -X POST "http://localhost:3000/jobs" \
   -H "Content-Type: application/json" \
   -d "{\"userId\": \"$NEW_USER_ID\", \"cost\": 35, \"prompt\": \"Generate report\"}")

   JOB_ID=$(echo $JOB_RES | grep -oP '"id":"\K[^"]+')
   echo "Created Job ID: $JOB_ID"
   ```
5. Complete the Job
   ```Bash
   curl -s -X POST "http://localhost:3000/jobs/$JOB_ID/complete"
   ```
6. Verify the Audit Trail
   ```Bash
   curl -s -X GET "http://localhost:3000/users/$NEW_USER_ID/audit"
   ```