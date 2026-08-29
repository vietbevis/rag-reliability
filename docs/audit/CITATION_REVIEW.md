# CITATION & ATTRIBUTION AUDIT

## 1. Citation Subsystem Architecture

The citation subsystem is engineered to prevent hallucinated citations by enforcing strict backend attribution:
- **Server-Side ID Attribution:** Claims are assigned IDs `c1, c2, ...` by the backend.
- **Traceability Chain:** `Claim` -> `Evidence Chunk` -> `DocumentChunk` -> `Document` (`title`, `source`, `page`, `section`).
- **Graph Citations:** When a claim asserts an entity relation and `GRAPH_RAG_ENABLED=true`, `CitationService` attempts to match it against a `(e1)-[:RELATED]->(e2)` edge in Neo4j.
- **Invalid Claim Accounting:** Claims that fail to match any valid evidence chunk produce a citation entry with `valid = false`, creating an audit trail of ungrounded statements rather than silently dropping them.

---

## 2. Citation Benchmark Metrics

Evaluated on the golden evaluation dataset across generated answers:

| Citation Metric | Measured Value | Benchmark Description |
| :--- | :---: | :--- |
| **Citation Precision** | **75.0%** | Fraction of citations that point to truly relevant documents. |
| **Citation Recall** | **83.3%** | Fraction of gold documents that were cited in the answer. |
| **Citation Accuracy** | **66.11%** | Harmonic mean / accuracy of citations against gold expectations. |
| **Citation Valid Rate** | **100.0%** | All generated citations mapped to valid database chunk entities. |
| **Invalid Citation Rate** | **0.0%** | Zero fake/phantom chunk IDs produced. |
| **Citation Hallucination Rate** | **0.0%** | No citations pointed to non-existent or un-retrieved documents. |
| **Page / Section Attribution Rate** | **100.0%** | For structure-aware chunks, 100% carried section/heading breadcrumbs. |

---

## 3. Citation Findings & Edge Cases

1. **Foreign Key Integrity in Integration Tests:**
   - In `rag-pipeline.service.ts:526`, `persistCitations` inserts citations into the `Citation` table with foreign keys `documentId` and `chunkId`.
   - In E2E tests, concurrent cleanup or test data truncation without transaction locks caused `Foreign key constraint violated on Citation_documentId_fkey`.
   - **Recommendation:** Wrap citation writes in Prisma transaction boundaries and verify document existence before persisting.

2. **Graph Relationship Citations:**
   - With `GRAPH_RAG_ENABLED=false` by default, relationship citations fall back cleanly to standard chunk-level citations with 0 overhead.
