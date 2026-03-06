/**
 * clawser-models.js — Local AI Model Management System
 *
 * Provides a complete model management layer for browser-native ML:
 *   - ModelRegistry: static catalog of known models (transformers.js + MediaPipe)
 *   - ModelCache: storage backend abstraction (Cache API or mounted FS)
 *   - ModelManager: download/load/unload lifecycle orchestrator
 *   - Pipeline wrappers: task-specific APIs for embeddings, STT, TTS, captioning, OCR,
 *     object detection, image classification, image segmentation
 *
 * Zero runtime deps — transformers.js and MediaPipe loaded lazily via CDN on first use.
 */

import { EmbeddingProvider } from './clawser-memory.js'

// ── Constants ────────────────────────────────────────────────────

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
const MEDIAPIPE_VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18'
const MEDIAPIPE_TEXT_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@0.10.18'
const TRANSFORMERS_CACHE_NAME = 'transformers-cache'

// ── ModelEntry shape ─────────────────────────────────────────────

/**
 * @typedef {object} ModelEntry
 * @property {string} id - Short unique identifier (e.g. 'whisper-tiny-en')
 * @property {string} repo - HuggingFace repo or MediaPipe model path
 * @property {string} task - ML task name
 * @property {string} runtime - 'transformers' | 'mediapipe'
 * @property {string} description - Human-readable description
 * @property {number} sizeEstimate - Approximate size in bytes
 * @property {boolean} [quantized=true] - Whether to use quantized weights
 * @property {object} [pipelineOpts] - Extra options passed to pipeline()
 * @property {boolean} [defaultForTask] - Whether this is the default model for its task
 * @property {string} [mediapipeDelegate] - 'GPU' | 'CPU' for MediaPipe (default: 'GPU')
 */

// ── Default Model Catalog ────────────────────────────────────────

const MB = 1024 * 1024

/** @type {ModelEntry[]} */
const DEFAULT_MODELS = [
  // ── Transformers.js models ──
  {
    id: 'minilm-l6-v2',
    repo: 'Xenova/all-MiniLM-L6-v2',
    task: 'feature-extraction',
    runtime: 'transformers',
    description: 'Sentence embeddings (384 dims, fast)',
    sizeEstimate: 23 * MB,
    quantized: true,
    defaultForTask: true,
  },
  {
    id: 'bge-small-en',
    repo: 'Xenova/bge-small-en-v1.5',
    task: 'feature-extraction',
    runtime: 'transformers',
    description: 'BGE sentence embeddings (384 dims)',
    sizeEstimate: 33 * MB,
    quantized: true,
  },
  {
    id: 'whisper-tiny-en',
    repo: 'Xenova/whisper-tiny.en',
    task: 'automatic-speech-recognition',
    runtime: 'transformers',
    description: 'Whisper Tiny English — fast speech-to-text',
    sizeEstimate: 40 * MB,
    quantized: true,
    defaultForTask: true,
  },
  {
    id: 'whisper-small-en',
    repo: 'Xenova/whisper-small.en',
    task: 'automatic-speech-recognition',
    runtime: 'transformers',
    description: 'Whisper Small English — higher quality STT',
    sizeEstimate: 150 * MB,
    quantized: true,
  },
  {
    id: 'speecht5-tts',
    repo: 'Xenova/speecht5_tts',
    task: 'text-to-speech',
    runtime: 'transformers',
    description: 'SpeechT5 text-to-speech',
    sizeEstimate: 100 * MB,
    quantized: false,
    defaultForTask: true,
  },
  {
    id: 'vit-gpt2-captioner',
    repo: 'Xenova/vit-gpt2-image-captioning',
    task: 'image-to-text',
    runtime: 'transformers',
    description: 'ViT-GPT2 image captioning',
    sizeEstimate: 100 * MB,
    quantized: true,
    defaultForTask: true,
  },
  {
    id: 'trocr-small',
    repo: 'Xenova/trocr-small-printed',
    task: 'image-to-text-ocr',
    runtime: 'transformers',
    description: 'TrOCR small — printed text OCR',
    sizeEstimate: 80 * MB,
    quantized: true,
    defaultForTask: true,
  },

  // ── MediaPipe models ──
  {
    id: 'mp-object-detector',
    repo: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
    task: 'object-detection',
    runtime: 'mediapipe',
    description: 'EfficientDet Lite0 — fast object detection',
    sizeEstimate: 7 * MB,
    defaultForTask: true,
    mediapipeDelegate: 'GPU',
  },
  {
    id: 'mp-image-classifier',
    repo: 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite',
    task: 'image-classification',
    runtime: 'mediapipe',
    description: 'EfficientNet Lite0 — image classification',
    sizeEstimate: 15 * MB,
    defaultForTask: true,
    mediapipeDelegate: 'GPU',
  },
  {
    id: 'mp-image-segmenter',
    repo: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite',
    task: 'image-segmentation',
    runtime: 'mediapipe',
    description: 'DeepLab V3 — semantic image segmentation',
    sizeEstimate: 10 * MB,
    defaultForTask: true,
    mediapipeDelegate: 'GPU',
  },
  {
    id: 'mp-text-classifier',
    repo: 'https://storage.googleapis.com/mediapipe-models/text_classifier/bert_classifier/float32/1/bert_classifier.tflite',
    task: 'text-classification',
    runtime: 'mediapipe',
    description: 'BERT text classifier — sentiment analysis',
    sizeEstimate: 25 * MB,
    defaultForTask: true,
    mediapipeDelegate: 'CPU',
  },
]

// ── ModelRegistry ────────────────────────────────────────────────

export class ModelRegistry {
  #catalog = new Map()

  constructor() {
    for (const entry of DEFAULT_MODELS) {
      this.#catalog.set(entry.id, { ...entry })
    }
  }

  /** Register a custom model entry. */
  register(entry) {
    if (!entry?.id || !entry?.repo || !entry?.task || !entry?.runtime) {
      throw new Error('ModelEntry requires id, repo, task, and runtime')
    }
    this.#catalog.set(entry.id, { ...entry })
  }

  /** Remove a model from the registry. */
  unregister(id) {
    return this.#catalog.delete(id)
  }

  /** Get model entry by ID. */
  get(id) {
    return this.#catalog.get(id) || null
  }

  /** Check if model exists in registry. */
  has(id) {
    return this.#catalog.has(id)
  }

  /** List all models, optionally filtered by task. */
  list(task) {
    const all = [...this.#catalog.values()]
    return task ? all.filter(m => m.task === task) : all
  }

  /** Get unique task names. */
  tasks() {
    return [...new Set([...this.#catalog.values()].map(m => m.task))]
  }

  /** Search models by substring match on id, description, or repo. */
  search(query) {
    const q = query.toLowerCase()
    return [...this.#catalog.values()].filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.repo.toLowerCase().includes(q)
    )
  }

  /** Get the default model for a task. */
  getDefault(task) {
    return [...this.#catalog.values()].find(m => m.task === task && m.defaultForTask) || null
  }
}

// ── Cache Backends ───────────────────────────────────────────────

/**
 * CacheApiBackend — uses the browser Cache API.
 * This is what transformers.js uses natively, so getTransformersCache() returns null.
 */
export class CacheApiBackend {
  get name() { return 'cache-api' }

  async has(repo) {
    try {
      const cache = await caches.open(TRANSFORMERS_CACHE_NAME)
      const keys = await cache.keys()
      // Cache URLs contain literal repo paths (e.g. huggingface.co/Xenova/model-name)
      return keys.some(r => r.url.includes(repo))
    } catch { return false }
  }

  async delete(repo) {
    try {
      const cache = await caches.open(TRANSFORMERS_CACHE_NAME)
      const keys = await cache.keys()
      let deleted = 0
      for (const req of keys) {
        if (req.url.includes(repo)) {
          await cache.delete(req)
          deleted++
        }
      }
      return deleted > 0
    } catch { return false }
  }

  async list() {
    try {
      const cache = await caches.open(TRANSFORMERS_CACHE_NAME)
      const keys = await cache.keys()
      const repos = new Set()
      for (const req of keys) {
        // Extract org/model from HF CDN URL: .../org/model/resolve/rev/file
        try {
          const urlParts = new URL(req.url).pathname.split('/')
          const resolveIdx = urlParts.indexOf('resolve')
          if (resolveIdx >= 2) {
            repos.add(urlParts.slice(resolveIdx - 2, resolveIdx).join('/'))
          }
        } catch { /* skip malformed URLs */ }
      }
      return [...repos]
    } catch { return [] }
  }

  async usage() {
    try {
      const cache = await caches.open(TRANSFORMERS_CACHE_NAME)
      const keys = await cache.keys()
      let total = 0
      for (const req of keys) {
        const resp = await cache.match(req)
        if (resp) {
          const blob = await resp.blob()
          total += blob.size
        }
      }
      return total
    } catch { return 0 }
  }

  /** Returns null — transformers.js uses its default Cache API behavior. */
  getTransformersCache() { return null }
}

/**
 * FsAccessBackend — stores models in a mounted local directory.
 * Uses MountableFs + File System Access API.
 */
export class FsAccessBackend {
  #mountPath
  #fs

  /**
   * @param {string} mountPath - Mount point (e.g. '/mnt/models')
   * @param {object} fs - MountableFs reference
   */
  constructor(mountPath, fs) {
    this.#mountPath = mountPath
    this.#fs = fs
  }

  get name() { return 'fs-access' }
  get mountPath() { return this.#mountPath }

  #repoToDir(repo) {
    // HF convention: models--org--name
    return `models--${repo.replace('/', '--')}`
  }

  async has(repo) {
    try {
      const entries = await this.#fs.listMounted(this.#mountPath)
      if (!entries) return false
      const dirName = this.#repoToDir(repo)
      return entries.some(e => e.name === dirName && e.kind === 'directory')
    } catch { return false }
  }

  async delete(repo) {
    try {
      const resolved = this.#fs.resolveMount(`${this.#mountPath}/${this.#repoToDir(repo)}`)
      if (resolved?.type !== 'mount' || !resolved.handle) return false
      // Navigate to parent and remove directory
      const parentPath = this.#mountPath
      const parentResolved = this.#fs.resolveMount(parentPath)
      if (parentResolved?.handle) {
        await parentResolved.handle.removeEntry(this.#repoToDir(repo), { recursive: true })
        return true
      }
      return false
    } catch { return false }
  }

  async list() {
    try {
      const entries = await this.#fs.listMounted(this.#mountPath)
      if (!entries) return []
      return entries
        .filter(e => e.kind === 'directory' && e.name.startsWith('models--'))
        .map(e => {
          // Strip 'models--' prefix, then replace first '--' with '/' for org/name
          const stripped = e.name.slice('models--'.length)
          const dashIdx = stripped.indexOf('--')
          return dashIdx >= 0 ? stripped.slice(0, dashIdx) + '/' + stripped.slice(dashIdx + 2) : stripped
        })
    } catch { return [] }
  }

  async usage() {
    // Approximate: sum sizes of all files in model dirs
    try {
      const entries = await this.#fs.listMounted(this.#mountPath)
      if (!entries) return 0
      let total = 0
      for (const e of entries) {
        if (e.kind === 'directory' && e.name.startsWith('models--')) {
          const subEntries = await this.#fs.listMounted(`${this.#mountPath}/${e.name}`)
          if (subEntries) {
            for (const f of subEntries) {
              if (f.kind === 'file' && f.size) total += f.size
            }
          }
        }
      }
      return total
    } catch { return 0 }
  }

  /**
   * Returns a custom cache object for transformers.js env.customCache.
   * Intercepts model file requests and routes them to/from the local filesystem.
   */
  getTransformersCache() {
    const fs = this.#fs
    const mountPath = this.#mountPath

    return {
      async match(request) {
        try {
          const url = typeof request === 'string' ? request : request.url
          const filePath = urlToLocalPath(url, mountPath)
          if (!filePath) return undefined
          const content = await fs.readMounted(filePath)
          if (content === null) return undefined
          // content could be string or ArrayBuffer depending on FS impl
          return new Response(content)
        } catch { return undefined }
      },
      async put(request, response) {
        try {
          const url = typeof request === 'string' ? request : request.url
          const filePath = urlToLocalPath(url, mountPath)
          if (!filePath) return
          const blob = await response.blob()
          await fs.writeMounted(filePath, blob)
        } catch { /* best-effort */ }
      }
    }
  }
}

/**
 * Convert a HuggingFace CDN URL to a local file path.
 * @param {string} url - HF CDN URL
 * @param {string} mountPath - Local mount path
 * @returns {string|null}
 */
function urlToLocalPath(url, mountPath) {
  try {
    const u = new URL(url)
    // Pattern: https://huggingface.co/{org}/{model}/resolve/{rev}/{file}
    const parts = u.pathname.split('/')
    const resolveIdx = parts.indexOf('resolve')
    if (resolveIdx < 2) return null
    const org = parts[resolveIdx - 2]
    const model = parts[resolveIdx - 1]
    const file = parts.slice(resolveIdx + 2).join('/')
    return `${mountPath}/models--${org}--${model}/${file}`
  } catch { return null }
}

// Export for testing
export { urlToLocalPath }

// ── ModelCache ───────────────────────────────────────────────────

export class ModelCache {
  #backend

  constructor(backend) {
    this.#backend = backend || new CacheApiBackend()
  }

  /** Switch to a different backend. */
  setBackend(backend) { this.#backend = backend }

  /** Current backend name. */
  get backendName() { return this.#backend.name }

  /** Are model files cached for this repo? */
  async has(repo) { return this.#backend.has(repo) }

  /** Delete cached files for a repo. */
  async delete(repo) { return this.#backend.delete(repo) }

  /** Total bytes cached. */
  async usage() { return this.#backend.usage() }

  /** List cached repo names. */
  async list() { return this.#backend.list() }

  /** Get custom cache for transformers.js env, or null for default. */
  getTransformersCache() { return this.#backend.getTransformersCache() }
}

// ── ModelManager ─────────────────────────────────────────────────

export class ModelManager {
  #registry
  #cache
  #pipelines = new Map()     // id → { pipeline, task, runtime }
  #loading = new Map()       // id → Promise (dedup concurrent loads)
  #pipelineFactory
  #mediapipeFactory

  /**
   * @param {object} opts
   * @param {ModelRegistry} opts.registry
   * @param {ModelCache} opts.cache
   * @param {Function} [opts.pipelineFactory] - async (task, repo, opts) → pipeline (for transformers.js)
   * @param {Function} [opts.mediapipeFactory] - async (task, modelUrl, opts) → instance (for MediaPipe)
   */
  constructor({ registry, cache, pipelineFactory, mediapipeFactory } = {}) {
    this.#registry = registry || new ModelRegistry()
    this.#cache = cache || new ModelCache()
    this.#pipelineFactory = pipelineFactory || defaultTransformersFactory
    this.#mediapipeFactory = mediapipeFactory || defaultMediaPipeFactory
  }

  get registry() { return this.#registry }
  get cache() { return this.#cache }

  /**
   * Download model to cache without loading it.
   * @param {string} modelId
   * @param {Function} [onProgress] - (progress: {status, progress?, file?}) => void
   */
  async pull(modelId, onProgress) {
    const entry = this.#registry.get(modelId)
    if (!entry) throw new Error(`Unknown model: ${modelId}`)

    if (entry.runtime === 'mediapipe') {
      // MediaPipe models are single files — fetch and cache
      const resp = await fetch(entry.repo)
      if (!resp.ok) throw new Error(`Failed to download: ${resp.statusText}`)
      const cache = await caches.open('mediapipe-models')
      await cache.put(entry.repo, resp)
      onProgress?.({ status: 'done', progress: 1 })
      return
    }

    // Transformers.js: load the pipeline (which downloads), then dispose
    const customCache = this.#cache.getTransformersCache()
    const pipe = await this.#pipelineFactory(entry.task, entry.repo, {
      quantized: entry.quantized !== false,
      progress_callback: onProgress,
      ...(customCache ? { cache: customCache } : {}),
      ...(entry.pipelineOpts || {}),
    })
    // Dispose immediately — we just wanted the download
    if (pipe?.dispose) pipe.dispose()
    onProgress?.({ status: 'done', progress: 1 })
  }

  /**
   * Load model into memory, downloading first if needed.
   * Returns the pipeline/instance.
   */
  async load(modelId) {
    const entry = this.#registry.get(modelId)
    if (!entry) throw new Error(`Unknown model: ${modelId}`)

    // Already loaded?
    if (this.#pipelines.has(modelId)) {
      return this.#pipelines.get(modelId).pipeline
    }

    // Dedup concurrent loads
    if (this.#loading.has(modelId)) {
      return this.#loading.get(modelId)
    }

    const loadPromise = this.#doLoad(entry)
    this.#loading.set(modelId, loadPromise)

    try {
      const pipeline = await loadPromise
      this.#pipelines.set(modelId, { pipeline, task: entry.task, runtime: entry.runtime })
      return pipeline
    } finally {
      this.#loading.delete(modelId)
    }
  }

  async #doLoad(entry) {
    if (entry.runtime === 'mediapipe') {
      return this.#mediapipeFactory(entry.task, entry.repo, {
        delegate: entry.mediapipeDelegate || 'GPU',
        ...(entry.pipelineOpts || {}),
      })
    }

    const customCache = this.#cache.getTransformersCache()
    return this.#pipelineFactory(entry.task, entry.repo, {
      quantized: entry.quantized !== false,
      ...(customCache ? { cache: customCache } : {}),
      ...(entry.pipelineOpts || {}),
    })
  }

  /** Unload model from memory. */
  unload(modelId) {
    const loaded = this.#pipelines.get(modelId)
    if (!loaded) return false
    if (loaded.pipeline?.dispose) loaded.pipeline.dispose()
    if (loaded.pipeline?.close) loaded.pipeline.close()
    this.#pipelines.delete(modelId)
    return true
  }

  /** Delete model from cache. */
  async remove(modelId) {
    this.unload(modelId)
    const entry = this.#registry.get(modelId)
    if (!entry) return false

    if (entry.runtime === 'mediapipe') {
      try {
        const cache = await caches.open('mediapipe-models')
        return cache.delete(entry.repo)
      } catch { return false }
    }

    return this.#cache.delete(entry.repo)
  }

  /** Get status of a model. */
  status(modelId) {
    if (this.#pipelines.has(modelId)) return 'loaded'
    if (this.#loading.has(modelId)) return 'loading'
    return 'cached_or_not' // Async check needed for definitive answer
  }

  /** Get detailed status (async). */
  async statusAsync(modelId) {
    if (this.#pipelines.has(modelId)) return 'loaded'
    if (this.#loading.has(modelId)) return 'loading'
    const entry = this.#registry.get(modelId)
    if (!entry) return 'unknown'

    if (entry.runtime === 'mediapipe') {
      try {
        const cache = await caches.open('mediapipe-models')
        const match = await cache.match(entry.repo)
        return match ? 'cached' : 'not_cached'
      } catch { return 'not_cached' }
    }

    const cached = await this.#cache.has(entry.repo)
    return cached ? 'cached' : 'not_cached'
  }

  /** Get status of all registered models. */
  async statusAll() {
    const results = []
    for (const entry of this.#registry.list()) {
      const s = await this.statusAsync(entry.id)
      results.push({ id: entry.id, task: entry.task, runtime: entry.runtime, status: s, sizeEstimate: entry.sizeEstimate })
    }
    return results
  }

  /** Get already-loaded pipeline (throws if not loaded). */
  getPipeline(modelId) {
    const loaded = this.#pipelines.get(modelId)
    if (!loaded) throw new Error(`Model not loaded: ${modelId}`)
    return loaded.pipeline
  }

  /** Load the default model for a task and return its pipeline. */
  async getByTask(task) {
    const entry = this.#registry.getDefault(task)
    if (!entry) throw new Error(`No default model for task: ${task}`)
    return this.load(entry.id)
  }

  /** Unload all models. */
  unloadAll() {
    // Snapshot keys to avoid mutating Map during iteration
    for (const id of [...this.#pipelines.keys()]) {
      this.unload(id)
    }
  }

  /** List loaded model IDs. */
  loadedModels() {
    return [...this.#pipelines.keys()]
  }
}

// ── Default Factories ────────────────────────────────────────────

async function defaultTransformersFactory(task, model, opts = {}) {
  const { pipeline, env } = await import(TRANSFORMERS_CDN)
  if (opts.cache) {
    env.useCustomCache = true
    env.customCache = opts.cache
  }
  const { cache: _cache, progress_callback, ...pipeOpts } = opts
  return pipeline(task, model, { progress_callback, ...pipeOpts })
}

async function defaultMediaPipeFactory(task, modelUrl, opts = {}) {
  const taskMap = {
    'object-detection': { pkg: MEDIAPIPE_VISION_CDN, cls: 'ObjectDetector' },
    'image-classification': { pkg: MEDIAPIPE_VISION_CDN, cls: 'ImageClassifier' },
    'image-segmentation': { pkg: MEDIAPIPE_VISION_CDN, cls: 'ImageSegmenter' },
    'text-classification': { pkg: MEDIAPIPE_TEXT_CDN, cls: 'TextClassifier' },
  }

  const mapping = taskMap[task]
  if (!mapping) throw new Error(`Unsupported MediaPipe task: ${task}`)

  const mod = await import(mapping.pkg)
  const { FilesetResolver } = mod
  const TaskClass = mod[mapping.cls]

  // Determine WASM path — use correct resolver for the task category
  const isTextTask = task.startsWith('text')
  const wasmPath = `${isTextTask ? MEDIAPIPE_TEXT_CDN : MEDIAPIPE_VISION_CDN}/wasm`

  const fileset = isTextTask
    ? await FilesetResolver.forTextTasks(wasmPath)
    : await FilesetResolver.forVisionTasks(wasmPath)

  return TaskClass.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: modelUrl,
      delegate: opts.delegate || 'GPU',
    },
    ...(opts.taskOptions || {}),
  })
}

// ── Pipeline Wrappers ────────────────────────────────────────────

/**
 * ManagedEmbeddingProvider — uses ModelManager for embedding.
 * Drop-in replacement for TransformersEmbeddingProvider.
 */
export class ManagedEmbeddingProvider extends EmbeddingProvider {
  #manager
  #modelId

  /**
   * @param {ModelManager} manager
   * @param {string} [modelId='minilm-l6-v2']
   */
  constructor(manager, modelId = 'minilm-l6-v2') {
    super()
    this.#manager = manager
    this.#modelId = modelId
  }

  get name() { return 'managed-transformers' }
  get dimensions() { return 384 }

  async embed(text) {
    if (!text) return null
    try {
      const pipe = await this.#manager.load(this.#modelId)
      const output = await pipe(text, { pooling: 'mean', normalize: true })
      return new Float32Array(output.data)
    } catch { return null }
  }
}

/**
 * SpeechToText — automatic speech recognition using Whisper.
 */
export class SpeechToText {
  #manager
  #modelId

  constructor(manager, modelId) {
    this.#manager = manager
    this.#modelId = modelId
  }

  /**
   * Transcribe audio.
   * @param {string|Float32Array|Blob|ArrayBuffer} audio - URL, data URI, Float32Array PCM, Blob, or ArrayBuffer
   * @returns {Promise<{text: string}>}
   */
  async transcribe(audio) {
    const id = this.#modelId || this.#manager.registry.getDefault('automatic-speech-recognition')?.id
    if (!id) throw new Error('No ASR model available')
    const pipe = await this.#manager.load(id)

    // Pass through to pipeline — transformers.js handles URLs, Float32Array,
    // and Blob natively. Do NOT wrap raw bytes as Float32Array (that would
    // include WAV/MP3 headers as PCM samples).
    const result = await pipe(audio)
    return { text: result?.text || '' }
  }
}

/**
 * TextToSpeech — TTS using SpeechT5.
 */
export class TextToSpeech {
  #manager
  #modelId

  constructor(manager, modelId) {
    this.#manager = manager
    this.#modelId = modelId
  }

  /**
   * Synthesize speech from text.
   * @param {string} text
   * @returns {Promise<{audio: Float32Array, sampling_rate: number}>}
   */
  async synthesize(text) {
    const id = this.#modelId || this.#manager.registry.getDefault('text-to-speech')?.id
    if (!id) throw new Error('No TTS model available')
    const pipe = await this.#manager.load(id)
    const result = await pipe(text)
    return { audio: result.audio, sampling_rate: result.sampling_rate || 16000 }
  }
}

/**
 * ImageCaptioner — generate captions for images.
 */
export class ImageCaptioner {
  #manager
  #modelId

  constructor(manager, modelId) {
    this.#manager = manager
    this.#modelId = modelId
  }

  /**
   * Caption an image.
   * @param {string|Blob} image - URL, data URI, or Blob
   * @returns {Promise<string>}
   */
  async caption(image) {
    const id = this.#modelId || this.#manager.registry.getDefault('image-to-text')?.id
    if (!id) throw new Error('No captioning model available')
    const pipe = await this.#manager.load(id)
    const result = await pipe(image)
    return result?.[0]?.generated_text || ''
  }
}

/**
 * DocumentOCR — extract text from images of documents.
 */
export class DocumentOCR {
  #manager
  #modelId

  constructor(manager, modelId) {
    this.#manager = manager
    this.#modelId = modelId
  }

  /**
   * Extract text from an image.
   * @param {string|Blob} image - URL, data URI, or Blob
   * @returns {Promise<string>}
   */
  async recognize(image) {
    const id = this.#modelId || this.#manager.registry.getDefault('image-to-text-ocr')?.id
    if (!id) throw new Error('No OCR model available')
    const pipe = await this.#manager.load(id)
    const result = await pipe(image)
    return result?.[0]?.generated_text || ''
  }
}

/**
 * ObjectDetector — detect objects in images using MediaPipe.
 */
export class ObjectDetector {
  #manager
  #modelId

  constructor(manager, modelId) {
    this.#manager = manager
    this.#modelId = modelId
  }

  /**
   * Detect objects in an image.
   * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement|ImageBitmap} image
   * @returns {Promise<Array<{label: string, score: number, box: {x: number, y: number, width: number, height: number}}>>}
   */
  async detect(image) {
    const id = this.#modelId || this.#manager.registry.getDefault('object-detection')?.id
    if (!id) throw new Error('No object detection model available')
    const detector = await this.#manager.load(id)
    const result = detector.detect(image)
    return (result?.detections || []).map(d => ({
      label: d.categories?.[0]?.categoryName || 'unknown',
      score: d.categories?.[0]?.score || 0,
      box: d.boundingBox ? {
        x: d.boundingBox.originX,
        y: d.boundingBox.originY,
        width: d.boundingBox.width,
        height: d.boundingBox.height,
      } : null,
    }))
  }
}

/**
 * ImageClassifier — classify images using MediaPipe.
 */
export class ImageClassifier {
  #manager
  #modelId

  constructor(manager, modelId) {
    this.#manager = manager
    this.#modelId = modelId
  }

  /**
   * Classify an image.
   * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement|ImageBitmap} image
   * @returns {Promise<Array<{label: string, score: number}>>}
   */
  async classify(image) {
    const id = this.#modelId || this.#manager.registry.getDefault('image-classification')?.id
    if (!id) throw new Error('No image classification model available')
    const classifier = await this.#manager.load(id)
    const result = classifier.classify(image)
    return (result?.classifications?.[0]?.categories || []).map(c => ({
      label: c.categoryName || 'unknown',
      score: c.score || 0,
    }))
  }
}

/**
 * ImageSegmenter — segment images using MediaPipe.
 */
export class ImageSegmenter {
  #manager
  #modelId

  constructor(manager, modelId) {
    this.#manager = manager
    this.#modelId = modelId
  }

  /**
   * Segment an image.
   * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement|ImageBitmap} image
   * @returns {Promise<{labels: string[], mask: Uint8Array, width: number, height: number}>}
   */
  async segment(image) {
    const id = this.#modelId || this.#manager.registry.getDefault('image-segmentation')?.id
    if (!id) throw new Error('No image segmentation model available')
    const segmenter = await this.#manager.load(id)
    const result = segmenter.segment(image)
    return {
      labels: result?.categoryMask?.labels || [],
      mask: result?.categoryMask?.mask || new Uint8Array(0),
      width: result?.categoryMask?.width || 0,
      height: result?.categoryMask?.height || 0,
    }
  }
}

/**
 * TextClassifier — classify text using MediaPipe.
 */
export class TextClassifier {
  #manager
  #modelId

  constructor(manager, modelId) {
    this.#manager = manager
    this.#modelId = modelId
  }

  /**
   * Classify text (e.g. sentiment analysis).
   * @param {string} text
   * @returns {Promise<Array<{label: string, score: number}>>}
   */
  async classify(text) {
    const id = this.#modelId || this.#manager.registry.getDefault('text-classification')?.id
    if (!id) throw new Error('No text classification model available')
    const classifier = await this.#manager.load(id)
    const result = classifier.classify(text)
    return (result?.classifications?.[0]?.categories || []).map(c => ({
      label: c.categoryName || 'unknown',
      score: c.score || 0,
    }))
  }
}

// ── Utility ──────────────────────────────────────────────────────

/** Format bytes as human-readable string. */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
