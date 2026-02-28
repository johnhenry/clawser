// clawser-auth-profiles.js — Auth Profiles (Multi-Account Provider Management)
//
// AuthProfile: provider credential set with metadata
// AuthProfileManager: CRUD, switching, credential access, workspace binding

import { BrowserTool } from './clawser-tools.js';

// ── AuthProfile ─────────────────────────────────────────────────

/**
 * Generate a unique profile ID.
 * @returns {string}
 */
function nextProfileId() {
  const rand = crypto.randomUUID().slice(0, 8);
  return `prof_${rand}`;
}

/**
 * Auth profile data structure.
 * @typedef {object} AuthProfile
 * @property {string} id
 * @property {string} name - User-friendly label
 * @property {string} provider - Provider ID (openai, anthropic, etc.)
 * @property {'api_key'|'oauth'|'token'|'none'} authType
 * @property {string|null} baseUrl - Custom endpoint override
 * @property {string|null} defaultModel
 * @property {object} metadata
 */

/**
 * Create an auth profile.
 * @param {object} opts
 * @returns {AuthProfile}
 */
export function createAuthProfile(opts) {
  return {
    id: opts.id || nextProfileId(),
    name: opts.name || 'Default',
    provider: opts.provider,
    authType: opts.authType || 'api_key',
    baseUrl: opts.baseUrl || null,
    defaultModel: opts.defaultModel || null,
    metadata: {
      organization: opts.organization || null,
      project: opts.project || null,
      created: opts.created || Date.now(),
      lastUsed: opts.lastUsed || null,
      ...(opts.metadata || {}),
    },
  };
}

// ── AuthProfileManager ──────────────────────────────────────────

/**
 * Manages auth profiles with encrypted credential storage.
 */
export class AuthProfileManager {
  /** @type {Map<string, AuthProfile>} profileId → profile */
  #profiles = new Map();

  /** @type {Map<string, string>} providerId → active profileId */
  #active = new Map();

  /** @type {object|null} Vault interface: { store, retrieve, delete } */
  #vault;

  /** @type {Function|null} Callback when profile changes */
  #onProfileChanged;

  /**
   * @param {object} [opts]
   * @param {object} [opts.vault] - SecretVault instance (Block 5)
   * @param {Function} [opts.onProfileChanged] - (provider, profileId) callback
   */
  constructor(opts = {}) {
    this.#vault = opts.vault || null;
    this.#onProfileChanged = opts.onProfileChanged || null;
  }

  /**
   * Add a new auth profile.
   * @param {string} provider - Provider ID
   * @param {string} name - Profile name
   * @param {object} credentials - Credentials to encrypt
   * @param {object} [opts] - Additional profile options
   * @returns {Promise<AuthProfile>}
   */
  async addProfile(provider, name, credentials, opts = {}) {
    const profile = createAuthProfile({
      name,
      provider,
      ...opts,
    });

    // Encrypt credentials in vault
    if (this.#vault) {
      await this.#vault.store(`auth_${profile.id}`, credentials);
    }

    this.#profiles.set(profile.id, profile);

    // Auto-activate if first profile for this provider
    if (!this.#active.has(provider)) {
      this.#active.set(provider, profile.id);
    }

    return profile;
  }

  /**
   * Remove a profile.
   * @param {string} id - Profile ID
   * @returns {Promise<boolean>}
   */
  async removeProfile(id) {
    const profile = this.#profiles.get(id);
    if (!profile) return false;

    // Remove credentials from vault
    if (this.#vault) {
      await this.#vault.delete(`auth_${id}`);
    }

    this.#profiles.delete(id);

    // If was active, switch to another profile for same provider
    if (this.#active.get(profile.provider) === id) {
      const alt = this.listProfiles(profile.provider)[0];
      if (alt) {
        this.#active.set(profile.provider, alt.id);
      } else {
        this.#active.delete(profile.provider);
      }
    }

    return true;
  }

  /**
   * Switch active profile for a provider.
   * @param {string} provider
   * @param {string} profileId
   * @returns {boolean}
   */
  switchProfile(provider, profileId) {
    const profile = this.#profiles.get(profileId);
    if (!profile || profile.provider !== provider) return false;

    this.#active.set(provider, profileId);
    profile.metadata.lastUsed = Date.now();

    if (this.#onProfileChanged) {
      this.#onProfileChanged(provider, profileId);
    }

    return true;
  }

  /**
   * Get credentials for the active profile of a provider.
   * @param {string} provider
   * @returns {Promise<object|null>}
   */
  async getActiveCredentials(provider) {
    const profileId = this.#active.get(provider);
    if (!profileId || !this.#vault) return null;
    try {
      return await this.#vault.retrieve(`auth_${profileId}`);
    } catch {
      return null;
    }
  }

  /**
   * Get the active profile for a provider.
   * @param {string} provider
   * @returns {AuthProfile|null}
   */
  getActiveProfile(provider) {
    const profileId = this.#active.get(provider);
    return profileId ? this.#profiles.get(profileId) || null : null;
  }

  /**
   * List profiles, optionally filtered by provider.
   * @param {string} [provider]
   * @returns {AuthProfile[]}
   */
  listProfiles(provider) {
    const all = [...this.#profiles.values()];
    return provider ? all.filter(p => p.provider === provider) : all;
  }

  /**
   * Check if a profile is the active one.
   * @param {string} profileId
   * @returns {boolean}
   */
  isActive(profileId) {
    const profile = this.#profiles.get(profileId);
    if (!profile) return false;
    return this.#active.get(profile.provider) === profileId;
  }

  /**
   * Get active profile map: providerId → profileId.
   * @returns {object}
   */
  getActiveMap() {
    return Object.fromEntries(this.#active);
  }

  /**
   * Set active profile map (e.g., from workspace binding).
   * @param {object} map - providerId → profileId
   */
  setActiveMap(map) {
    for (const [provider, profileId] of Object.entries(map)) {
      if (this.#profiles.has(profileId)) {
        this.#active.set(provider, profileId);
      }
    }
  }

  /** Number of profiles */
  get size() { return this.#profiles.size; }

  /**
   * Build system prompt context for active profiles.
   * @returns {string}
   */
  buildPrompt() {
    const lines = [];
    for (const [provider, profileId] of this.#active) {
      const profile = this.#profiles.get(profileId);
      if (!profile) continue;
      let line = `- ${provider}: ${profile.name}`;
      if (profile.defaultModel) line += ` (${profile.defaultModel})`;
      if (profile.metadata.organization) line += ` [org: ${profile.metadata.organization}]`;
      if (profile.baseUrl) line += ` [${profile.baseUrl}]`;
      lines.push(line);
    }
    if (lines.length === 0) return '';
    return `Active provider profiles:\n${lines.join('\n')}`;
  }

  /**
   * Serialize profiles (without credentials).
   * @returns {object}
   */
  toJSON() {
    return {
      profiles: [...this.#profiles.values()],
      active: Object.fromEntries(this.#active),
    };
  }

  /**
   * Restore profiles from serialized data.
   * @param {object} data
   */
  fromJSON(data) {
    this.#profiles.clear();
    this.#active.clear();
    if (data.profiles) {
      for (const p of data.profiles) {
        this.#profiles.set(p.id, p);
      }
    }
    if (data.active) {
      for (const [provider, profileId] of Object.entries(data.active)) {
        if (this.#profiles.has(profileId)) {
          this.#active.set(provider, profileId);
        }
      }
    }
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class AuthListProfilesTool extends BrowserTool {
  #manager;
  constructor(manager) { super(); this.#manager = manager; }

  get name() { return 'auth_list_profiles'; }
  get description() { return 'List all auth profiles with active indicators.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Filter by provider (optional)' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ provider } = {}) {
    const profiles = this.#manager.listProfiles(provider);
    if (profiles.length === 0) {
      return { success: true, output: 'No auth profiles configured.' };
    }
    const lines = profiles.map(p => {
      const active = this.#manager.isActive(p.id) ? ' [ACTIVE]' : '';
      return `${p.id}: ${p.name} (${p.provider}, ${p.authType})${active}`;
    });
    return { success: true, output: lines.join('\n') };
  }
}

export class AuthSwitchProfileTool extends BrowserTool {
  #manager;
  constructor(manager) { super(); this.#manager = manager; }

  get name() { return 'auth_switch_profile'; }
  get description() { return 'Switch the active auth profile for a provider.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider ID' },
        profile_id: { type: 'string', description: 'Profile ID to activate' },
      },
      required: ['provider', 'profile_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ provider, profile_id }) {
    const ok = this.#manager.switchProfile(provider, profile_id);
    if (!ok) return { success: false, output: '', error: `Profile "${profile_id}" not found for ${provider}` };
    return { success: true, output: `Switched ${provider} to profile ${profile_id}` };
  }
}

export class AuthStatusTool extends BrowserTool {
  #manager;
  constructor(manager) { super(); this.#manager = manager; }

  get name() { return 'auth_status'; }
  get description() { return 'Show current active auth profiles and their status.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const prompt = this.#manager.buildPrompt();
    return { success: true, output: prompt || 'No active profiles.' };
  }
}
