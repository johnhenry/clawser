import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub browser globals before importing
globalThis.BrowserTool = class { constructor() {} }
globalThis.caches = {
  _stores: {},
  async open(name) {
    if (!this._stores[name]) {
      const entries = new Map()
      this._stores[name] = {
        async keys() { return [...entries.keys()].map(u => ({ url: u })) },
        async match(req) {
          const url = typeof req === 'string' ? req : req.url
          return entries.get(url) || undefined
        },
        async put(req, resp) {
          const url = typeof req === 'string' ? req : req.url
          entries.set(url, resp)
        },
        async delete(req) {
          const url = typeof req === 'string' ? req : req.url
          return entries.delete(url)
        },
      }
    }
    return this._stores[name]
  },
}

import {
  ModelRegistry,
  CacheApiBackend,
  FsAccessBackend,
  ModelCache,
  ModelManager,
  ManagedEmbeddingProvider,
  SpeechToText,
  TextToSpeech,
  ImageCaptioner,
  DocumentOCR,
  ObjectDetector,
  ImageClassifier,
  TextClassifier,
  formatBytes,
  urlToLocalPath,
} from '../clawser-models.js'

// ── ModelRegistry ────────────────────────────────────────────────

describe('ModelRegistry', () => {
  let registry

  beforeEach(() => {
    registry = new ModelRegistry()
  })

  it('has default models', () => {
    assert.ok(registry.has('minilm-l6-v2'))
    assert.ok(registry.has('whisper-tiny-en'))
    assert.ok(registry.has('mp-object-detector'))
  })

  it('lists all models', () => {
    const all = registry.list()
    assert.ok(all.length >= 11)
  })

  it('filters by task', () => {
    const embeds = registry.list('feature-extraction')
    assert.ok(embeds.length >= 2)
    assert.ok(embeds.every(m => m.task === 'feature-extraction'))
  })

  it('gets model by id', () => {
    const m = registry.get('whisper-tiny-en')
    assert.equal(m.runtime, 'transformers')
    assert.equal(m.task, 'automatic-speech-recognition')
  })

  it('returns null for unknown model', () => {
    assert.equal(registry.get('nonexistent'), null)
  })

  it('registers custom model', () => {
    registry.register({
      id: 'custom-embed',
      repo: 'custom/model',
      task: 'feature-extraction',
      runtime: 'transformers',
      description: 'Custom embeddings',
      sizeEstimate: 50 * 1024 * 1024,
    })
    assert.ok(registry.has('custom-embed'))
    assert.equal(registry.get('custom-embed').description, 'Custom embeddings')
  })

  it('throws on invalid register', () => {
    assert.throws(() => registry.register({ id: 'x' }), /requires/)
  })

  it('unregisters model', () => {
    assert.ok(registry.unregister('minilm-l6-v2'))
    assert.ok(!registry.has('minilm-l6-v2'))
  })

  it('returns false for unknown unregister', () => {
    assert.equal(registry.unregister('nope'), false)
  })

  it('lists unique tasks', () => {
    const tasks = registry.tasks()
    assert.ok(tasks.includes('feature-extraction'))
    assert.ok(tasks.includes('automatic-speech-recognition'))
    assert.ok(tasks.includes('object-detection'))
  })

  it('searches by query', () => {
    const results = registry.search('whisper')
    assert.ok(results.length >= 2)
  })

  it('search is case-insensitive', () => {
    const results = registry.search('WHISPER')
    assert.ok(results.length >= 2)
  })

  it('gets default model for task', () => {
    const m = registry.getDefault('feature-extraction')
    assert.equal(m.id, 'minilm-l6-v2')
    assert.ok(m.defaultForTask)
  })

  it('returns null when no default', () => {
    // Remove all defaults for a task
    for (const m of registry.list()) {
      if (m.defaultForTask) {
        const updated = { ...m, defaultForTask: false }
        registry.register(updated)
      }
    }
    assert.equal(registry.getDefault('feature-extraction'), null)
  })

  it('includes mediapipe models', () => {
    const mp = registry.list().filter(m => m.runtime === 'mediapipe')
    assert.ok(mp.length >= 4)
  })

  it('mediapipe models have correct tasks', () => {
    assert.equal(registry.get('mp-object-detector').task, 'object-detection')
    assert.equal(registry.get('mp-image-classifier').task, 'image-classification')
    assert.equal(registry.get('mp-image-segmenter').task, 'image-segmentation')
    assert.equal(registry.get('mp-text-classifier').task, 'text-classification')
  })
})

// ── CacheApiBackend ──────────────────────────────────────────────

describe('CacheApiBackend', () => {
  let backend

  beforeEach(() => {
    globalThis.caches._stores = {}
    backend = new CacheApiBackend()
  })

  it('has name cache-api', () => {
    assert.equal(backend.name, 'cache-api')
  })

  it('returns null for getTransformersCache', () => {
    assert.equal(backend.getTransformersCache(), null)
  })

  it('has() returns false for uncached repo', async () => {
    assert.equal(await backend.has('Xenova/test-model'), false)
  })

  it('list() returns empty for fresh cache', async () => {
    const repos = await backend.list()
    assert.deepEqual(repos, [])
  })

  it('usage() returns 0 for empty cache', async () => {
    assert.equal(await backend.usage(), 0)
  })

  it('delete() returns false for missing repo', async () => {
    assert.equal(await backend.delete('Xenova/test-model'), false)
  })

  it('has() finds repo with literal slash in URL', async () => {
    // Simulate transformers.js caching a model file
    const cache = await caches.open('transformers-cache')
    await cache.put(
      'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx',
      new Response('model data')
    )
    assert.equal(await backend.has('Xenova/all-MiniLM-L6-v2'), true)
    assert.equal(await backend.has('Xenova/other-model'), false)
  })

  it('delete() removes cached model by literal repo match', async () => {
    const cache = await caches.open('transformers-cache')
    await cache.put(
      'https://huggingface.co/Xenova/test-model/resolve/main/model.onnx',
      new Response('data')
    )
    assert.equal(await backend.has('Xenova/test-model'), true)
    assert.equal(await backend.delete('Xenova/test-model'), true)
    assert.equal(await backend.has('Xenova/test-model'), false)
  })

  it('list() extracts repo from cached URLs', async () => {
    const cache = await caches.open('transformers-cache')
    await cache.put(
      'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/model.onnx',
      new Response('data')
    )
    const repos = await backend.list()
    assert.ok(repos.includes('Xenova/all-MiniLM-L6-v2'))
  })
})

// ── ModelCache ───────────────────────────────────────────────────

describe('ModelCache', () => {
  it('defaults to CacheApiBackend', () => {
    const cache = new ModelCache()
    assert.equal(cache.backendName, 'cache-api')
  })

  it('setBackend changes backend', () => {
    const cache = new ModelCache()
    const mockBackend = { name: 'mock', has: async () => true, delete: async () => true, list: async () => [], usage: async () => 0, getTransformersCache: () => null }
    cache.setBackend(mockBackend)
    assert.equal(cache.backendName, 'mock')
  })

  it('delegates has() to backend', async () => {
    const cache = new ModelCache({ name: 'mock', has: async (r) => r === 'test', delete: async () => true, list: async () => [], usage: async () => 0, getTransformersCache: () => null })
    assert.equal(await cache.has('test'), true)
    assert.equal(await cache.has('other'), false)
  })
})

// ── FsAccessBackend ──────────────────────────────────────────────

describe('FsAccessBackend', () => {
  let backend, mockFs

  beforeEach(() => {
    mockFs = {
      _dirs: {
        '/mnt/models': [
          { name: 'models--Xenova--all-MiniLM-L6-v2', kind: 'directory' },
          { name: 'models--Xenova--whisper-tiny.en', kind: 'directory' },
          { name: 'other-file.txt', kind: 'file' },
        ],
      },
      async listMounted(path) { return this._dirs[path] || null },
      async readMounted(path) { return `content of ${path}` },
      async writeMounted(path, data) { /* no-op */ },
      resolveMount(path) { return { type: 'mount', handle: { removeEntry: async () => {} } } },
    }
    backend = new FsAccessBackend('/mnt/models', mockFs)
  })

  it('has name fs-access', () => {
    assert.equal(backend.name, 'fs-access')
  })

  it('has mountPath', () => {
    assert.equal(backend.mountPath, '/mnt/models')
  })

  it('has() detects cached model', async () => {
    assert.equal(await backend.has('Xenova/all-MiniLM-L6-v2'), true)
  })

  it('has() returns false for uncached model', async () => {
    assert.equal(await backend.has('Xenova/bge-small'), false)
  })

  it('list() returns repo names', async () => {
    const repos = await backend.list()
    assert.ok(repos.includes('Xenova/all-MiniLM-L6-v2'))
    assert.ok(repos.includes('Xenova/whisper-tiny.en'))
    assert.equal(repos.length, 2)
  })

  it('getTransformersCache() returns custom cache object', () => {
    const cache = backend.getTransformersCache()
    assert.ok(cache)
    assert.equal(typeof cache.match, 'function')
    assert.equal(typeof cache.put, 'function')
  })

  it('custom cache match() reads from FS', async () => {
    const cache = backend.getTransformersCache()
    const resp = await cache.match('https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/model.onnx')
    assert.ok(resp instanceof Response)
  })
})

// ── urlToLocalPath ───────────────────────────────────────────────

describe('urlToLocalPath', () => {
  it('converts HF CDN URL to local path', () => {
    const result = urlToLocalPath(
      'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx',
      '/mnt/models'
    )
    assert.equal(result, '/mnt/models/models--Xenova--all-MiniLM-L6-v2/onnx/model_quantized.onnx')
  })

  it('handles nested file paths', () => {
    const result = urlToLocalPath(
      'https://huggingface.co/Xenova/whisper-tiny.en/resolve/main/onnx/decoder_model_merged_quantized.onnx',
      '/mnt/models'
    )
    assert.equal(result, '/mnt/models/models--Xenova--whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx')
  })

  it('returns null for non-HF URL', () => {
    assert.equal(urlToLocalPath('https://example.com/file.bin', '/mnt'), null)
  })

  it('returns null for invalid URL', () => {
    assert.equal(urlToLocalPath('not-a-url', '/mnt'), null)
  })
})

// ── ModelManager ─────────────────────────────────────────────────

describe('ModelManager', () => {
  let manager, fakePipeline

  beforeEach(() => {
    globalThis.caches._stores = {}
    fakePipeline = {
      disposed: false,
      calls: [],
      dispose() { this.disposed = true },
      async call(input, opts) {
        this.calls.push({ input, opts })
        return { data: new Float32Array(384).fill(0.5) }
      },
    }
    // Make pipeline callable
    const callable = Object.assign(
      async (input, opts) => fakePipeline.call(input, opts),
      fakePipeline
    )

    manager = new ModelManager({
      pipelineFactory: async (task, repo, opts) => {
        opts?.progress_callback?.({ status: 'downloading', progress: 0.5 })
        return callable
      },
      mediapipeFactory: async (task, modelUrl, opts) => {
        return {
          detect: (img) => ({ detections: [{ categories: [{ categoryName: 'cat', score: 0.95 }], boundingBox: { originX: 10, originY: 20, width: 100, height: 80 } }] }),
          classify: (input) => ({ classifications: [{ categories: [{ categoryName: 'positive', score: 0.9 }] }] }),
          segment: (img) => ({ categoryMask: { labels: ['background', 'person'], mask: new Uint8Array([0, 1, 0, 1]), width: 2, height: 2 } }),
          close() {},
        }
      },
    })
  })

  it('has registry and cache', () => {
    assert.ok(manager.registry instanceof ModelRegistry)
    assert.ok(manager.cache instanceof ModelCache)
  })

  it('loads a model', async () => {
    const pipe = await manager.load('minilm-l6-v2')
    assert.ok(pipe)
    assert.equal(manager.status('minilm-l6-v2'), 'loaded')
  })

  it('deduplicates concurrent loads', async () => {
    let callCount = 0
    const mgr = new ModelManager({
      pipelineFactory: async () => {
        callCount++
        await new Promise(r => setTimeout(r, 10))
        return { dispose() {} }
      },
      mediapipeFactory: async () => ({}),
    })
    const [p1, p2] = await Promise.all([mgr.load('minilm-l6-v2'), mgr.load('minilm-l6-v2')])
    assert.equal(callCount, 1)
    assert.strictEqual(p1, p2)
  })

  it('returns cached pipeline on second load', async () => {
    const p1 = await manager.load('minilm-l6-v2')
    const p2 = await manager.load('minilm-l6-v2')
    assert.strictEqual(p1, p2)
  })

  it('unloads model', async () => {
    await manager.load('minilm-l6-v2')
    assert.ok(manager.unload('minilm-l6-v2'))
    assert.notEqual(manager.status('minilm-l6-v2'), 'loaded')
  })

  it('unload returns false for not-loaded model', () => {
    assert.equal(manager.unload('nonexistent'), false)
  })

  it('throws on unknown model load', async () => {
    await assert.rejects(() => manager.load('nonexistent'), /Unknown model/)
  })

  it('throws on unknown model pull', async () => {
    await assert.rejects(() => manager.pull('nonexistent'), /Unknown model/)
  })

  it('pull downloads without loading', async () => {
    let progressCalled = false
    await manager.pull('minilm-l6-v2', (p) => { progressCalled = true })
    assert.ok(progressCalled)
    // Pipeline should have been disposed (not kept loaded)
    assert.notEqual(manager.status('minilm-l6-v2'), 'loaded')
  })

  it('getPipeline throws if not loaded', () => {
    assert.throws(() => manager.getPipeline('minilm-l6-v2'), /not loaded/)
  })

  it('getPipeline returns loaded pipeline', async () => {
    const pipe = await manager.load('minilm-l6-v2')
    assert.strictEqual(manager.getPipeline('minilm-l6-v2'), pipe)
  })

  it('getByTask loads default model', async () => {
    const pipe = await manager.getByTask('feature-extraction')
    assert.ok(pipe)
    assert.equal(manager.status('minilm-l6-v2'), 'loaded')
  })

  it('getByTask throws for unknown task', async () => {
    await assert.rejects(() => manager.getByTask('nonexistent-task'), /No default model/)
  })

  it('unloadAll clears all loaded models', async () => {
    await manager.load('minilm-l6-v2')
    await manager.load('whisper-tiny-en')
    await manager.load('mp-object-detector')
    assert.equal(manager.loadedModels().length, 3)
    manager.unloadAll()
    assert.equal(manager.loadedModels().length, 0)
  })

  it('loadedModels returns IDs of loaded models', async () => {
    await manager.load('minilm-l6-v2')
    assert.deepEqual(manager.loadedModels(), ['minilm-l6-v2'])
  })

  it('statusAsync returns not_cached for fresh model', async () => {
    const s = await manager.statusAsync('minilm-l6-v2')
    assert.equal(s, 'not_cached')
  })

  it('statusAsync returns loaded for loaded model', async () => {
    await manager.load('minilm-l6-v2')
    assert.equal(await manager.statusAsync('minilm-l6-v2'), 'loaded')
  })

  it('statusAsync returns unknown for unregistered model', async () => {
    assert.equal(await manager.statusAsync('nope'), 'unknown')
  })

  it('statusAll returns all model statuses', async () => {
    const all = await manager.statusAll()
    assert.ok(all.length >= 11)
    assert.ok(all.every(s => ['loaded', 'loading', 'cached', 'not_cached'].includes(s.status)))
  })

  it('loads MediaPipe model', async () => {
    const instance = await manager.load('mp-object-detector')
    assert.ok(instance)
    assert.equal(manager.status('mp-object-detector'), 'loaded')
  })

  it('remove deletes and unloads', async () => {
    await manager.load('minilm-l6-v2')
    const result = await manager.remove('minilm-l6-v2')
    assert.ok(result !== undefined)
    assert.notEqual(manager.status('minilm-l6-v2'), 'loaded')
  })
})

// ── Pipeline Wrappers ────────────────────────────────────────────

describe('ManagedEmbeddingProvider', () => {
  it('extends EmbeddingProvider', () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async (text, opts) => ({ data: new Float32Array(384).fill(0.1) }),
      mediapipeFactory: async () => ({}),
    })
    const embedder = new ManagedEmbeddingProvider(mgr)
    assert.equal(embedder.name, 'managed-transformers')
    assert.equal(embedder.dimensions, 384)
  })

  it('embed returns Float32Array', async () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async (text, opts) => ({ data: new Float32Array(384).fill(0.1) }),
      mediapipeFactory: async () => ({}),
    })
    const embedder = new ManagedEmbeddingProvider(mgr)
    const vec = await embedder.embed('hello world')
    assert.ok(vec instanceof Float32Array)
    assert.equal(vec.length, 384)
  })

  it('embed returns null for empty text', async () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async () => ({ data: new Float32Array(384) }),
      mediapipeFactory: async () => ({}),
    })
    const embedder = new ManagedEmbeddingProvider(mgr)
    assert.equal(await embedder.embed(''), null)
    assert.equal(await embedder.embed(null), null)
  })
})

describe('SpeechToText', () => {
  it('transcribes audio', async () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async (input) => ({ text: 'hello world' }),
      mediapipeFactory: async () => ({}),
    })
    const stt = new SpeechToText(mgr)
    const result = await stt.transcribe(new Float32Array(16000))
    assert.equal(result.text, 'hello world')
  })
})

describe('TextToSpeech', () => {
  it('synthesizes speech', async () => {
    const audio = new Float32Array(8000).fill(0.5)
    const mgr = new ModelManager({
      pipelineFactory: async () => async (text) => ({ audio, sampling_rate: 16000 }),
      mediapipeFactory: async () => ({}),
    })
    const tts = new TextToSpeech(mgr)
    const result = await tts.synthesize('hello')
    assert.ok(result.audio instanceof Float32Array)
    assert.equal(result.sampling_rate, 16000)
  })
})

describe('ImageCaptioner', () => {
  it('captions image', async () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async (img) => [{ generated_text: 'a cat sitting on a mat' }],
      mediapipeFactory: async () => ({}),
    })
    const captioner = new ImageCaptioner(mgr)
    const result = await captioner.caption('https://example.com/cat.jpg')
    assert.equal(result, 'a cat sitting on a mat')
  })
})

describe('DocumentOCR', () => {
  it('recognizes text', async () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async (img) => [{ generated_text: 'Invoice #12345' }],
      mediapipeFactory: async () => ({}),
    })
    const ocr = new DocumentOCR(mgr)
    const result = await ocr.recognize('https://example.com/doc.png')
    assert.equal(result, 'Invoice #12345')
  })
})

describe('ObjectDetector', () => {
  it('detects objects', async () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async () => ({}),
      mediapipeFactory: async () => ({
        detect: () => ({
          detections: [
            { categories: [{ categoryName: 'cat', score: 0.95 }], boundingBox: { originX: 10, originY: 20, width: 100, height: 80 } },
          ],
        }),
      }),
    })
    const detector = new ObjectDetector(mgr)
    // Use a mock image element
    const result = await detector.detect({})
    assert.equal(result.length, 1)
    assert.equal(result[0].label, 'cat')
    assert.equal(result[0].score, 0.95)
    assert.deepEqual(result[0].box, { x: 10, y: 20, width: 100, height: 80 })
  })
})

describe('ImageClassifier', () => {
  it('classifies image', async () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async () => ({}),
      mediapipeFactory: async () => ({
        classify: () => ({
          classifications: [{ categories: [{ categoryName: 'dog', score: 0.88 }] }],
        }),
      }),
    })
    const classifier = new ImageClassifier(mgr)
    const result = await classifier.classify({})
    assert.equal(result.length, 1)
    assert.equal(result[0].label, 'dog')
    assert.equal(result[0].score, 0.88)
  })
})

describe('TextClassifier', () => {
  it('classifies text', async () => {
    const mgr = new ModelManager({
      pipelineFactory: async () => async () => ({}),
      mediapipeFactory: async () => ({
        classify: () => ({
          classifications: [{ categories: [{ categoryName: 'positive', score: 0.92 }] }],
        }),
      }),
    })
    const classifier = new TextClassifier(mgr)
    const result = await classifier.classify('I love this product')
    assert.equal(result.length, 1)
    assert.equal(result[0].label, 'positive')
    assert.equal(result[0].score, 0.92)
  })
})

// ── formatBytes ──────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    assert.equal(formatBytes(0), '0 B')
  })

  it('formats bytes', () => {
    assert.equal(formatBytes(512), '512.0 B')
  })

  it('formats KB', () => {
    assert.equal(formatBytes(1024), '1.0 KB')
  })

  it('formats MB', () => {
    assert.equal(formatBytes(1024 * 1024), '1.0 MB')
  })

  it('formats GB', () => {
    assert.equal(formatBytes(1024 * 1024 * 1024), '1.0 GB')
  })

  it('formats fractional MB', () => {
    assert.equal(formatBytes(23 * 1024 * 1024), '23.0 MB')
  })
})
