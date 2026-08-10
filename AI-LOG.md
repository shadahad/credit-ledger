# AI Log & Steering Documentation

## 1. Initial Approach & Architectural Strategy
Before generating code, we established strict invariants for financial ledgers:
- Balance constraints (`balance >= reserved` and `balance >= 0`) must be enforced directly at the Postgres engine level via SQL `CHECK` constraints, ensuring external updates cannot break state consistency.
- Race conditions during credit reservation are mitigated using explicit transaction isolation (`SELECT ... FOR UPDATE` row locking) inside PostgreSQL.
- API separation: No SQL Foreign Key constraints link jobs to user balances. This decoupling permits future database split/sharding.

## 2. Execution Order
1. **Schema & Constraints**: Wrote SQL schema with CHECK constraints and an explicit `BEFORE UPDATE OR DELETE` Postgres trigger to enforce job immutability once finalized (`COMPLETED` or `FAILED`).
2. **TDD Test Suite First**: Wrote test cases in `tests/` using Node 18 native `node:test` covering prompt injection, unit edge cases, double completion, and high concurrency.
3. **Core Services**: Implemented `prompt.service.js` and `ledger.service.js`.
4. **API Middleware & Routing**: Implemented Express layer with isolated validation and unified, non-leaking operational error handling.

## 3. Open Point Decisions
- **BigInt & Integer Credits**: Credits are modeled as whole integers using Postgres `BIGINT` to eliminate floating-point rounding errors.
- **Prompt Anonymization**: Implemented regex masking for email, phone numbers, and UUIDs alongside explicit neutralizing markers for prompt injection tokens (`[INST]`, `<|im_start|>`).

## 4. Rejections & Corrections
- **AI Suggested Foreign Key**: Initially, the AI suggested `CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)`.
  - **Reason for Rejection**: Violates Requirement 9 (separable databases with no foreign keys).
  - **Correction**: Removed FK constraint and managed user existence verification in the transaction domain logic.
- **AI Suggested Dual Statement Update**: AI suggested `UPDATE users SET balance = balance - cost` followed by a separate `UPDATE users SET reserved = reserved - cost`.
  - **Reason for Rejection**: Creates atomicity windows during execution.
  - **Correction**: Consolidated balance and reservation adjustments into a single SQL statement inside an isolated transaction (`FOR UPDATE`).

## 5. Verification Steps
- Executed `npm test` verifying green status across unit, integration, and race-condition edge cases.
- Validated direct SQL updates that attempt to violate check constraints (e.g. forced setting of negative balance) are rejected by PostgreSQL.