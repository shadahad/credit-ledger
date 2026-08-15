## Module B8: Frontend Interface

### Overview & Architecture Choices
- **Zero Build / Vanilla Web Stack**: Built using standard semantic HTML5, CSS3, and JavaScript (ES6+), served directly by Express via `express.static('public')`.
- **Client-Side Cryptography**: Uses the browser's native **Web Crypto API** (`crypto.subtle`) to calculate HMAC-SHA256 signatures for webhook testing without third-party dependencies.
- **Why this fits**:
  - Requires no build tools (`webpack`, `vite`, `npm run build`), keeping CI/CD pipelines instant and zero-dependency.
  - Eliminates client hydration overhead and bundle bloat for a focused operations console.
- **Core Flows Implemented**:
  1. **Balance Lookup & Account Top-Up**: Real-time checking of available and reserved credit balances for any User UUID, plus live balance credit additions via `POST /users/topup`.
  2. **Job Execution & Live Polling**: Submitting jobs with UUID, cost, and prompt text, immediately capturing reservations, and continuously polling job status until `COMPLETED` or `FAILED` without full-page reloads.
  3. **Job Lifecycle Management & Audit Notes**: Direct inspection of raw job records (`GET /jobs/:id`), manual state transitions (`POST /jobs/:id/complete` and `/fail`), and appending/viewing immutable audit notes (`POST/GET /jobs/:id/notes`).
  4. **Cryptographic Audit & Movement History**: One-click verification of SHA-256 hash chain proofs (`GET /users/:id/audit`), raw ledger entry inspection (`GET /users/:id/ledger`), and cursor-paginated movement history with daily aggregates (`GET /users/:id/history`).
  5. **Provider Webhook Simulator**: Generating RFC-compliant HMAC-SHA256 digests in-browser to simulate external provider deliveries to `POST /webhooks/provider` with valid `x-signature` headers.
  6. **Local Knowledge Store Search**: Interfacing directly with `GET /knowledge/search?q=...` to query and inspect top-3 deterministic semantic matches and prompt guidelines.

## API Reference Table

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the Module B8 Frontend Operations Console |
| `GET` | `/users/:id/balance` | Fetch real-time available and reserved credit balances |
| `POST` | `/users/topup` | Credit top-up endpoint appending to cryptographic ledger |
| `GET` | `/users/:id/audit` | Cryptographic audit proof recalculating user's complete SHA-256 hash chain |
| `GET` | `/users/:id/ledger` | Fetch raw append-only ledger entries for a user |
| `GET` | `/users/:id/history` | Keyset cursor-paginated movement history and daily aggregates |
| `POST` | `/jobs` | Create a job and atomically reserve credits |
| `GET` | `/jobs/:id` | Fetch job status, result output, and error state |
| `POST` | `/jobs/:id/complete` | Manually complete a job and capture reserved credits |
| `POST` | `/jobs/:id/fail` | Manually fail a job and release reserved credits back to available balance |
| `POST` | `/jobs/:id/notes` | Append an audit note to a job (Module B4) |
| `GET` | `/jobs/:id/notes` | Retrieve all audit notes for a specific job |
| `POST` | `/webhooks/provider` | Ingest external provider events with HMAC-SHA256 `x-signature` verification |
| `GET` | `/knowledge/search` | Search local deterministic knowledge store with top-3 relevance ranking |