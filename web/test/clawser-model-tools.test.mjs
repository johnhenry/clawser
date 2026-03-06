import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub browser globals
globalThis.BrowserTool = class { constructor() {} }
globalThis.caches = {
  _stores: {},
  async open(name) {
    if (!this._stores[name]) {
      const entries = new Map()
      this._stores[name] = {
        async keys() { return [...entries.keys()].map(u => ({ url: u })) },
        async match(req) { const url = typeof req === 'string' ? req : req.url; return entries.get(url) || undefined },
        async put(req, resp) { const url = typeof req === 'string' ? req : req.url; entries.set(url, resp) },
        async delete(req) { const url = typeof req === 'string' ? req : req.url; return entries.delete(url) },
      }
    }
    return this._stores[name]
  },
}
globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64')
globalThis.fetch = async (url) => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(16),
  blob: async () => new Blob([]),
  json: async () => ({}),
})

import { ModelManager, ModelRegistry, ModelCache } from '../clawser-models.js'
import {
  ModelListTool,
  ModelPullTool,
  ModelRemoveTool,
  ModelStatusTool,
  TranscribeTool,
  SpeakTool,
  CaptionTool,
  OcrTool,
  DetectObjectsTool,
  ClassifyImageTool,
  ClassifyTextTool,
} from '../clawser-model-tools.js'
import { registerModelCli } from '../clawser-model-cli.js'

// ── Test helpers ─────────────────────────────────────────────────

function createTestManager() {
  return new ModelManager({
    pipelineFactory: async (task, repo, opts) => {
      opts?.progress_callback?.({ status: 'downloading', progress: 0.5 })
      const pipe = async (input, popts) => {
        if (task === 'feature-extraction') return { data: new Float32Array(384).fill(0.1) }
        if (task === 'automatic-speech-recognition') return { text: 'hello world' }
        if (task === 'text-to-speech') return { audio: new Float32Array(100).fill(0.5), sampling_rate: 16000 }
        if (task === 'image-to-text' || task === 'image-to-text-ocr') return [{ generated_text: 'test caption' }]
        return {}
      }
      pipe.dispose = () => {}
      return pipe
    },
    mediapipeFactory: async (task, modelUrl, opts) => ({
      detect: () => ({ detections: [{ categories: [{ categoryName: 'cat', score: 0.95 }], boundingBox: { originX: 10, originY: 20, width: 100, height: 80 } }] }),
      classify: () => ({ classifications: [{ categories: [{ categoryName: 'positive', score: 0.9 }] }] }),
      segment: () => ({ categoryMask: { labels: ['bg', 'person'], mask: new Uint8Array([0, 1]), width: 2, height: 1 } }),
      close() {},
    }),
  })
}

// ── Agent Tool Tests ─────────────────────────────────────────────

describe('ModelListTool', () => {
  it('lists all models', async () => {
    const tool = new ModelListTool(createTestManager())
    assert.equal(tool.name, 'model_list')
    assert.equal(tool.permission, 'read')
    const result = await tool.execute()
    assert.ok(result.success)
    assert.ok(result.output.includes('minilm-l6-v2'))
    assert.ok(result.output.includes('mp-object-detector'))
  })

  it('filters by task', async () => {
    const tool = new ModelListTool(createTestManager())
    const result = await tool.execute({ task: 'feature-extraction' })
    assert.ok(result.success)
    assert.ok(result.output.includes('minilm-l6-v2'))
    assert.ok(!result.output.includes('whisper'))
  })
})

describe('ModelPullTool', () => {
  it('downloads a model', async () => {
    const tool = new ModelPullTool(createTestManager())
    assert.equal(tool.name, 'model_pull')
    assert.equal(tool.permission, 'write')
    const result = await tool.execute({ model: 'minilm-l6-v2' })
    assert.ok(result.success)
    assert.ok(result.output.includes('Downloaded'))
  })

  it('errors on unknown model', async () => {
    const tool = new ModelPullTool(createTestManager())
    const result = await tool.execute({ model: 'nonexistent' })
    assert.equal(result.success, false)
    assert.ok(result.error.includes('Unknown'))
  })
})

describe('ModelRemoveTool', () => {
  it('removes a model', async () => {
    const tool = new ModelRemoveTool(createTestManager())
    assert.equal(tool.name, 'model_remove')
    const result = await tool.execute({ model: 'minilm-l6-v2' })
    assert.ok(result.success)
    assert.ok(result.output.includes('Removed'))
  })
})

describe('ModelStatusTool', () => {
  it('shows all model status', async () => {
    const tool = new ModelStatusTool(createTestManager())
    assert.equal(tool.name, 'model_status')
    const result = await tool.execute()
    assert.ok(result.success)
    assert.ok(result.output.includes('Models:'))
    assert.ok(result.output.includes('Cache backend:'))
  })

  it('shows single model status', async () => {
    const tool = new ModelStatusTool(createTestManager())
    const result = await tool.execute({ model: 'minilm-l6-v2' })
    assert.ok(result.success)
    assert.ok(result.output.includes('minilm-l6-v2'))
    assert.ok(result.output.includes('not_cached'))
  })

  it('errors on unknown model', async () => {
    const tool = new ModelStatusTool(createTestManager())
    const result = await tool.execute({ model: 'nonexistent' })
    assert.equal(result.success, false)
  })
})

describe('TranscribeTool', () => {
  it('transcribes audio', async () => {
    const tool = new TranscribeTool(createTestManager())
    assert.equal(tool.name, 'transcribe')
    const result = await tool.execute({ audio_url: 'https://example.com/audio.wav' })
    assert.ok(result.success)
    assert.equal(result.output, 'hello world')
  })
})

describe('SpeakTool', () => {
  it('synthesizes speech', async () => {
    const tool = new SpeakTool(createTestManager())
    assert.equal(tool.name, 'speak')
    assert.equal(tool.permission, 'write')
    const result = await tool.execute({ text: 'hello' })
    assert.ok(result.success)
    assert.ok(result.output.startsWith('data:audio/wav;base64,'))
  })
})

describe('CaptionTool', () => {
  it('captions image', async () => {
    const tool = new CaptionTool(createTestManager())
    assert.equal(tool.name, 'caption')
    const result = await tool.execute({ image_url: 'https://example.com/img.jpg' })
    assert.ok(result.success)
    assert.equal(result.output, 'test caption')
  })
})

describe('OcrTool', () => {
  it('extracts text from image', async () => {
    const tool = new OcrTool(createTestManager())
    assert.equal(tool.name, 'ocr')
    const result = await tool.execute({ image_url: 'https://example.com/doc.png' })
    assert.ok(result.success)
    assert.equal(result.output, 'test caption')
  })
})

describe('DetectObjectsTool', () => {
  it('detects objects', async () => {
    const tool = new DetectObjectsTool(createTestManager())
    assert.equal(tool.name, 'detect_objects')
    const result = await tool.execute({ image_url: 'https://example.com/photo.jpg' })
    assert.ok(result.success)
    const detections = JSON.parse(result.output)
    assert.equal(detections.length, 1)
    assert.equal(detections[0].label, 'cat')
  })
})

describe('ClassifyImageTool', () => {
  it('classifies image', async () => {
    const tool = new ClassifyImageTool(createTestManager())
    assert.equal(tool.name, 'classify_image')
    const result = await tool.execute({ image_url: 'https://example.com/photo.jpg' })
    assert.ok(result.success)
    assert.ok(result.output.includes('positive'))
  })
})

describe('ClassifyTextTool', () => {
  it('classifies text', async () => {
    const tool = new ClassifyTextTool(createTestManager())
    assert.equal(tool.name, 'classify_text')
    const result = await tool.execute({ text: 'I love this product' })
    assert.ok(result.success)
    assert.ok(result.output.includes('positive'))
  })
})

// ── CLI Tests ────────────────────────────────────────────────────

describe('registerModelCli', () => {
  let registry, handler

  beforeEach(() => {
    registry = {
      _commands: new Map(),
      register(name, fn, meta) { this._commands.set(name, { fn, meta }) },
      get(name) { return this._commands.get(name)?.fn || null },
      has(name) { return this._commands.has(name) },
      getMeta(name) { return this._commands.get(name)?.meta || null },
    }
    registerModelCli(registry, createTestManager)
    handler = registry.get('model')
  })

  it('registers model command', () => {
    assert.ok(registry.has('model'))
    assert.equal(registry.getMeta('model').category, 'ai')
  })

  it('shows help with no subcommand', async () => {
    const r = await handler({ args: [] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('Usage:'))
  })

  it('shows help for unknown subcommand', async () => {
    const r = await handler({ args: ['nope'] })
    assert.equal(r.exitCode, 1)
    assert.ok(r.stdout.includes('Usage:'))
  })

  it('model list shows all models', async () => {
    const r = await handler({ args: ['list'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('minilm-l6-v2'))
    assert.ok(r.stdout.includes('mp-object-detector'))
  })

  it('model list --task filters', async () => {
    const r = await handler({ args: ['list', '--task', 'feature-extraction'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('minilm-l6-v2'))
    assert.ok(!r.stdout.includes('whisper'))
  })

  it('model pull downloads', async () => {
    const r = await handler({ args: ['pull', 'minilm-l6-v2'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('Downloaded'))
  })

  it('model pull errors without id', async () => {
    const r = await handler({ args: ['pull'] })
    assert.equal(r.exitCode, 1)
    assert.ok(r.stderr.includes('Usage'))
  })

  it('model pull errors for unknown model', async () => {
    const r = await handler({ args: ['pull', 'nope'] })
    assert.equal(r.exitCode, 1)
    assert.ok(r.stderr.includes('Unknown'))
  })

  it('model rm removes', async () => {
    const r = await handler({ args: ['rm', 'minilm-l6-v2'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('Removed'))
  })

  it('model rm errors without id', async () => {
    const r = await handler({ args: ['rm'] })
    assert.equal(r.exitCode, 1)
  })

  it('model info shows details', async () => {
    const r = await handler({ args: ['info', 'minilm-l6-v2'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('ID:'))
    assert.ok(r.stdout.includes('Repo:'))
    assert.ok(r.stdout.includes('Xenova/all-MiniLM-L6-v2'))
  })

  it('model info errors for unknown', async () => {
    const r = await handler({ args: ['info', 'nope'] })
    assert.equal(r.exitCode, 1)
  })

  it('model status shows overview', async () => {
    const r = await handler({ args: ['status'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('Total:'))
    assert.ok(r.stdout.includes('Backend:'))
  })

  it('model cache shows backend info', async () => {
    const r = await handler({ args: ['cache'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('Backend:'))
    assert.ok(r.stdout.includes('Usage:'))
  })

  it('model ls is alias for list', async () => {
    const r = await handler({ args: ['ls'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('minilm-l6-v2'))
  })

  it('model st is alias for status', async () => {
    const r = await handler({ args: ['st'] })
    assert.equal(r.exitCode, 0)
    assert.ok(r.stdout.includes('Total:'))
  })

  it('returns error when manager is null', async () => {
    const reg2 = {
      _commands: new Map(),
      register(name, fn, meta) { this._commands.set(name, { fn, meta }) },
      get(name) { return this._commands.get(name)?.fn || null },
    }
    registerModelCli(reg2, () => null)
    const h = reg2.get('model')
    const r = await h({ args: ['list'] })
    assert.equal(r.exitCode, 1)
    assert.ok(r.stderr.includes('not initialized'))
  })
})
