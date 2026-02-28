/**
 * Type definitions for clawser-providers.js
 * LLM Provider implementations (v2)
 */

import type {
  ChatMessage,
  ChatResponse,
  TokenUsage,
  ToolSpec,
  ModelPricing,
  ErrorClassification,
} from './types.d.ts';

// ── Cost Estimation ────────────────────────────────────────────

export declare const MODEL_PRICING: Record<string, ModelPricing>;

export declare function estimateCost(model: string, usage: TokenUsage | undefined): number;

// ── Error Classification ───────────────────────────────────────

export type ErrorCategory = 'rate_limit' | 'server' | 'auth' | 'network' | 'client' | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  message: string;
}

export declare function classifyError(err: Error | string): ClassifiedError;

// ── Response Validation ────────────────────────────────────────

export declare function validateChatResponse(
  raw: unknown,
  fallbackModel?: string,
): ChatResponse;

// ── SSE Readers ────────────────────────────────────────────────

export interface SSEEvent {
  event: string | null;
  data: unknown;
  done?: boolean;
}

export declare function readSSE(response: Response): AsyncGenerator<SSEEvent, void, unknown>;
export declare function readAnthropicSSE(response: Response): AsyncGenerator<SSEEvent, void, unknown>;

// ── Stream Chunk Types ─────────────────────────────────────────

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; index: number; id: string; name: string }
  | { type: 'tool_delta'; index: number; arguments: string }
  | { type: 'done'; response: ChatResponse }
  | { type: 'error'; error: string };

// ── Response Cache ─────────────────────────────────────────────

export interface ResponseCacheStats {
  entries: number;
  maxEntries: number;
  ttlMs: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  tokensSaved: { input: number; output: number };
  costSaved: number;
}

export interface ResponseCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
}

export declare class ResponseCache {
  constructor(opts?: ResponseCacheOptions);

  enabled: boolean;
  ttl: number;
  maxEntries: number;
  get size(): number;
  get stats(): ResponseCacheStats;

  static hash(str: string): string;
  static cacheKey(messages: ChatMessage[], model: string): string;

  get(key: string): ChatResponse | null;
  set(key: string, response: ChatResponse, model: string): void;
  delete(key: string): void;
  clear(): void;
}

// ── Chat Request Shape ─────────────────────────────────────────

export interface LLMChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
}

export interface LLMChatOptions {
  max_tokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

// ── LLMProvider (abstract base) ────────────────────────────────

export declare class LLMProvider {
  get name(): string;
  get displayName(): string;
  get requiresApiKey(): boolean;
  get supportsStreaming(): boolean;
  get supportsNativeTools(): boolean;

  isAvailable(): Promise<boolean>;
  chat(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): Promise<ChatResponse>;
  chatStream(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown>;
}

// ── Tier 1: Built-in Providers ─────────────────────────────────

export declare class EchoProvider extends LLMProvider {
  get name(): string;
  get displayName(): string;
  chat(request: LLMChatRequest): Promise<ChatResponse>;
}

export declare class ChromeAIProvider extends LLMProvider {
  get name(): string;
  get displayName(): string;
  get supportsStreaming(): boolean;
  isAvailable(): Promise<boolean>;
  chat(request: LLMChatRequest): Promise<ChatResponse>;
  chatStream(request: LLMChatRequest): AsyncGenerator<StreamChunk, void, unknown>;
  resetSession(): void;
  destroyPool(): void;
}

export declare class OpenAIProvider extends LLMProvider {
  constructor(model?: string);
  get name(): string;
  get displayName(): string;
  get requiresApiKey(): boolean;
  get supportsStreaming(): boolean;
  get supportsNativeTools(): boolean;
  chat(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): Promise<ChatResponse>;
  chatStream(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown>;
}

export declare class AnthropicProvider extends LLMProvider {
  constructor(model?: string);
  get name(): string;
  get displayName(): string;
  get requiresApiKey(): boolean;
  get supportsStreaming(): boolean;
  get supportsNativeTools(): boolean;
  chat(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): Promise<ChatResponse>;
  chatStream(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown>;
}

// ── Tier 2: OpenAI-Compatible ──────────────────────────────────

export interface OpenAICompatibleConfig {
  baseUrl?: string;
  defaultModel?: string;
  displayName?: string;
  requiresApiKey?: boolean;
  nativeTools?: boolean;
  extraHeaders?: Record<string, string>;
}

export declare class OpenAICompatibleProvider extends LLMProvider {
  constructor(name: string, config?: OpenAICompatibleConfig);
  get name(): string;
  get displayName(): string;
  get requiresApiKey(): boolean;
  get supportsStreaming(): boolean;
  get supportsNativeTools(): boolean;
  isAvailable(): Promise<boolean>;
  chat(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): Promise<ChatResponse>;
  chatStream(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown>;
}

export interface OpenAICompatibleServiceConfig {
  baseUrl: string;
  defaultModel: string;
  displayName: string;
  requiresApiKey?: boolean;
  nativeTools?: boolean;
}

export declare const OPENAI_COMPATIBLE_SERVICES: Record<string, OpenAICompatibleServiceConfig>;

// ── Tier 3: ai.matey Provider ──────────────────────────────────

export declare class MateyProvider extends LLMProvider {
  constructor(backendType: string, config?: Record<string, unknown>);
  get name(): string;
  get displayName(): string;
  get requiresApiKey(): boolean;
  get supportsStreaming(): boolean;
  get supportsNativeTools(): boolean;
  chat(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): Promise<ChatResponse>;
  chatStream(
    request: LLMChatRequest,
    apiKey?: string,
    modelOverride?: string,
    options?: LLMChatOptions,
  ): AsyncGenerator<StreamChunk, void, unknown>;
}

// ── Provider Registry ──────────────────────────────────────────

export interface ProviderAvailabilityInfo {
  name: string;
  displayName: string;
  available: boolean;
  requiresApiKey: boolean;
  supportsStreaming: boolean;
  supportsNativeTools: boolean;
}

export declare class ProviderRegistry {
  register(provider: LLMProvider): void;
  get(name: string): LLMProvider | null;
  has(name: string): boolean;
  names(): string[];
  listWithAvailability(): Promise<ProviderAvailabilityInfo[]>;
}

export declare function createDefaultProviders(): ProviderRegistry;
