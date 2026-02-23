// clawser-memory.js — Semantic Memory (BM25 + Cosine Hybrid Search)
//
// Provides hybrid keyword + vector search for agent memory.
// Phase 1: Pure JS BM25 keyword search (replaces TF-IDF).
// Phase 2: Optional vector embeddings via pluggable EmbeddingProvider.
//
// Architecture:
//   Query → [Embed query] → BM25 keyword search + Cosine vector search
//         → Weighted merge (0.7 vector + 0.3 keyword) → Top-K results

// ── Cosine Similarity ─────────────────────────────────────────────

/**
 * Compute cosine similarity between two Float32Arrays.
 * Returns 0 for zero-length or zero-norm vectors.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} Similarity in [-1, 1]
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── BM25 Scorer ───────────────────────────────────────────────────

/**
 * Tokenize text into stems (lowercase, split on non-alpha, basic Porter-ish suffix strip).
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 1)
    .map(stem);
}

/**
 * Very basic English stemmer (strip common suffixes).
 * Not a full Porter stemmer but good enough for memory recall.
 * @param {string} word
 * @returns {string}
 */
function stem(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('tion') && word.length > 6) return word.slice(0, -4);
  if (word.endsWith('ness') && word.length > 6) return word.slice(0, -4);
  if (word.endsWith('ment') && word.length > 6) return word.slice(0, -4);
  if (word.endsWith('able') && word.length > 6) return word.slice(0, -4);
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * BM25 parameters.
 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * Compute BM25 scores for a query against a set of documents.
 * @param {string[]} queryTerms - Tokenized query
 * @param {Array<{id: string, tokens: string[], length: number}>} docs - Tokenized documents
 * @param {number} avgDl - Average document length
 * @returns {Map<string, number>} Document ID → BM25 score
 */
export function bm25Score(queryTerms, docs, avgDl) {
  const N = docs.length;
  if (N === 0 || queryTerms.length === 0) return new Map();

  // Document frequency for each query term
  const df = new Map();
  for (const term of queryTerms) df.set(term, 0);

  for (const doc of docs) {
    const termSet = new Set(doc.tokens);
    for (const term of queryTerms) {
      if (termSet.has(term)) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }
  }

  const scores = new Map();
  for (const doc of docs) {
    let score = 0;
    // Build term frequency map for this document
    const tf = new Map();
    for (const t of doc.tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    for (const term of queryTerms) {
      const termDf = df.get(term) || 0;
      const termTf = tf.get(term) || 0;
      if (termTf === 0) continue;

      // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);
      // TF component with length normalization
      const tfNorm = (termTf * (BM25_K1 + 1)) /
        (termTf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / avgDl)));
      score += idf * tfNorm;
    }

    if (score > 0) {
      scores.set(doc.id, score);
    }
  }

  return scores;
}

// ── Embedding Providers ───────────────────────────────────────────

/**
 * Base class for embedding providers.
 * Subclass and implement embed() for vector search support.
 */
export class EmbeddingProvider {
  /** @returns {string} Provider name */
  get name() { return 'base'; }
  /** @returns {number} Embedding dimensions */
  get dimensions() { return 0; }
  /**
   * Embed text into a vector.
   * @param {string} _text
   * @returns {Promise<Float32Array|null>}
   */
  async embed(_text) { return null; }
}

/**
 * No-op embedder for keyword-only mode.
 * Always returns null — disables vector search.
 */
export class NoopEmbedder extends EmbeddingProvider {
  get name() { return 'noop'; }
  get dimensions() { return 0; }
  async embed(_text) { return null; }
}

/**
 * Simple in-memory embedding cache (LRU).
 */
class EmbeddingCache {
  #cache = new Map();
  #maxSize;

  constructor(maxSize = 500) {
    this.#maxSize = maxSize;
  }

  get(key) {
    if (!this.#cache.has(key)) return undefined;
    const value = this.#cache.get(key);
    // Move to end (most recent)
    this.#cache.delete(key);
    this.#cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.#cache.has(key)) this.#cache.delete(key);
    this.#cache.set(key, value);
    if (this.#cache.size > this.#maxSize) {
      const oldest = this.#cache.keys().next().value;
      this.#cache.delete(oldest);
    }
  }

  get size() { return this.#cache.size; }
  clear() { this.#cache.clear(); }
}

// ── SemanticMemory ────────────────────────────────────────────────

/**
 * Hybrid keyword + vector memory store.
 * Stores entries in a flat array with BM25 keyword search
 * and optional cosine similarity vector search.
 */
export class SemanticMemory {
  /** @type {Array<{id: string, key: string, content: string, category: string, timestamp: number, embedding: Float32Array|null, meta: object|null}>} */
  #entries = [];
  #nextId = 1;
  /** @type {EmbeddingProvider} */
  #embedder;
  #embeddingCache = new EmbeddingCache(500);

  // Pre-computed tokenization for BM25
  /** @type {Map<string, {tokens: string[], length: number}>} */
  #tokenIndex = new Map();
  #avgDocLength = 0;

  /**
   * @param {EmbeddingProvider} [embedder] - Embedding provider (default: NoopEmbedder)
   */
  constructor(embedder) {
    this.#embedder = embedder || new NoopEmbedder();
  }

  /** Get the current embedder */
  get embedder() { return this.#embedder; }

  /** Set a new embedder (e.g., when user configures an API key) */
  set embedder(provider) {
    this.#embedder = provider || new NoopEmbedder();
    this.#embeddingCache.clear();
  }

  /** Number of stored entries */
  get size() { return this.#entries.length; }

  /**
   * Store a memory entry.
   * @param {object} entry - {key, content, category?, id?, timestamp?, meta?}
   * @returns {string} Assigned memory ID
   */
  store(entry) {
    const record = {
      id: '',
      key: entry.key || '',
      content: entry.content || '',
      category: entry.category || 'core',
      timestamp: entry.timestamp || Date.now(),
      embedding: entry.embedding || null,
      meta: entry.meta || null,
    };

    if (entry.id) {
      record.id = entry.id;
      const num = parseInt(record.id.replace('mem_', ''), 10);
      if (!isNaN(num) && num >= this.#nextId) {
        this.#nextId = num + 1;
      }
    } else {
      record.id = `mem_${this.#nextId++}`;
    }

    this.#entries.push(record);
    this.#updateTokenIndex(record);
    return record.id;
  }

  /**
   * Update the token index for a single entry.
   * @param {{id: string, key: string, content: string}} entry
   */
  #updateTokenIndex(entry) {
    // Key is weighted 2x by repeating its tokens
    const keyTokens = tokenize(entry.key);
    const contentTokens = tokenize(entry.content);
    const tokens = [...keyTokens, ...keyTokens, ...contentTokens];
    this.#tokenIndex.set(entry.id, { tokens, length: tokens.length });
    this.#recomputeAvgDocLength();
  }

  /** Recompute average document length across all entries */
  #recomputeAvgDocLength() {
    if (this.#tokenIndex.size === 0) {
      this.#avgDocLength = 0;
      return;
    }
    let total = 0;
    for (const { length } of this.#tokenIndex.values()) {
      total += length;
    }
    this.#avgDocLength = total / this.#tokenIndex.size;
  }

  /**
   * Get a memory entry by ID.
   * @param {string} id
   * @returns {object|null}
   */
  get(id) {
    return this.#entries.find(e => e.id === id) || null;
  }

  /**
   * Delete a memory entry by ID.
   * @param {string} id
   * @returns {boolean} true if deleted
   */
  delete(id) {
    const idx = this.#entries.findIndex(e => e.id === id);
    if (idx >= 0) {
      this.#entries.splice(idx, 1);
      this.#tokenIndex.delete(id);
      this.#recomputeAvgDocLength();
      return true;
    }
    return false;
  }

  /**
   * Get all entries (optionally filtered by category).
   * @param {string} [category]
   * @returns {Array<object>}
   */
  all(category) {
    if (category) return this.#entries.filter(e => e.category === category);
    return [...this.#entries];
  }

  /**
   * Clear all entries.
   */
  clear() {
    this.#entries = [];
    this.#nextId = 1;
    this.#tokenIndex.clear();
    this.#avgDocLength = 0;
    this.#embeddingCache.clear();
  }

  /**
   * Recall memories by hybrid search.
   * Empty query returns all entries with score 1.0.
   *
   * @param {string} query
   * @param {object} [opts]
   * @param {number} [opts.limit=20] - Max results
   * @param {string} [opts.category] - Filter by category
   * @param {number} [opts.minScore=0] - Minimum score threshold
   * @param {number} [opts.vectorWeight=0.7] - Weight for vector similarity
   * @param {number} [opts.keywordWeight=0.3] - Weight for BM25 keyword score
   * @returns {Promise<Array<{id: string, key: string, content: string, category: string, timestamp: number, score: number}>>}
   */
  async recall(query, opts = {}) {
    const {
      limit = 20,
      category = null,
      minScore = 0,
      vectorWeight = 0.7,
      keywordWeight = 0.3,
    } = opts;

    // Empty query returns all
    if (!query || query.trim() === '') {
      let results = this.#entries;
      if (category) results = results.filter(e => e.category === category);
      return results.map(e => ({ ...e, score: 1.0 })).slice(0, limit);
    }

    // Filter entries by category if needed
    let candidates = this.#entries;
    if (category) candidates = candidates.filter(e => e.category === category);
    if (candidates.length === 0) return [];

    // 1. BM25 keyword search
    const queryTerms = tokenize(query);
    const docs = candidates.map(e => ({
      id: e.id,
      ...(this.#tokenIndex.get(e.id) || { tokens: [], length: 0 }),
    }));
    const bm25Scores = bm25Score(queryTerms, docs, this.#avgDocLength || 1);

    // Normalize BM25 scores to [0, 1]
    const maxBm25 = Math.max(...bm25Scores.values(), 0.001);

    // 2. Vector search (if embedder is available)
    const vectorScores = new Map();
    const queryVec = await this.#getEmbedding(query);
    if (queryVec) {
      for (const entry of candidates) {
        if (entry.embedding) {
          const sim = cosineSimilarity(queryVec, entry.embedding);
          if (sim > 0) vectorScores.set(entry.id, sim);
        }
      }
    }

    // 3. Weighted merge
    const hasVectors = vectorScores.size > 0;
    const merged = new Map();

    for (const entry of candidates) {
      const bm25Raw = bm25Scores.get(entry.id) || 0;
      const bm25Norm = bm25Raw / maxBm25;
      const cosine = vectorScores.get(entry.id) || 0;

      let score;
      if (hasVectors) {
        score = (vectorWeight * cosine) + (keywordWeight * bm25Norm);
      } else {
        // Keyword-only mode: use full BM25 score
        score = bm25Norm;
      }

      if (score > 0) {
        merged.set(entry.id, {
          id: entry.id,
          key: entry.key,
          content: entry.content,
          category: entry.category,
          timestamp: entry.timestamp,
          score: Math.round(score * 1000) / 1000,
        });
      }
    }

    // Include high vector matches that BM25 missed
    if (queryVec) {
      for (const [id, cosine] of vectorScores) {
        if (!merged.has(id) && cosine > 0.5) {
          const entry = this.get(id);
          if (entry) {
            merged.set(id, {
              id: entry.id,
              key: entry.key,
              content: entry.content,
              category: entry.category,
              timestamp: entry.timestamp,
              score: Math.round(vectorWeight * cosine * 1000) / 1000,
            });
          }
        }
      }
    }

    // 4. Sort by score, filter, return top-K
    return [...merged.values()]
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get embedding for text, using cache.
   * @param {string} text
   * @returns {Promise<Float32Array|null>}
   */
  async #getEmbedding(text) {
    if (this.#embedder instanceof NoopEmbedder) return null;

    const key = text.trim().toLowerCase();
    const cached = this.#embeddingCache.get(key);
    if (cached !== undefined) return cached;

    const vec = await this.#embedder.embed(text);
    if (vec) this.#embeddingCache.set(key, vec);
    return vec;
  }

  /**
   * Generate and store embedding for an entry.
   * @param {string} id - Memory entry ID
   * @returns {Promise<boolean>} true if embedding was stored
   */
  async embedEntry(id) {
    const entry = this.get(id);
    if (!entry) return false;
    const text = `${entry.key} ${entry.content}`;
    const vec = await this.#embedder.embed(text);
    if (vec) {
      entry.embedding = vec;
      return true;
    }
    return false;
  }

  /**
   * Backfill embeddings for all entries that don't have one.
   * @param {function} [onProgress] - Called with (completed, total) after each entry
   * @returns {Promise<number>} Number of entries embedded
   */
  async backfillEmbeddings(onProgress) {
    if (this.#embedder instanceof NoopEmbedder) return 0;
    let count = 0;
    const total = this.#entries.filter(e => !e.embedding).length;
    for (const entry of this.#entries) {
      if (!entry.embedding) {
        const ok = await this.embedEntry(entry.id);
        if (ok) count++;
        if (onProgress) onProgress(count, total);
      }
    }
    return count;
  }

  /**
   * Memory hygiene: deduplicate, archive old, purge stale.
   * @param {object} [opts]
   * @param {number} [opts.maxAge=2592000000] - Max age in ms (default 30 days)
   * @param {number} [opts.maxEntries=500] - Max entries to keep
   * @returns {number} Number of entries removed
   */
  hygiene(opts = {}) {
    const maxAge = opts.maxAge || 30 * 24 * 60 * 60 * 1000;
    const maxEntries = opts.maxEntries || 500;
    const now = Date.now();
    let removed = 0;

    // Deduplicate by category:key (keep newest)
    const seen = new Map();
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const entry = this.#entries[i];
      const dedupeKey = `${entry.category}:${entry.key}`;
      if (seen.has(dedupeKey)) {
        this.#entries.splice(i, 1);
        this.#tokenIndex.delete(entry.id);
        removed++;
      } else {
        seen.set(dedupeKey, i);
      }
    }

    // Purge old entries (skip core)
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const entry = this.#entries[i];
      if (entry.category !== 'core' && entry.timestamp && (now - entry.timestamp) > maxAge) {
        this.#entries.splice(i, 1);
        this.#tokenIndex.delete(entry.id);
        removed++;
      }
    }

    // Enforce max entries (remove oldest non-core first)
    if (this.#entries.length > maxEntries) {
      const sorted = [...this.#entries]
        .map((e, idx) => ({ ...e, _idx: idx }))
        .filter(e => e.category !== 'core')
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const toRemove = this.#entries.length - maxEntries;
      const removeSet = new Set(sorted.slice(0, toRemove).map(e => e._idx));
      for (let i = this.#entries.length - 1; i >= 0; i--) {
        if (removeSet.has(i)) {
          this.#tokenIndex.delete(this.#entries[i].id);
          this.#entries.splice(i, 1);
          removed++;
        }
      }
    }

    if (removed > 0) this.#recomputeAvgDocLength();
    return removed;
  }

  /**
   * Import entries from the flat-array format used by the old memory system.
   * @param {Array<{id?: string, key: string, content: string, category?: string, timestamp?: number}>} entries
   * @returns {number} Number of entries imported
   */
  importFromFlatArray(entries) {
    let count = 0;
    for (const entry of entries) {
      const { score, ...clean } = entry; // strip score pollution
      this.store(clean);
      count++;
    }
    return count;
  }

  /**
   * Export all entries as a plain array (for persistence).
   * Embeddings are excluded (they're re-computable).
   * @returns {Array<object>}
   */
  exportToFlatArray() {
    return this.#entries.map(e => ({
      id: e.id,
      key: e.key,
      content: e.content,
      category: e.category,
      timestamp: e.timestamp,
      meta: e.meta,
    }));
  }

  /**
   * Serialize for JSON persistence (includes embeddings as base64).
   * @returns {object}
   */
  toJSON() {
    return {
      version: 1,
      entries: this.#entries.map(e => ({
        ...e,
        embedding: e.embedding ? arrayToBase64(e.embedding) : null,
      })),
      nextId: this.#nextId,
    };
  }

  /**
   * Restore from serialized JSON.
   * @param {object} data
   * @param {EmbeddingProvider} [embedder]
   * @returns {SemanticMemory}
   */
  static fromJSON(data, embedder) {
    const mem = new SemanticMemory(embedder);
    if (!data || !Array.isArray(data.entries)) return mem;
    for (const entry of data.entries) {
      const record = {
        ...entry,
        embedding: entry.embedding ? base64ToArray(entry.embedding) : null,
      };
      mem.store(record);
    }
    if (data.nextId) mem.#nextId = data.nextId;
    return mem;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Convert Float32Array to base64 string.
 * @param {Float32Array} arr
 * @returns {string}
 */
function arrayToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string back to Float32Array.
 * @param {string} b64
 * @returns {Float32Array}
 */
function base64ToArray(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}
