/**
 * compat.mjs -- BrowserTool shim for standalone use.
 *
 * In clawser, BrowserTool is the base class for AI-agent-callable tools.
 * Outside clawser, consumers provide their own base or use this minimal stub.
 */
export class BrowserTool {
  constructor(opts = {}) {
    this.name = opts.name || this.constructor.name;
    this.description = opts.description || '';
    this.parameters = opts.parameters || {};
  }
  async execute(_params) { throw new Error('Not implemented'); }
}
