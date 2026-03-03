/**
 * clawser-autonomy-presets.js — Named autonomy configuration presets
 *
 * Save, load, delete, list, and apply named autonomy configs.
 * Persisted in localStorage, scoped per workspace.
 */

const PRESET_KEY_PREFIX = 'clawser_autonomy_presets_v1_';

/**
 * @typedef {object} AutonomyPreset
 * @property {string} name - Unique preset name
 * @property {'readonly'|'supervised'|'full'} level
 * @property {number} maxActionsPerHour
 * @property {number} maxCostPerDayCents
 * @property {Array<{start: number, end: number}>} allowedHours
 * @property {number} createdAt - Timestamp
 */

export class AutonomyPresetManager {
  #storageKey;

  /**
   * @param {string} [workspaceId='default'] - Workspace ID for scoping presets
   */
  constructor(workspaceId = 'default') {
    this.#storageKey = PRESET_KEY_PREFIX + workspaceId;
  }

  /** @returns {AutonomyPreset[]} All saved presets */
  list() {
    try {
      const presets = JSON.parse(localStorage.getItem(this.#storageKey) || '[]');
      // Restore null → Infinity for limits
      for (const p of presets) {
        if (p.maxActionsPerHour == null) p.maxActionsPerHour = Infinity;
        if (p.maxCostPerDayCents == null) p.maxCostPerDayCents = Infinity;
      }
      return presets;
    } catch {
      return [];
    }
  }

  /**
   * Save a named preset. Overwrites if name already exists.
   * @param {Omit<AutonomyPreset, 'createdAt'>} config
   * @returns {AutonomyPreset}
   */
  save(config) {
    const presets = this.list();
    const existing = presets.findIndex(p => p.name === config.name);
    const preset = {
      name: config.name,
      level: config.level || 'supervised',
      maxActionsPerHour: config.maxActionsPerHour ?? Infinity,
      maxCostPerDayCents: config.maxCostPerDayCents ?? Infinity,
      allowedHours: config.allowedHours || [],
      createdAt: Date.now(),
    };
    if (existing >= 0) {
      presets[existing] = preset;
    } else {
      presets.push(preset);
    }
    // Infinity → null for JSON serialization
    const serializable = presets.map(p => ({
      ...p,
      maxActionsPerHour: p.maxActionsPerHour === Infinity ? null : p.maxActionsPerHour,
      maxCostPerDayCents: p.maxCostPerDayCents === Infinity ? null : p.maxCostPerDayCents,
    }));
    localStorage.setItem(this.#storageKey, JSON.stringify(serializable));
    return preset;
  }

  /**
   * Load a preset by name.
   * @param {string} name
   * @returns {AutonomyPreset|null}
   */
  load(name) {
    const preset = this.list().find(p => p.name === name) || null;
    if (preset) {
      // Restore null → Infinity on load
      if (preset.maxActionsPerHour == null) preset.maxActionsPerHour = Infinity;
      if (preset.maxCostPerDayCents == null) preset.maxCostPerDayCents = Infinity;
    }
    return preset;
  }

  /**
   * Delete a preset by name.
   * @param {string} name
   * @returns {boolean} true if found and deleted
   */
  delete(name) {
    const presets = this.list();
    const idx = presets.findIndex(p => p.name === name);
    if (idx < 0) return false;
    presets.splice(idx, 1);
    localStorage.setItem(this.#storageKey, JSON.stringify(presets));
    return true;
  }

  /**
   * Apply a preset to an agent's AutonomyController.
   * @param {string} name
   * @param {{applyAutonomyConfig: (cfg: object) => void}} agent
   * @returns {boolean} true if preset found and applied
   */
  apply(name, agent) {
    const preset = this.load(name);
    if (!preset) return false;
    agent.applyAutonomyConfig({
      level: preset.level,
      maxActionsPerHour: preset.maxActionsPerHour,
      maxCostPerDayCents: preset.maxCostPerDayCents,
      allowedHours: preset.allowedHours,
    });
    return true;
  }
}
