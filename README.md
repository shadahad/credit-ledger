# Module B6: Knowledge Store, Semantic Retrieval, and Runner Context Enrichment

## Summary
Module B6 introduces an offline, deterministic semantic knowledge store and lookup mechanism into the Credit Ledger platform. It provides a REST endpoint (`GET /knowledge/search?q=...`) that returns the top 3 most relevant knowledge documents for any search query without external API or network dependencies. In addition, it integrates with the Job Runner (Module B7) to automatically retrieve prompt best practices and system guidelines based on the prompt of each reserved job and inject them as structured context into model execution.

## Design Decisions & Core Guarantees

1. **Deterministic Vector Space Model (TF-IDF + Cosine Similarity)**:
   - Meaning is represented using sublinear term-frequency inverse-document-frequency (TF-IDF) vector weights:
     $$\text{TF-IDF}(t, d) = (1 + \ln(\text{tf}(t, d))) \times \left(\ln\left(\frac{N + 1}{\text{df}(t) + 1}\right) + 1\right)$$
   - Queries and documents are mapped into sparse vector representations. Similarity is computed via the cosine angle between vectors.
   - Ranking is strictly deterministic: results are ordered by `score DESC`, using `id ASC` as an immutable tie-breaker.

2. **Zero-Dependency & Fully Offline Execution**:
   - The knowledge store runs locally in-process without contacting third-party embedding providers, ensuring test repeatability in completely isolated or air-gapped environments.

3. **Prompt Best Practice Grounding & Long Output Consistency**:
   - The runner leverages semantic lookup to match job prompts against established engineering guidelines (e.g., deterministic JSON output schemas, double-entry invariants, error fallbacks).
   - Ingesting relevant knowledge fragments into the prompt context mitigates hallucination and maintains stylistic consistency across complex or long generated outputs.

4. **Production Scaling Path**:
   - In production environments, the in-process TF-IDF vector space model can be swapped for dense embeddings (e.g., `text-embedding-3-small` or `bge-large-en`) persisted directly in PostgreSQL via the `pgvector` extension with HNSW (Hierarchical Navigable Small World) indexing for sub-millisecond approximate nearest neighbor (ANN) retrieval.
   - Hybrid search can be enabled by combining dense vector cosine similarity with PostgreSQL `tsvector` keyword search using Reciprocal Rank Fusion (RRF).

## Architectural Assumptions

1. **Corpus Size & In-Memory Efficiency**:
   - The local default corpus contains operational best practices and formatting standards suitable for in-memory indexing with instantaneous vector projection.
2. **Relevance Threshold**:
   - Only documents with positive cosine similarity (`score > 0`) are considered matches; queries matching no vocabulary terms safely return an empty result list `[]`.
3. **Execution Ownership (B3 vs. B7)**:
   - Module B7 Runner owns execution dispatch and job completion, while Module B3 handles external provider webhook callbacks; both paths safely handle state transition conflicts without double credit deductions.

## Data Model Separation Note

The knowledge store operates independently from the relational financial ledger schema:
- **Ledger Invariant Isolation**: Knowledge queries are read-only and generate zero side-effects or transactions on `users`, `jobs`, or `ledger_entries`.
- **Decoupled Knowledge Extension**: The knowledge corpus can be loaded statically from memory, file manifests, or separate knowledge base tables without requiring schema migrations or affecting the append-only cryptographic hash chain of financial records.

## Changes Made

- **`src/services/knowledge.service.js`**: Created the vector indexing engine with tokenization, stop-word elimination, TF-IDF calculation, cosine similarity, and corpus management.
- **`src/controllers/knowledge.controller.js`**: Created controller handling `GET /knowledge/search` with input validation and limit handling.
- **`src/app.js`**: Registered `GET /knowledge/search` endpoint.
- **`src/services/runner.service.js`**: Updated job claiming and execution pipelines to query relevant knowledge entries and inject formatted context blocks into AI generation tasks.
- **`tests/unit/knowledge.test.js`**: Added unit tests covering vector similarity, scoring, ranking determinism, edge cases, and dynamic document addition.
- **`tests/integration/knowledge.test.js`**: Added HTTP integration tests verifying query validation (400), response payloads (200), and custom limit bounds.

## Prerequisites

- **Node.js**: `v18.0.0` or higher
- **PostgreSQL**: `v14` or higher (for full application lifecycle)
- **Environment Variables**: Defined in `.env` (refer to `.env.example`)

## How to Run and Test

### 1. Run Automated Tests
```bash
# Run all unit and integration tests across the entire platform
npm test

# Run only Module B6 unit tests
node --test tests/unit/knowledge.test.js

# Run only Module B6 integration tests
node --test tests/integration/knowledge.test.js