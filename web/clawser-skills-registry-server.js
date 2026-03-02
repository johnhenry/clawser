/**
 * Clawser Skills Registry Server
 *
 * Virtual server that provides REST-like routes for listing and publishing
 * skills. Designed to run in-browser with OPFS storage, and can export
 * a static JSON catalog suitable for GitHub Pages hosting.
 *
 * Routes:
 *   GET  /skills         — List all published skills (supports ?q= search)
 *   POST /skills         — Publish a new skill version
 *   GET  /skills/:id     — Get a single skill by ID
 *   GET  /export         — Static JSON export for hosting
 *
 * Request format:
 *   { method: string, path: string, body?: object, query?: object }
 *
 * Response format:
 *   { status: number, body: object, headers?: object }
 */

// ── SkillsRegistryServer ─────────────────────────────────────────

export class SkillsRegistryServer {
  /** @type {Map<string, object>} id → skill entry */
  #skills = new Map();

  /** @type {number} Auto-increment counter for IDs */
  #nextId = 1;

  /** @type {Function|null} Optional OPFS persistence callback */
  #onPersist = null;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.onPersist] - Called after mutations with the full skill list
   */
  constructor(opts = {}) {
    this.#onPersist = opts.onPersist || null;
  }

  /**
   * Handle an incoming request.
   * @param {{ method: string, path: string, body?: object, query?: object }} req
   * @returns {Promise<{ status: number, body: object, headers?: object }>}
   */
  async handleRequest(req) {
    const { method, path } = req;

    // Route: GET /skills
    if (method === 'GET' && path === '/skills') {
      return this.#handleListSkills(req);
    }

    // Route: POST /skills
    if (method === 'POST' && path === '/skills') {
      return this.#handlePublishSkill(req);
    }

    // Route: GET /skills/:id
    if (method === 'GET' && path.startsWith('/skills/')) {
      const id = path.slice('/skills/'.length);
      return this.#handleGetSkill(id);
    }

    // Route: GET /export
    if (method === 'GET' && path === '/export') {
      return { status: 200, body: JSON.parse(this.exportStaticJSON()) };
    }

    // Method not allowed
    if (path === '/skills' && method !== 'GET' && method !== 'POST') {
      return { status: 405, body: { error: `Method ${method} not allowed on ${path}` } };
    }

    return { status: 404, body: { error: `Not found: ${path}` } };
  }

  /**
   * List skills with optional search filter.
   * @param {{ query?: { q?: string, category?: string, author?: string, limit?: string } }} req
   * @returns {{ status: number, body: { skills: object[] } }}
   */
  #handleListSkills(req) {
    let skills = [...this.#skills.values()];
    const query = req.query || {};

    // Text search
    if (query.q) {
      const q = query.q.toLowerCase();
      skills = skills.filter(s => {
        const haystack = [s.name, s.description, s.author, ...(s.tags || [])].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    // Category filter
    if (query.category) {
      skills = skills.filter(s => s.category === query.category);
    }

    // Author filter
    if (query.author) {
      skills = skills.filter(s => s.author === query.author);
    }

    // Sort by publishedAt descending (newest first)
    skills.sort((a, b) => b.publishedAt - a.publishedAt);

    // Limit
    const limit = parseInt(query.limit, 10) || 100;
    skills = skills.slice(0, limit);

    // Strip content from list responses (keep metadata only)
    const entries = skills.map(({ content, ...meta }) => meta);

    return { status: 200, body: { skills: entries, total: this.#skills.size } };
  }

  /**
   * Publish a new skill.
   * @param {{ body: { name, version, description, author, content, category?, tags? } }} req
   * @returns {Promise<{ status: number, body: object }>}
   */
  async #handlePublishSkill(req) {
    const { body } = req;
    if (!body) return { status: 400, body: { error: 'Request body required' } };

    // Validate required fields
    const required = ['name', 'version', 'description', 'author', 'content'];
    for (const field of required) {
      if (!body[field]) {
        return { status: 400, body: { error: `Missing required field: ${field}` } };
      }
    }

    // Check for duplicate name+version
    for (const existing of this.#skills.values()) {
      if (existing.name === body.name && existing.version === body.version) {
        return {
          status: 409,
          body: { error: `Skill ${body.name}@${body.version} already exists`, existingId: existing.id },
        };
      }
    }

    const id = `skill_${this.#nextId++}`;
    const entry = {
      id,
      name: body.name,
      version: body.version,
      description: body.description,
      author: body.author,
      content: body.content,
      category: body.category || 'general',
      tags: body.tags || [],
      publishedAt: Date.now(),
      downloads: 0,
      rating: 0,
      ratingCount: 0,
    };

    this.#skills.set(id, entry);

    // Persist
    if (this.#onPersist) {
      try { await this.#onPersist([...this.#skills.values()]); } catch { /* ignore */ }
    }

    const { content, ...meta } = entry;
    return { status: 201, body: meta };
  }

  /**
   * Get a single skill by ID (includes content).
   * @param {string} id
   * @returns {{ status: number, body: object }}
   */
  #handleGetSkill(id) {
    const skill = this.#skills.get(id);
    if (!skill) return { status: 404, body: { error: `Skill not found: ${id}` } };
    return { status: 200, body: { ...skill } };
  }

  /**
   * Export the full registry as a static JSON string.
   * Suitable for serving via GitHub Pages or any static host.
   * @returns {string}
   */
  exportStaticJSON() {
    const skills = [...this.#skills.values()].map(({ content, ...meta }) => meta);
    const catalog = {
      generatedAt: new Date().toISOString(),
      total: skills.length,
      skills,
      categories: [...new Set(skills.map(s => s.category))].sort(),
    };
    return JSON.stringify(catalog, null, 2);
  }

  /**
   * Import skills from a JSON catalog (e.g., loaded from static hosting).
   * @param {string} json
   */
  importFromJSON(json) {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data.skills)) return;
      for (const skill of data.skills) {
        if (skill.id && !this.#skills.has(skill.id)) {
          this.#skills.set(skill.id, { ...skill, content: skill.content || '' });
          const num = parseInt(skill.id.replace('skill_', ''), 10);
          if (!isNaN(num) && num >= this.#nextId) this.#nextId = num + 1;
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  /**
   * Get the total number of published skills.
   * @returns {number}
   */
  get size() { return this.#skills.size; }

  /**
   * Clear all skills.
   */
  clear() {
    this.#skills.clear();
    this.#nextId = 1;
  }
}
