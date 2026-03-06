/**
 * clawser-model-tools.js — Agent tools for local AI model management
 *
 * Provides BrowserTool subclasses for:
 *   - Model lifecycle: list, pull, remove, status
 *   - ML pipelines: transcribe, speak, caption, ocr, detect_objects, classify_image, classify_text
 */

import { BrowserTool } from './clawser-tools.js'
import { formatBytes } from './clawser-models.js'

// ── Model Management Tools ──────────────────────────────────────

export class ModelListTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'model_list' }
  get description() { return 'List available local AI models, optionally filtered by task. Shows ID, task, runtime, size, and status.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Filter by ML task (e.g. feature-extraction, object-detection)' },
      },
    }
  }
  get permission() { return 'read' }

  async execute({ task } = {}) {
    try {
      const models = this.#manager.registry.list(task)
      const statuses = await this.#manager.statusAll()
      const statusMap = new Map(statuses.map(s => [s.id, s.status]))

      const lines = ['ID | Task | Runtime | Size | Status', '---|------|---------|------|-------']
      for (const m of models) {
        const status = statusMap.get(m.id) || 'unknown'
        const def = m.defaultForTask ? ' *' : ''
        lines.push(`${m.id}${def} | ${m.task} | ${m.runtime} | ${formatBytes(m.sizeEstimate || 0)} | ${status}`)
      }
      if (task) lines.push(`\n(filtered by task: ${task})`)
      lines.push('\n* = default for task')
      return { success: true, output: lines.join('\n') }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class ModelPullTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'model_pull' }
  get description() { return 'Download a local AI model to cache without loading it into memory. Use model_list to see available models.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model ID to download (e.g. whisper-tiny-en, mp-object-detector)' },
      },
      required: ['model'],
    }
  }
  get permission() { return 'write' }

  async execute({ model }) {
    try {
      const entry = this.#manager.registry.get(model)
      if (!entry) return { success: false, output: '', error: `Unknown model: ${model}. Use model_list to see available models.` }

      const progressMsgs = []
      await this.#manager.pull(model, (p) => {
        if (p.status === 'downloading' || p.status === 'progress') {
          const pct = p.progress != null ? `${(p.progress * 100).toFixed(0)}%` : ''
          progressMsgs.push(`${p.status} ${p.file || ''} ${pct}`.trim())
        }
      })
      return { success: true, output: `Downloaded ${model} (${entry.runtime}, ~${formatBytes(entry.sizeEstimate || 0)})` }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class ModelRemoveTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'model_remove' }
  get description() { return 'Delete a cached local AI model to free storage space.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model ID to remove' },
      },
      required: ['model'],
    }
  }
  get permission() { return 'write' }

  async execute({ model }) {
    try {
      await this.#manager.remove(model)
      return { success: true, output: `Removed ${model} from cache` }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class ModelStatusTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'model_status' }
  get description() { return 'Show status of local AI models (loaded, cached, or not cached).' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model ID to check (omit for all models)' },
      },
    }
  }
  get permission() { return 'read' }

  async execute({ model } = {}) {
    try {
      if (model) {
        const entry = this.#manager.registry.get(model)
        if (!entry) return { success: false, output: '', error: `Unknown model: ${model}` }
        const status = await this.#manager.statusAsync(model)
        return { success: true, output: `${model}: ${status} (${entry.runtime}, ${entry.task})` }
      }
      const all = await this.#manager.statusAll()
      const loaded = all.filter(s => s.status === 'loaded')
      const cached = all.filter(s => s.status === 'cached')
      const lines = [
        `Models: ${all.length} registered, ${loaded.length} loaded, ${cached.length} cached`,
        `Cache backend: ${this.#manager.cache.backendName}`,
      ]
      if (loaded.length) {
        lines.push('\nLoaded:')
        for (const s of loaded) lines.push(`  ${s.id} (${s.runtime}, ${s.task})`)
      }
      return { success: true, output: lines.join('\n') }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

// ── Pipeline Tools ───────────────────────────────────────────────

export class TranscribeTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'transcribe' }
  get description() { return 'Transcribe audio to text using a local Whisper model. Accepts an audio URL or base64 data URI.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        audio_url: { type: 'string', description: 'URL or data URI of audio to transcribe' },
        model: { type: 'string', description: 'Model ID (default: whisper-tiny-en)' },
      },
      required: ['audio_url'],
    }
  }
  get permission() { return 'read' }

  async execute({ audio_url, model }) {
    try {
      const modelId = model || 'whisper-tiny-en'
      const pipe = await this.#manager.load(modelId)

      // Pass URL/data URI directly to pipeline — transformers.js handles
      // fetching and audio decoding (WAV, MP3, etc.) internally
      const result = await pipe(audio_url)
      return { success: true, output: result?.text || '' }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class SpeakTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'speak' }
  get description() { return 'Convert text to speech using a local TTS model. Returns audio as a base64 WAV data URI.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to synthesize' },
        model: { type: 'string', description: 'Model ID (default: speecht5-tts)' },
      },
      required: ['text'],
    }
  }
  get permission() { return 'write' }

  async execute({ text, model }) {
    try {
      const modelId = model || 'speecht5-tts'
      const pipe = await this.#manager.load(modelId)
      const result = await pipe(text)
      const audio = result?.audio
      const sr = result?.sampling_rate || 16000
      // Encode as base64 WAV data URI
      if (audio) {
        const wavBytes = encodeWav(audio, sr)
        const b64 = arrayBufferToBase64(wavBytes)
        return { success: true, output: `data:audio/wav;base64,${b64}` }
      }
      return { success: true, output: 'No audio generated' }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class CaptionTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'caption' }
  get description() { return 'Generate a text caption for an image using a local vision model.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL or data URI of image to caption' },
        model: { type: 'string', description: 'Model ID (default: vit-gpt2-captioner)' },
      },
      required: ['image_url'],
    }
  }
  get permission() { return 'read' }

  async execute({ image_url, model }) {
    try {
      const modelId = model || 'vit-gpt2-captioner'
      const pipe = await this.#manager.load(modelId)
      const result = await pipe(image_url)
      const text = result?.[0]?.generated_text || ''
      return { success: true, output: text }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class OcrTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'ocr' }
  get description() { return 'Extract text from an image using a local OCR model.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL or data URI of image with text' },
        model: { type: 'string', description: 'Model ID (default: trocr-small)' },
      },
      required: ['image_url'],
    }
  }
  get permission() { return 'read' }

  async execute({ image_url, model }) {
    try {
      const modelId = model || 'trocr-small'
      const pipe = await this.#manager.load(modelId)
      const result = await pipe(image_url)
      const text = result?.[0]?.generated_text || ''
      return { success: true, output: text }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class DetectObjectsTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'detect_objects' }
  get description() { return 'Detect objects in an image using a local MediaPipe model. Returns labels, scores, and bounding boxes.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL or data URI of image' },
        model: { type: 'string', description: 'Model ID (default: mp-object-detector)' },
      },
      required: ['image_url'],
    }
  }
  get permission() { return 'read' }

  async execute({ image_url, model }) {
    try {
      const modelId = model || 'mp-object-detector'
      const detector = await this.#manager.load(modelId)
      // MediaPipe vision tasks need an image element, not a URL string
      const image = await loadImageElement(image_url)
      const result = detector.detect(image)
      const detections = (result?.detections || []).map(d => ({
        label: d.categories?.[0]?.categoryName || 'unknown',
        score: (d.categories?.[0]?.score || 0).toFixed(3),
        box: d.boundingBox || null,
      }))
      return { success: true, output: JSON.stringify(detections, null, 2) }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class ClassifyImageTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'classify_image' }
  get description() { return 'Classify an image using a local MediaPipe model. Returns top labels with confidence scores.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL or data URI of image' },
        model: { type: 'string', description: 'Model ID (default: mp-image-classifier)' },
      },
      required: ['image_url'],
    }
  }
  get permission() { return 'read' }

  async execute({ image_url, model }) {
    try {
      const modelId = model || 'mp-image-classifier'
      const classifier = await this.#manager.load(modelId)
      const image = await loadImageElement(image_url)
      const result = classifier.classify(image)
      const categories = (result?.classifications?.[0]?.categories || [])
        .slice(0, 5)
        .map(c => `${c.categoryName}: ${(c.score * 100).toFixed(1)}%`)
      return { success: true, output: categories.join('\n') || 'No classifications' }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

export class ClassifyTextTool extends BrowserTool {
  #manager
  constructor(manager) { super(); this.#manager = manager }

  get name() { return 'classify_text' }
  get description() { return 'Classify text (e.g. sentiment analysis) using a local MediaPipe model.' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to classify' },
        model: { type: 'string', description: 'Model ID (default: mp-text-classifier)' },
      },
      required: ['text'],
    }
  }
  get permission() { return 'read' }

  async execute({ text, model }) {
    try {
      const modelId = model || 'mp-text-classifier'
      const classifier = await this.#manager.load(modelId)
      const result = classifier.classify(text)
      const categories = (result?.classifications?.[0]?.categories || [])
        .slice(0, 5)
        .map(c => `${c.categoryName}: ${(c.score * 100).toFixed(1)}%`)
      return { success: true, output: categories.join('\n') || 'No classifications' }
    } catch (e) {
      return { success: false, output: '', error: e.message }
    }
  }
}

// ── Image Loading Utility ─────────────────────────────────────────

/**
 * Load a URL or data URI into an HTMLImageElement for MediaPipe vision tasks.
 * Falls back to returning the URL string if Image is not available (e.g. in tests).
 */
function loadImageElement(url) {
  if (typeof Image === 'undefined') return Promise.resolve(url)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

// ── WAV Encoding Utility ─────────────────────────────────────────

/** Encode Float32Array audio as WAV bytes. */
function encodeWav(samples, sampleRate) {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Convert Float32 to Int16
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }

  return buffer
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/** Convert ArrayBuffer to base64 without stack overflow (chunked). */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const chunks = []
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    chunks.push(String.fromCharCode.apply(null, chunk))
  }
  return btoa(chunks.join(''))
}
