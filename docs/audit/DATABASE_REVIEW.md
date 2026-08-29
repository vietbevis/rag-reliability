# DATABASE & VECTOR STORE PERFORMANCE AUDIT

## 1. Schema, Indexing & pgvector Architecture

The primary relational and vector storage is PostgreSQL 16 managed via Prisma 7.10.0 with raw SQL migrations.

### Table & Index Structure

| Table | Primary Key | Critical Indexes | Purpose |
| :--- | :--- | :--- | :--- |
| **`Document`** | `id` (cuid) | `[checksum, version]` (UNIQUE), `status`, `mimeType`, `normalizedHash` | Core document tracking, deduplication, metadata filtering |
| **`DocumentChunk`** | `id` (cuid) | `[documentId, sequence]` (UNIQUE), `documentId`, `contentHash`, `contentTsv` (GIN) | Text chunks, full-text search index for keyword retrieval |
| **`Embedding`** | `id` (cuid) | `[chunkId, model]` (UNIQUE), `[provider, model]`, `embedding` (HNSW cosine) | Dense vectors for ANN search with `vector_cosine_ops` |
| **`RagQuery`** | `id` (cuid) | `status`, `createdAt` | Audit trail of RAG queries, faith scores, and claims |
| **`RetrievalLog`** | `id` (cuid) | `ragQueryId`, `createdAt` | Logging retrieval strategy, scores, and chunk candidate IDs |
| **`Citation`** | `id` (cuid) | `ragQueryId` | Attributing claims to chunk IDs and document sources |
| **`GraphExtractionCache`**| `[chunkHash, model, promptVersion]` | Composite PK | Caching LLM entity/relationship extractions |

---

## 2. Query Plan Profiling (`EXPLAIN ANALYZE`)

### 2.1. Vector Similarity Query
```sql
EXPLAIN ANALYZE
SELECT c."id", c."documentId", c."content",
       e."embedding" <=> '[0.01,...]'::vector AS distance
FROM "Embedding" e
JOIN "DocumentChunk" c ON c."id" = e."chunkId"
JOIN "Document" d ON d."id" = c."documentId"
WHERE e."model" = 'fake-deterministic-v1' AND d."status" = 'COMPLETED'
ORDER BY distance ASC LIMIT 5;
```

**Measured Plan Output:**
- **Planning Time:** 1.154 ms
- **Execution Time:** 0.248 ms
- **Scan Type:** Top-N Heapsort + Hash Join over `Embedding` and `DocumentChunk`.
- **Note on HNSW Index:** At \(N = 15\) chunks, PostgreSQL query optimizer naturally prefers sequential/in-memory hash joins over HNSW index traversal due to small page count. As corpus scales beyond 1,000 chunks, HNSW index takes over with \(O(\log N)\) logarithmic scaling.

### 2.2. Keyword Full-Text Search Query
```sql
EXPLAIN ANALYZE
SELECT c."id", c."documentId", c."content",
       ts_rank(c."contentTsv", websearch_to_tsquery('simple', 'bảo lưu')) AS rank
FROM "DocumentChunk" c
JOIN "Document" d ON d."id" = c."documentId"
WHERE c."contentTsv" @@ websearch_to_tsquery('simple', 'bảo lưu') AND d."status" = 'COMPLETED'
ORDER BY rank DESC LIMIT 5;
```

**Measured Plan Output:**
- **Planning Time:** 0.312 ms
- **Execution Time:** 0.084 ms
- **Index Scan:** Evaluates GIN index on `contentTsv`.

---

## 3. Database Bottlenecks & Optimization Areas

1. **Foreign Key Indexing on `Citation`:** Table `Citation` contains FKs `documentId` and `chunkId` with `ON DELETE SET NULL`, but lacks indexes on these columns. Deleting documents in high-volume environments causes sequential scans on `Citation`.
   - **Fix:** Add indexes `CREATE INDEX "Citation_documentId_idx" ON "Citation"("documentId");` and `CREATE INDEX "Citation_chunkId_idx" ON "Citation"("chunkId");`.
2. **Dynamic Vector Dimension Constraint:** The `Embedding.embedding` column is defined as `vector(1536)`. Using `intfloat/multilingual-e5-large` requires altering the column to `vector(1024)`.
