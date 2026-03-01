/**
 * Type definitions for clawser-memory.js
 * Semantic Memory (BM25 + Cosine Hybrid Search)
 */

import type { MemoryCategory } from './types.d.ts';

// ── Cosine Similarity ──────────────────────────────────────────

export declare function cosineSimilarity(a: Float32Array, b: Float32Array): number;

// ── BM25 Scorer ────────────────────────────────────────────────

export declare function tokenize(text: string): string[];

export declare function bm25Score(
  queryTerms: string[],
  docs: Array<{ id: string; tokens: string[]; length: number }>,
  avgDl: number,
): Map<string, number>;

// ── Embedding Providers ────────────────────────────────────────

export declare class EmbeddingProvider {
  get name(): string;
  get dimensions(): number;
  embed(text: string): Promise<Float32Array | null>;
}

export declare class NoopEmbedder extends EmbeddingProvider {
  get name(): string;
  get dimensions(): number;
  embed(text: string): Promise<null>;
}

export interface OpenAIEmbeddingOpts {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

export declare class OpenAIEmbeddingProvider extends EmbeddingProvider {
  constructor(opts?: OpenAIEmbeddingOpts);
  get name(): string;
  get dimensions(): number;
  embed(text: string): Promise<Float32Array | null>;
}

export interface ChromeAIEmbeddingOpts {
  dimensions?: number;
}

export declare class ChromeAIEmbeddingProvider extends EmbeddingProvider {
  constructor(opts?: ChromeAIEmbeddingOpts);
  get name(): string;
  get dimensions(): number;
  isAvailable(): Promise<boolean>;
  embed(text: string): Promise<Float32Array | null>;
}

export declare class TransformersEmbeddingProvider extends EmbeddingProvider {
  get name(): string;
  get dimensions(): number;
  isAvailable(): Promise<boolean>;
  embed(text: string): Promise<Float32Array | null>;
}

// ── Memory Entry Shapes ────────────────────────────────────────

export interface MemoryRecord {
  id: string;
  key: string;
  content: string;
  category: string;
  timestamp: number;
  embedding: Float32Array | null;
  meta: Record<string, unknown> | null;
}

export interface MemoryRecallResult {
  id: string;
  key: string;
  content: string;
  category: string;
  timestamp: number;
  score: number;
}

export interface MemoryRecallOptions {
  limit?: number;
  category?: string | null;
  minScore?: number;
  vectorWeight?: number;
  keywordWeight?: number;
}

export interface MemoryHygieneOptions {
  maxAge?: number;
  maxEntries?: number;
}

export interface MemoryStoreInput {
  key: string;
  content: string;
  category?: MemoryCategory | string;
  id?: string;
  timestamp?: number;
  embedding?: Float32Array | null;
  meta?: Record<string, unknown> | null;
}

export interface MemoryExportEntry {
  id: string;
  key: string;
  content: string;
  category: string;
  timestamp: number;
  meta: Record<string, unknown> | null;
}

export interface MemorySerializedData {
  version: number;
  entries: Array<MemoryRecord & { embedding: string | null }>;
  nextId: number;
}

// ── SemanticMemory ─────────────────────────────────────────────

export declare class SemanticMemory {
  constructor(embedder?: EmbeddingProvider);

  get embedder(): EmbeddingProvider;
  set embedder(provider: EmbeddingProvider | null);
  get size(): number;

  store(entry: MemoryStoreInput): string;
  get(id: string): MemoryRecord | null;
  update(id: string, updates: Partial<Pick<MemoryRecord, 'key' | 'content' | 'category' | 'meta'>>): boolean;
  clearEmbeddingCache(): void;
  delete(id: string): boolean;
  all(category?: string): MemoryRecord[];
  clear(): void;

  recall(query: string, opts?: MemoryRecallOptions): Promise<MemoryRecallResult[]>;
  embedEntry(id: string): Promise<boolean>;
  backfillEmbeddings(onProgress?: (completed: number, total: number) => void): Promise<number>;
  hygiene(opts?: MemoryHygieneOptions): number;

  importFromFlatArray(entries: Array<MemoryStoreInput & { score?: number }>): number;
  exportToFlatArray(): MemoryExportEntry[];

  toJSON(): MemorySerializedData;
  static fromJSON(data: MemorySerializedData | null, embedder?: EmbeddingProvider): SemanticMemory;
}
