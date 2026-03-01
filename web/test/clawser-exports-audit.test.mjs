// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-exports-audit.test.mjs
//
// Verifies that every export claimed in .d.ts files actually exists in the
// corresponding .js module. Catches drift between types and implementation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Polyfills needed by several modules ──────────────────────────
globalThis.BrowserTool = class { constructor() {} };
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
  };
}
if (typeof globalThis.crypto === 'undefined') {
  const nodeCrypto = await import('node:crypto');
  globalThis.crypto = nodeCrypto.webcrypto ?? nodeCrypto;
}
if (typeof globalThis.Response === 'undefined') {
  globalThis.Response = class Response {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.headers = new Map(Object.entries(init.headers || {}));
    }
  };
}
if (typeof globalThis.indexedDB === 'undefined') {
  globalThis.indexedDB = {
    open() {
      return {
        set onupgradeneeded(_) {},
        set onsuccess(_) {},
        set onerror(_) {},
      };
    },
  };
}
if (typeof globalThis.FileSystemDirectoryHandle === 'undefined') {
  globalThis.FileSystemDirectoryHandle = class {};
}
if (typeof globalThis.Blob === 'undefined') {
  const { Blob } = await import('node:buffer');
  globalThis.Blob = Blob;
}

// ── Helper ────────────────────────────────────────────────────────

function assertExport(mod, name, expectedType) {
  assert.ok(name in mod, `Missing export: "${name}"`);
  if (expectedType === 'class') {
    assert.equal(typeof mod[name], 'function', `"${name}" should be a class/function`);
  } else {
    assert.equal(typeof mod[name], expectedType, `"${name}" should be typeof "${expectedType}"`);
  }
}

// ── 1. clawser-vault.js ──────────────────────────────────────────

describe('clawser-vault.js exports', async () => {
  const mod = await import('../clawser-vault.js');

  it('exports deriveKey function', () => assertExport(mod, 'deriveKey', 'function'));
  it('exports encryptSecret function', () => assertExport(mod, 'encryptSecret', 'function'));
  it('exports decryptSecret function', () => assertExport(mod, 'decryptSecret', 'function'));
  it('exports measurePassphraseStrength function', () => assertExport(mod, 'measurePassphraseStrength', 'function'));
  it('exports MemoryVaultStorage class', () => assertExport(mod, 'MemoryVaultStorage', 'class'));
  it('exports OPFSVaultStorage class', () => assertExport(mod, 'OPFSVaultStorage', 'class'));
  it('exports SecretVault class', () => assertExport(mod, 'SecretVault', 'class'));
  it('exports VaultRekeyer class', () => assertExport(mod, 'VaultRekeyer', 'class'));
});

// ── 2. clawser-server.js ─────────────────────────────────────────

describe('clawser-server.js exports', async () => {
  const mod = await import('../clawser-server.js');

  it('exports ServerManager class', () => assertExport(mod, 'ServerManager', 'class'));
  it('exports SSEChannel class', () => assertExport(mod, 'SSEChannel', 'class'));
  it('exports getServerManager function', () => assertExport(mod, 'getServerManager', 'function'));
  it('exports initServerManager function', () => assertExport(mod, 'initServerManager', 'function'));
  it('ServerManager has static createSkillHandler', () => {
    assert.equal(typeof mod.ServerManager.createSkillHandler, 'function');
  });
  it('ServerManager has static createSSEResponse', () => {
    assert.equal(typeof mod.ServerManager.createSSEResponse, 'function');
  });
  it('ServerManager has static createSSEResponseFromGenerator', () => {
    assert.equal(typeof mod.ServerManager.createSSEResponseFromGenerator, 'function');
  });
  it('ServerManager has static executeSkillHandler', () => {
    assert.equal(typeof mod.ServerManager.executeSkillHandler, 'function');
  });
});

// ── 3. clawser-extension-tools.js ────────────────────────────────

describe('clawser-extension-tools.js exports', async () => {
  const mod = await import('../clawser-extension-tools.js');

  it('exports MARKER constant', () => assertExport(mod, 'MARKER', 'string'));
  it('exports CAPABILITY_HINTS object', () => assertExport(mod, 'CAPABILITY_HINTS', 'object'));
  it('exports ExtensionRpcClient class', () => assertExport(mod, 'ExtensionRpcClient', 'class'));
  it('exports getExtensionClient function', () => assertExport(mod, 'getExtensionClient', 'function'));
  it('exports destroyExtensionClient function', () => assertExport(mod, 'destroyExtensionClient', 'function'));
  it('exports updateExtensionBadge function', () => assertExport(mod, 'updateExtensionBadge', 'function'));
  it('exports initExtensionBadge function', () => assertExport(mod, 'initExtensionBadge', 'function'));
  it('exports registerExtensionTools function', () => assertExport(mod, 'registerExtensionTools', 'function'));
  it('exports createExtensionBridge function', () => assertExport(mod, 'createExtensionBridge', 'function'));
  it('exports ExtStatusTool class', () => assertExport(mod, 'ExtStatusTool', 'class'));
  it('exports ExtClickTool class', () => assertExport(mod, 'ExtClickTool', 'class'));
  it('exports ExtWebmcpDiscoverTool class', () => assertExport(mod, 'ExtWebmcpDiscoverTool', 'class'));
});

// ── 4. clawser-agent.js ──────────────────────────────────────────

describe('clawser-agent.js exports', async () => {
  const mod = await import('../clawser-agent.js');

  it('exports EventLog class', () => assertExport(mod, 'EventLog', 'class'));
  it('exports HOOK_POINTS array', () => {
    assert.ok('HOOK_POINTS' in mod);
    assert.ok(Array.isArray(mod.HOOK_POINTS));
  });
  it('exports HookPipeline class', () => assertExport(mod, 'HookPipeline', 'class'));
  it('exports createAuditLoggerHook function', () => assertExport(mod, 'createAuditLoggerHook', 'function'));
  it('exports AutonomyController class', () => assertExport(mod, 'AutonomyController', 'class'));
  it('exports ClawserAgent class', () => assertExport(mod, 'ClawserAgent', 'class'));
});

// ── 5. clawser-providers.js ──────────────────────────────────────

describe('clawser-providers.js exports', async () => {
  const mod = await import('../clawser-providers.js');

  it('exports MODEL_PRICING object', () => assertExport(mod, 'MODEL_PRICING', 'object'));
  it('exports estimateCost function', () => assertExport(mod, 'estimateCost', 'function'));
  it('exports CostLedger class', () => assertExport(mod, 'CostLedger', 'class'));
  it('exports ProfileCostLedger class', () => assertExport(mod, 'ProfileCostLedger', 'class'));
  it('exports classifyError function', () => assertExport(mod, 'classifyError', 'function'));
  it('exports validateChatResponse function', () => assertExport(mod, 'validateChatResponse', 'function'));
  it('exports ResponseCache class', () => assertExport(mod, 'ResponseCache', 'class'));
  it('exports readSSE function', () => assertExport(mod, 'readSSE', 'function'));
  it('exports readAnthropicSSE function', () => assertExport(mod, 'readAnthropicSSE', 'function'));
  it('exports LLMProvider class', () => assertExport(mod, 'LLMProvider', 'class'));
  it('exports OpenAIProvider class', () => assertExport(mod, 'OpenAIProvider', 'class'));
  it('exports AnthropicProvider class', () => assertExport(mod, 'AnthropicProvider', 'class'));
  it('exports OpenAICompatibleProvider class', () => assertExport(mod, 'OpenAICompatibleProvider', 'class'));
  it('exports ProviderRegistry class', () => assertExport(mod, 'ProviderRegistry', 'class'));
  it('exports createDefaultProviders function', () => assertExport(mod, 'createDefaultProviders', 'function'));
});

// ── 6. clawser-goals.js ──────────────────────────────────────────

describe('clawser-goals.js exports', async () => {
  const mod = await import('../clawser-goals.js');

  it('exports resetGoalIdCounter function', () => assertExport(mod, 'resetGoalIdCounter', 'function'));
  it('exports Goal class', () => assertExport(mod, 'Goal', 'class'));
  it('exports GoalManager class', () => assertExport(mod, 'GoalManager', 'class'));
  it('exports GoalAddTool class', () => assertExport(mod, 'GoalAddTool', 'class'));
  it('exports GoalUpdateTool class', () => assertExport(mod, 'GoalUpdateTool', 'class'));
  it('exports GoalAddArtifactTool class', () => assertExport(mod, 'GoalAddArtifactTool', 'class'));
  it('exports GoalListTool class', () => assertExport(mod, 'GoalListTool', 'class'));
  it('exports GoalDecomposeTool class', () => assertExport(mod, 'GoalDecomposeTool', 'class'));
  it('GoalManager.prototype has decompose method', () => {
    assert.equal(typeof mod.GoalManager.prototype.decompose, 'function');
  });
  it('GoalManager.prototype has onCompletion method', () => {
    assert.equal(typeof mod.GoalManager.prototype.onCompletion, 'function');
  });
});

// ── 7. clawser-memory.js ─────────────────────────────────────────

describe('clawser-memory.js exports', async () => {
  const mod = await import('../clawser-memory.js');

  it('exports cosineSimilarity function', () => assertExport(mod, 'cosineSimilarity', 'function'));
  it('exports tokenize function', () => assertExport(mod, 'tokenize', 'function'));
  it('exports bm25Score function', () => assertExport(mod, 'bm25Score', 'function'));
  it('exports EmbeddingProvider class', () => assertExport(mod, 'EmbeddingProvider', 'class'));
  it('exports NoopEmbedder class', () => assertExport(mod, 'NoopEmbedder', 'class'));
  it('exports OpenAIEmbeddingProvider class', () => assertExport(mod, 'OpenAIEmbeddingProvider', 'class'));
  it('exports ChromeAIEmbeddingProvider class', () => assertExport(mod, 'ChromeAIEmbeddingProvider', 'class'));
  it('exports TransformersEmbeddingProvider class', () => assertExport(mod, 'TransformersEmbeddingProvider', 'class'));
  it('exports SemanticMemory class', () => assertExport(mod, 'SemanticMemory', 'class'));
});

// ── 8. clawser-shell.js ──────────────────────────────────────────

describe('clawser-shell.js exports', async () => {
  const mod = await import('../clawser-shell.js');

  it('exports tokenize function', () => assertExport(mod, 'tokenize', 'function'));
  it('exports parse function', () => assertExport(mod, 'parse', 'function'));
  it('exports expandVariables function', () => assertExport(mod, 'expandVariables', 'function'));
  it('exports expandCommandSubs function', () => assertExport(mod, 'expandCommandSubs', 'function'));
  it('exports expandBraces function', () => assertExport(mod, 'expandBraces', 'function'));
  it('exports expandGlobs function', () => assertExport(mod, 'expandGlobs', 'function'));
  it('exports normalizePath function', () => assertExport(mod, 'normalizePath', 'function'));
  it('exports ShellState class', () => assertExport(mod, 'ShellState', 'class'));
  it('exports CommandRegistry class', () => assertExport(mod, 'CommandRegistry', 'class'));
  it('exports execute function', () => assertExport(mod, 'execute', 'function'));
  it('exports ShellFs class', () => assertExport(mod, 'ShellFs', 'class'));
  it('exports MemoryFs class', () => assertExport(mod, 'MemoryFs', 'class'));
  it('exports registerBuiltins function', () => assertExport(mod, 'registerBuiltins', 'function'));
  it('exports ClawserShell class', () => assertExport(mod, 'ClawserShell', 'class'));
  it('exports ShellTool class', () => assertExport(mod, 'ShellTool', 'class'));
});

// ── 9. clawser-mcp.js ───────────────────────────────────────────

describe('clawser-mcp.js exports', async () => {
  const mod = await import('../clawser-mcp.js');

  it('exports McpClient class', () => assertExport(mod, 'McpClient', 'class'));
  it('exports McpManager class', () => assertExport(mod, 'McpManager', 'class'));
  it('exports WebMCPDiscovery class', () => assertExport(mod, 'WebMCPDiscovery', 'class'));
});

// ── 10. clawser-skills.js ────────────────────────────────────────

describe('clawser-skills.js exports', async () => {
  const mod = await import('../clawser-skills.js');

  it('exports SkillParser class', () => assertExport(mod, 'SkillParser', 'class'));
  it('exports SkillStorage class', () => assertExport(mod, 'SkillStorage', 'class'));
  it('exports SkillRegistry class', () => assertExport(mod, 'SkillRegistry', 'class'));
  it('exports ActivateSkillTool class', () => assertExport(mod, 'ActivateSkillTool', 'class'));
  it('exports DeactivateSkillTool class', () => assertExport(mod, 'DeactivateSkillTool', 'class'));
  it('exports semverCompare function', () => assertExport(mod, 'semverCompare', 'function'));
  it('exports semverGt function', () => assertExport(mod, 'semverGt', 'function'));
  it('exports validateRequirements function', () => assertExport(mod, 'validateRequirements', 'function'));
  it('exports computeSkillHash function', () => assertExport(mod, 'computeSkillHash', 'function'));
  it('exports verifySkillIntegrity function', () => assertExport(mod, 'verifySkillIntegrity', 'function'));
  it('exports resolveDependencies function', () => assertExport(mod, 'resolveDependencies', 'function'));
  it('exports SKILL_TEMPLATES array', () => {
    assert.ok('SKILL_TEMPLATES' in mod);
    assert.ok(Array.isArray(mod.SKILL_TEMPLATES));
  });
  it('exports simpleDiff function', () => assertExport(mod, 'simpleDiff', 'function'));
  it('exports SkillRegistryClient class', () => assertExport(mod, 'SkillRegistryClient', 'class'));
  it('exports SkillSearchTool class', () => assertExport(mod, 'SkillSearchTool', 'class'));
  it('exports SkillInstallTool class', () => assertExport(mod, 'SkillInstallTool', 'class'));
  it('exports SkillUpdateTool class', () => assertExport(mod, 'SkillUpdateTool', 'class'));
  it('exports SkillRemoveTool class', () => assertExport(mod, 'SkillRemoveTool', 'class'));
  it('exports SkillListTool class', () => assertExport(mod, 'SkillListTool', 'class'));
});
