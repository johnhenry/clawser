/**
 * Shared audit recorder for remote-runtime flows.
 */

function sanitize(value) {
  if (value == null) return value
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry))
  if (value instanceof Uint8Array) return { type: 'bytes', length: value.byteLength }
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = sanitize(entry)
    }
    return out
  }
  return value
}

export class RemoteRuntimeAuditRecorder {
  #auditChain
  #authorId
  #onLog

  constructor({ auditChain = null, authorId = 'local', onLog = null } = {}) {
    this.#auditChain = auditChain
    this.#authorId = authorId || 'local'
    this.#onLog = onLog
  }

  async record(operation, data = {}) {
    if (!this.#auditChain?.append) return null
    try {
      return await this.#auditChain.append(
        this.#authorId,
        operation,
        {
          ...sanitize(data),
          recordedAt: Date.now(),
        },
        async (bytes) => bytes,
      )
    } catch (error) {
      this.#onLog?.(0, `[remote-audit] ${error.message}`)
      return null
    }
  }
}

