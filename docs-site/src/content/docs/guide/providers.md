---
title: "Providers"
---

All LLM providers, models, capabilities, and configuration

---

### Provider Registry

**Status:** ✅ Implemented · **Category:** registry · **Since:** v1.0.0

Pluggable provider architecture with register/get/remove semantics. ProviderRegistry manages all provider instances and exposes availability checking. Three-tier system allows mixing built-in, OpenAI-compatible, and CDN-loaded providers.

**Source files:**

- `web/clawser-providers.js`
- `web/clawser-providers.d.ts`

**API surface:**

- `ProviderRegistry`
- `ProviderRegistry.register`
- `ProviderRegistry.get`
- `ProviderRegistry.has`
- `ProviderRegistry.names`
- `ProviderRegistry.remove`
- `ProviderRegistry.listWithAvailability`
- `createDefaultProviders`

**See also:**

- LLMProvider Base Class

---

### LLMProvider Base Class

**Status:** ✅ Implemented · **Category:** base · **Since:** v1.0.0

Abstract base class for all LLM providers. Defines the common interface: chat() for single-shot completions, chatStream() for async generator streaming, and metadata properties (name, displayName, requiresApiKey, supportsStreaming, supportsNativeTools).

**Source files:**

- `web/clawser-providers.js`
- `web/clawser-providers.d.ts`

**API surface:**

- `LLMProvider`
- `LLMProvider.chat`
- `LLMProvider.chatStream`
- `LLMProvider.isAvailable`
- `LLMProvider.name`
- `LLMProvider.displayName`
- `LLMProvider.requiresApiKey`
- `LLMProvider.supportsStreaming`
- `LLMProvider.supportsNativeTools`

---

### EchoProvider

**Status:** ✅ Implemented · **Category:** tier-1-builtin · **Since:** v1.0.0

Testing provider that echoes back user messages. Does not require an API key. Useful for development and debugging without consuming API credits.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `EchoProvider`

> **Note:** Capabilities: streaming (yes), vision (no), tool_calls (no). No API key required.

---

### ChromeAIProvider

**Status:** ✅ Implemented · **Category:** tier-1-builtin · **Since:** v1.0.0

Chrome built-in AI provider using Gemini Nano. Runs entirely on-device via Chrome's AI APIs. Supports streaming. No API key required but requires Chrome with AI features enabled.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `ChromeAIProvider`

> **Note:** Capabilities: streaming (yes), vision (no), tool_calls (no). Requires Chrome 127+ with AI features.

---

### OpenAIProvider

**Status:** ✅ Implemented · **Category:** tier-1-builtin · **Since:** v1.0.0

OpenAI API provider supporting GPT-4, GPT-4o, GPT-3.5-turbo, and other OpenAI models. Full support for streaming via SSE, native tool use, and vision (multimodal input).

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAIProvider`
- `readSSE`

> **Note:** Capabilities: streaming (yes), vision (yes for GPT-4o/V), tool_calls (yes). Models: gpt-4, gpt-4o, gpt-4-turbo, gpt-3.5-turbo, o1, o1-mini.

---

### AnthropicProvider

**Status:** ✅ Implemented · **Category:** tier-1-builtin · **Since:** v1.0.0

Anthropic Claude API provider supporting Claude 3.5 Sonnet, Claude 3 Opus/Haiku, and newer models. Full support for streaming via Anthropic SSE format, native tool use, and vision (multimodal input).

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `AnthropicProvider`
- `readAnthropicSSE`

> **Note:** Capabilities: streaming (yes), vision (yes), tool_calls (yes). Models: claude-3.5-sonnet, claude-3-opus, claude-3-haiku, claude-3-sonnet.

---

### OpenAICompatibleProvider

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

Generic provider for any OpenAI-compatible API endpoint. Used as the base for Tier 2 providers. Configurable base URL, model list, and capabilities.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`
- `OPENAI_COMPATIBLE_SERVICES`

> **Note:** OPENAI_COMPATIBLE_SERVICES defines pre-configured endpoints for: Groq, OpenRouter, Together AI, Fireworks, Mistral, DeepSeek, xAI (Grok), Perplexity, Ollama, LM Studio, Lepton, and others. Each has base URL, default models, and capability flags.

---

### Groq

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

Groq inference API — ultra-fast LPU-based inference for Llama, Mixtral, and Gemma models.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

> **Note:** Capabilities: streaming (yes), vision (varies), tool_calls (yes). Fast inference.

---

### OpenRouter

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

OpenRouter aggregator — routes to 100+ models across providers with unified billing.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

> **Note:** Capabilities: streaming (yes), vision (varies by model), tool_calls (varies).

---

### Together AI

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

Together AI inference platform for open-source models.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

---

### Fireworks

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

Fireworks AI — optimized inference for open-source models.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

---

### Mistral

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

Mistral AI API — Mistral, Mixtral, and Codestral models.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

---

### DeepSeek

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.5.0

DeepSeek API for DeepSeek-V2, DeepSeek-Coder, and other models.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

---

### xAI (Grok)

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.5.0

xAI Grok API — Grok-1 and Grok-2 models.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

---

### Perplexity

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

Perplexity AI API — online search-augmented models.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

---

### Ollama

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

Ollama local inference — runs models on localhost. No API key required.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

> **Note:** Base URL: http://localhost:11434/v1. No API key required. Runs fully local.

---

### LM Studio

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

LM Studio local inference server. No API key required.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

> **Note:** Base URL: http://localhost:1234/v1. No API key required.

---

### Lepton

**Status:** ✅ Implemented · **Category:** tier-2-compatible · **Since:** v1.0.0

Lepton AI inference platform.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `OpenAICompatibleProvider`

---

### MateyProvider (ai.matey Tier 3)

**Status:** ✅ Implemented · **Category:** tier-3-matey · **Since:** v1.5.0

Dynamic CDN-lazy-loaded provider backend via the ai.matey package. Supports 24+ additional providers loaded on demand to minimize initial bundle size. Each backend is instantiated only when first used.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `MateyProvider`

> **Note:** 24+ providers available via CDN lazy loading. Instantiated on first use. Cost-efficient approach — only loads code for providers actually in use.

---

### SSE Streaming

**Status:** ✅ Implemented · **Category:** streaming · **Since:** v1.0.0

Server-Sent Events streaming parsers for both OpenAI and Anthropic formats. readSSE() handles OpenAI-style streaming, readAnthropicSSE() handles Anthropic's message streaming format. Both return async generators.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `readSSE`
- `readAnthropicSSE`

**See also:**

- OpenAIProvider
- AnthropicProvider

---

### Vision / Multimodal Input

**Status:** ✅ Implemented · **Category:** multimodal · **Since:** v1.0.0

Support for multimodal input (images + text) when using providers that support vision (GPT-4o, GPT-4V, Claude 3, etc). Images are sent as content array items with base64 or URL references.

**Source files:**

- `web/clawser-providers.js`

**API surface:**

- `ChatMessage`

> **Note:** Supported by OpenAI (GPT-4o/V), Anthropic (Claude 3), and select Tier 2 providers.

---

### Account Management

**Status:** ✅ Implemented · **Category:** accounts · **Since:** v1.0.0

Multi-account system for managing API keys and provider configurations. Supports creating, updating, and deleting accounts with encrypted key storage via the vault. Built-in accounts provide defaults. Migration utility moves keys from localStorage to vault.

**Source files:**

- `web/clawser-accounts.js`
- `web/clawser-accounts.d.ts`

**API surface:**

- `SERVICES`
- `BUILTIN_ACCOUNTS`
- `loadAccounts`
- `saveAccounts`
- `createAccount`
- `updateAccount`
- `deleteAccount`
- `storeAccountKey`
- `resolveAccountKey`
- `migrateKeysToVault`
- `seedBuiltinAccounts`

**See also:**

- Auth Profiles
- Vault

---

---

[← Tools](/docs/guide/tools/) | [Index](/docs/) | [Shell →](/docs/guide/shell/)
