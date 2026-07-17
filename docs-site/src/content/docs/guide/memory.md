---
title: "Memory"
---

BM25, vector search, embedding backends, categories, dedup, purging, hybrid recall

---

### SemanticMemory

**Status:** ✅ Implemented · **Category:** memory-engine · **Since:** v1.0.0

Hybrid search memory system combining BM25 keyword matching (synchronous) and cosine similarity vector search (async embeddings). Stores memories with categories, automatic deduplication, and cleanup hygiene. Approximately 903 LOC. Supports import/export, serialization, and embedding backfill.

**Source files:**

- `web/clawser-memory.js`
- `web/clawser-memory.d.ts`

**API surface:**

- `SemanticMemory`
- `SemanticMemory.store`
- `SemanticMemory.get`
- `SemanticMemory.update`
- `SemanticMemory.delete`
- `SemanticMemory.all`
- `SemanticMemory.clear`
- `SemanticMemory.recall`
- `SemanticMemory.embedEntry`
- `SemanticMemory.backfillEmbeddings`
- `SemanticMemory.hygiene`
- `SemanticMemory.importFromFlatArray`
- `SemanticMemory.exportToFlatArray`
- `SemanticMemory.toJSON`
- `SemanticMemory.fromJSON`
- `SemanticMemory.clearEmbeddingCache`

> **Note:** recall() performs BM25 first (sync), then optionally vector search (async) if an embedding provider is configured. Results are merged and deduplicated.

**See also:**

- BM25 Search
- Vector Search
- Embedding Providers

---

### BM25 Search

**Status:** ✅ Implemented · **Category:** search · **Since:** v1.0.0

Synchronous BM25 keyword search for fast initial memory retrieval. Tokenizes queries and documents, computes term frequency and inverse document frequency scores. Used as the primary recall mechanism when no embedding provider is configured.

**Source files:**

- `web/clawser-memory.js`
- `web/clawser-memory.d.ts`

**API surface:**

- `bm25Score`
- `tokenize`

---

### Vector Search

**Status:** ✅ Implemented · **Category:** search · **Since:** v1.0.0

Cosine similarity vector search using pre-computed embeddings. Compares query embedding against stored memory embeddings for semantic matching. Requires an active embedding provider.

**Source files:**

- `web/clawser-memory.js`
- `web/clawser-memory.d.ts`

**API surface:**

- `cosineSimilarity`

---

### Embedding Provider Base

**Status:** ✅ Implemented · **Category:** embeddings · **Since:** v1.0.0

Abstract base class for embedding providers. Defines the interface with name, dimensions, and embed() method returning Float32Array vectors.

**Source files:**

- `web/clawser-memory.js`
- `web/clawser-memory.d.ts`

**API surface:**

- `EmbeddingProvider`
- `EmbeddingProvider.name`
- `EmbeddingProvider.dimensions`
- `EmbeddingProvider.embed`

---

### NoopEmbedder

**Status:** ✅ Implemented · **Category:** embeddings · **Since:** v1.0.0

No-operation embedder that always returns null. Used as the default when no embedding provider is configured. BM25 search still works without embeddings.

**Source files:**

- `web/clawser-memory.js`

**API surface:**

- `NoopEmbedder`

---

### OpenAI Embedding Provider

**Status:** ✅ Implemented · **Category:** embeddings · **Since:** v1.0.0

Embedding provider using OpenAI's text-embedding-ada-002 or text-embedding-3-small API. Requires an OpenAI API key. Returns 1536-dimensional vectors.

**Source files:**

- `web/clawser-memory.js`
- `web/clawser-memory.d.ts`

**API surface:**

- `OpenAIEmbeddingProvider`

> **Note:** Default model is text-embedding-ada-002 (1536 dimensions).

---

### Chrome AI Embedding Provider

**Status:** ✅ Implemented · **Category:** embeddings · **Since:** v1.5.0

On-device embedding provider using Chrome's built-in AI embedding API. Runs entirely locally with no API key required. Requires Chrome 127+ with AI features.

**Source files:**

- `web/clawser-memory.js`
- `web/clawser-memory.d.ts`

**API surface:**

- `ChromeAIEmbeddingProvider`
- `ChromeAIEmbeddingProvider.isAvailable`

> **Note:** Requires Chrome with AI features enabled. Fully local inference.

---

### Transformers.js Embedding Provider

**Status:** ✅ Implemented · **Category:** embeddings · **Since:** v1.5.0

Client-side embedding provider using Hugging Face Transformers.js. Runs models directly in the browser via WASM/WebGPU. No API key required.

**Source files:**

- `web/clawser-memory.js`
- `web/clawser-memory.d.ts`

**API surface:**

- `TransformersEmbeddingProvider`
- `TransformersEmbeddingProvider.isAvailable`

> **Note:** Uses ONNX models loaded via CDN. Runs in browser via WASM.

---

### Memory Categories

**Status:** ✅ Implemented · **Category:** categories · **Since:** v1.0.0

Four memory categories for organizing stored knowledge: core (system-critical), learned (discovered facts), user (user-stated preferences), and context (session-specific). Categories can be used as filters during recall.

**Source files:**

- `web/types.d.ts`
- `web/clawser-memory.d.ts`

**API surface:**

- `MemoryCategory`

> **Note:** Categories: core, learned, user, context.

---

### Memory Deduplication

**Status:** ✅ Implemented · **Category:** dedup · **Since:** v1.0.0

Automatic deduplication during store operations. Detects near-duplicate entries by key and content similarity and merges or replaces them.

**Source files:**

- `web/clawser-memory.js`

**API surface:**

- `SemanticMemory.store`

---

### Memory Hygiene

**Status:** ✅ Implemented · **Category:** maintenance · **Since:** v1.0.0

Cleanup operations for memory maintenance. Removes expired entries based on max age, enforces maximum entry count, and purges orphaned embeddings. Can be triggered manually or automatically.

**Source files:**

- `web/clawser-memory.js`
- `web/clawser-memory.d.ts`
- `web/clawser-agent.js`
- `web/clawser-agent.d.ts`

**API surface:**

- `SemanticMemory.hygiene`
- `ClawserAgent.memoryHygiene`

> **Note:** Options: maxAge (ms), maxEntries (count).

---

### Memory Persistence

**Status:** ✅ Implemented · **Category:** persistence · **Since:** v1.0.0

Memory state is serialized to JSON and persisted to OPFS per-workspace. Includes all entries with their embeddings. Restored on workspace load.

**Source files:**

- `web/clawser-agent.js`

**API surface:**

- `persistMemories`
- `restoreMemories`

**See also:**

- Workspace Management

---

### Auto-Learning

**Status:** ⚠️ Partial · **Category:** auto-learning · **Since:** v1.0.0

The agent can be configured to automatically store learned facts and user preferences during conversation. Currently requires explicit tool calls; fully automatic extraction is planned.

**Source files:**

- `web/clawser-memory.js`

**API surface:**

- `memoryStore`

> **Note:** Enable via autonomy settings in the Config panel.

---

---

[← Shell](/docs/guide/shell/) | [Index](/docs/) | [Skills →](/docs/guide/skills/)
