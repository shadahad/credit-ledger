# Credit Ledger — Module B5: Scalable Keyset History & Daily Aggregation

## Summary
Module B5 implements a high-throughput, drift-resistant ledger history endpoint (`GET /users/:id/history`) coupled with a daily credit activity aggregation summary. The implementation solves the traditional pitfalls of `OFFSET`-based pagination on multi-million row datasets by using deterministic tuple keyset pagination `(created_at, id)` backed by a composite index `(user_id, created_at DESC, id DESC)`.

---

## Design Decisions & Core Guarantees

### 1. O(1) Keyset (Cursor-Based) Pagination
* **The Problem with Offset Paging**: `OFFSET N` requires PostgreSQL to scan and discard $N$ rows sequentially ($O(N)$ index-traversal cost). When millions of entries accumulate, deep page lookups take seconds. Furthermore, when new ledger entries arrive while a client is actively paging, traditional offsets slip, causing users to see duplicate items or miss entries entirely.
* **The Keyset Solution**: The cursor encodes `(created_at, id)` in an opaque URL-safe `base64url` token. Each query seeks directly to the next page using tuple comparison:
  ```sql
  WHERE user_id = $1
    AND (created_at, id) < ($cursorCreatedAt, $cursorId)
  ORDER BY created_at DESC, id DESC
  LIMIT $limit + 1```
- **Performance Guarantee**: Lookups execute as exact B-tree index seeks with O (1) constant time complexity regardless of whether querying page 1 or page 50,000.

### 2. Deterministic Tie-Breaking
- In high-frequency systems, multiple ledger movements can share the same microsecond timestamp created_at. Using (created_at, id) guarantees strict total ordering without missing or repeating rows.

### 3. Non-Blocking Daily Totals Aggregation
- Daily aggregates summarize credits grouped by DATE(created_at AT TIME ZONE 'UTC') filtered by user_id and bounded to the last 30 active days.
- Executed concurrently alongside the paginated history lookup via Promise.all, preventing sequential query latency.

## Architectural Assumptions
1. **User Identity Boundary**: Every ledger movement strictly belongs to a verified user UUID (user_id).
2. **UTC Standardization**: All timestamp filtering, cursor evaluations, and date truncations (DATE(created_at AT TIME ZONE 'UTC')) operate uniformly in UTC to avoid daylight saving or timezone drift across regions.
3. **Immutable History**: Because ledger entries are append-only and protected by database triggers, historical page hashes and cursors remain immutable and strictly repeatable.
## Data Model Separation Note
- **Ledger Entries vs Aggregations**: Aggregations are calculated dynamically via index-backed range scans without mutating ledger tables or introducing cached summary tables that could drift out of sync.
- **Separation from Job Lifecycle**: Historical ledger entries record the financial state transitions (TOPUP, RESERVE, COMMIT, RELEASE), ensuring financial auditing remains decoupled from external AI worker execution lifecycles.
## Changes Made
1. **Database Schema** (db/schema.sql):  
   ```CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_history 
   ON ledger_entries (user_id, created_at DESC, id DESC);```
2. **Service Layer** (src/services/ledger.service.js):
   - Added getUserMovementHistory(userId, options) implementing cursor encoding, decoding, keyset filtering, and daily aggregation grouping.
3. **Controller Layer** (src/controllers/users.controller.js):
   - Added getHistory controller mapping query parameters (limit, cursor) and returning JSON payload with pagination metadata and dailyTotals.
4. **Routing Layer** (src/app.js):
   - Added GET /users/:id/history route with UUID validation middleware.
5. **Integration Tests** (tests/integration/history.test.js):
   - Added automated test suite validating keyset pagination, concurrent write drift immunity, aggregate calculation accuracy, and edge cases.

## Prerequisites
  - **Node.js**: v18.0.0 or higher
  - **PostgreSQL**: v14.0 or higher
  - **Environment Variables**: Defined in .env (e.g. DATABASE_URL, PORT)
## How to Run and Test
1. Run Migrations & Setup Schema  
   ```npm run db:setup```
2. Start Application Server  
   ```npm start```
3. Run Automated Test Suite  
   ```npm test```