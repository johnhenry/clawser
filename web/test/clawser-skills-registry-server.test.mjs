// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-skills-registry-server.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../clawser-skills-registry-server.js');
const { SkillsRegistryServer } = mod;

// ── 1. Construction ──────────────────────────────────────────────

describe('SkillsRegistryServer construction', () => {
  it('can be constructed', () => {
    const server = new SkillsRegistryServer();
    assert.ok(server);
  });
});

// ── 2. GET /skills ───────────────────────────────────────────────

describe('GET /skills', () => {
  it('returns empty array initially', async () => {
    const server = new SkillsRegistryServer();
    const resp = await server.handleRequest({ method: 'GET', path: '/skills' });
    assert.equal(resp.status, 200);
    assert.deepStrictEqual(resp.body.skills, []);
  });

  it('returns published skills', async () => {
    const server = new SkillsRegistryServer();
    await server.handleRequest({
      method: 'POST',
      path: '/skills',
      body: { name: 'test-skill', version: '1.0.0', description: 'A test', author: 'tester', content: '# Test' },
    });
    const resp = await server.handleRequest({ method: 'GET', path: '/skills' });
    assert.equal(resp.body.skills.length, 1);
    assert.equal(resp.body.skills[0].name, 'test-skill');
  });

  it('supports query filter', async () => {
    const server = new SkillsRegistryServer();
    await server.handleRequest({
      method: 'POST', path: '/skills',
      body: { name: 'alpha', version: '1.0.0', description: 'Alpha skill', author: 'a', content: '# A' },
    });
    await server.handleRequest({
      method: 'POST', path: '/skills',
      body: { name: 'beta', version: '1.0.0', description: 'Beta skill', author: 'b', content: '# B' },
    });
    const resp = await server.handleRequest({ method: 'GET', path: '/skills', query: { q: 'alpha' } });
    assert.equal(resp.body.skills.length, 1);
    assert.equal(resp.body.skills[0].name, 'alpha');
  });
});

// ── 3. POST /skills ──────────────────────────────────────────────

describe('POST /skills', () => {
  it('publishes a skill', async () => {
    const server = new SkillsRegistryServer();
    const resp = await server.handleRequest({
      method: 'POST',
      path: '/skills',
      body: { name: 'new-skill', version: '0.1.0', description: 'New', author: 'me', content: '# New' },
    });
    assert.equal(resp.status, 201);
    assert.ok(resp.body.id);
    assert.equal(resp.body.name, 'new-skill');
  });

  it('rejects missing name', async () => {
    const server = new SkillsRegistryServer();
    const resp = await server.handleRequest({
      method: 'POST',
      path: '/skills',
      body: { version: '1.0.0', description: 'No name', author: 'x', content: '# X' },
    });
    assert.equal(resp.status, 400);
    assert.ok(resp.body.error);
  });

  it('rejects missing version', async () => {
    const server = new SkillsRegistryServer();
    const resp = await server.handleRequest({
      method: 'POST',
      path: '/skills',
      body: { name: 'no-version', description: 'No ver', author: 'x', content: '# X' },
    });
    assert.equal(resp.status, 400);
  });

  it('rejects duplicate name+version', async () => {
    const server = new SkillsRegistryServer();
    await server.handleRequest({
      method: 'POST', path: '/skills',
      body: { name: 'dupe', version: '1.0.0', description: 'First', author: 'a', content: '# D' },
    });
    const resp = await server.handleRequest({
      method: 'POST', path: '/skills',
      body: { name: 'dupe', version: '1.0.0', description: 'Second', author: 'a', content: '# D2' },
    });
    assert.equal(resp.status, 409);
  });
});

// ── 4. Static export ─────────────────────────────────────────────

describe('static export', () => {
  it('exportStaticJSON returns valid JSON', async () => {
    const server = new SkillsRegistryServer();
    await server.handleRequest({
      method: 'POST', path: '/skills',
      body: { name: 'exported', version: '1.0.0', description: 'To export', author: 'e', content: '# E' },
    });
    const json = server.exportStaticJSON();
    const parsed = JSON.parse(json);
    assert.ok(Array.isArray(parsed.skills));
    assert.equal(parsed.skills.length, 1);
    assert.ok(parsed.generatedAt);
  });
});

// ── 5. Unknown route ─────────────────────────────────────────────

describe('unknown routes', () => {
  it('returns 404 for unknown path', async () => {
    const server = new SkillsRegistryServer();
    const resp = await server.handleRequest({ method: 'GET', path: '/unknown' });
    assert.equal(resp.status, 404);
  });

  it('returns 405 for unsupported method', async () => {
    const server = new SkillsRegistryServer();
    const resp = await server.handleRequest({ method: 'DELETE', path: '/skills' });
    assert.equal(resp.status, 405);
  });
});
