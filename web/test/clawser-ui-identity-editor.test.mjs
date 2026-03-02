// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-ui-identity-editor.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_TEMPLATES } from '../clawser-ui-identity-editor.js';

describe('Identity Editor', () => {
  beforeEach(() => { localStorage.clear(); });

  describe('IDENTITY_TEMPLATES', () => {
    it('exports assistant, coder, and creative templates', () => {
      assert.ok(IDENTITY_TEMPLATES.assistant);
      assert.ok(IDENTITY_TEMPLATES.coder);
      assert.ok(IDENTITY_TEMPLATES.creative);
    });

    it('each template has label and identity fields', () => {
      for (const [key, tmpl] of Object.entries(IDENTITY_TEMPLATES)) {
        assert.ok(tmpl.label, `${key} has label`);
        assert.ok(tmpl.identity, `${key} has identity`);
        assert.strictEqual(tmpl.identity.version, '1.1');
        assert.ok(tmpl.identity.names?.display, `${key} has display name`);
        assert.ok(tmpl.identity.bio, `${key} has bio`);
        assert.ok(tmpl.identity.psychology, `${key} has psychology`);
        assert.ok(tmpl.identity.linguistics, `${key} has linguistics`);
        assert.ok(tmpl.identity.motivations, `${key} has motivations`);
        assert.ok(tmpl.identity.capabilities, `${key} has capabilities`);
      }
    });

    it('assistant template has correct display name', () => {
      assert.strictEqual(IDENTITY_TEMPLATES.assistant.identity.names.display, 'Assistant');
    });

    it('coder template traits include precise', () => {
      assert.ok(IDENTITY_TEMPLATES.coder.identity.psychology.traits.includes('precise'));
    });

    it('creative template has storytelling strength', () => {
      assert.ok(IDENTITY_TEMPLATES.creative.identity.capabilities.strengths.includes('storytelling'));
    });
  });

  describe('identity persistence', () => {
    it('saves and loads identity from localStorage', () => {
      const identity = IDENTITY_TEMPLATES.assistant.identity;
      localStorage.setItem('clawser_identity_full_test', JSON.stringify(identity));
      const loaded = JSON.parse(localStorage.getItem('clawser_identity_full_test'));
      assert.deepStrictEqual(loaded.names.display, 'Assistant');
      assert.deepStrictEqual(loaded.version, '1.1');
    });
  });
});
