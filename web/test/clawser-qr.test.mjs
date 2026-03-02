// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-qr.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeQR,
  renderQR,
  getQRVersion,
} from '../clawser-qr.js';

// ── getQRVersion ─────────────────────────────────────────────────

describe('getQRVersion', () => {
  it('returns version 1 for short text', () => {
    assert.ok(getQRVersion('HELLO') >= 1);
  });

  it('returns higher version for longer text', () => {
    const v1 = getQRVersion('AB');
    const v2 = getQRVersion('A'.repeat(100));
    assert.ok(v2 >= v1);
  });

  it('throws for text too long', () => {
    assert.throws(() => getQRVersion('A'.repeat(5000)), /too long/i);
  });
});

// ── encodeQR ─────────────────────────────────────────────────────

describe('encodeQR', () => {
  it('returns a 2D boolean matrix', () => {
    const matrix = encodeQR('HELLO');
    assert.ok(Array.isArray(matrix));
    assert.ok(matrix.length > 0);
    assert.ok(Array.isArray(matrix[0]));
    // Each cell is boolean
    for (const row of matrix) {
      for (const cell of row) {
        assert.equal(typeof cell, 'boolean');
      }
    }
  });

  it('matrix is square', () => {
    const matrix = encodeQR('TEST');
    assert.equal(matrix.length, matrix[0].length);
  });

  it('matrix size matches version formula (4*v + 17)', () => {
    const text = 'HELLO';
    const matrix = encodeQR(text);
    const size = matrix.length;
    // Version 1 = 21, Version 2 = 25, etc.
    assert.equal((size - 17) % 4, 0);
    assert.ok(size >= 21); // at least version 1
  });

  it('handles numeric text', () => {
    const matrix = encodeQR('12345');
    assert.ok(matrix.length >= 21);
  });

  it('handles alphanumeric text', () => {
    const matrix = encodeQR('HTTPS://EXAMPLE.COM');
    assert.ok(matrix.length >= 21);
  });

  it('handles URL-like text', () => {
    const matrix = encodeQR('https://tunnel.example.com');
    assert.ok(matrix.length >= 21);
  });

  it('produces different matrices for different inputs', () => {
    const m1 = encodeQR('HELLO');
    const m2 = encodeQR('WORLD');
    // Flatten to compare
    const s1 = m1.map(r => r.map(c => c ? '1' : '0').join('')).join('');
    const s2 = m2.map(r => r.map(c => c ? '1' : '0').join('')).join('');
    assert.notEqual(s1, s2);
  });

  it('finder patterns are present in corners', () => {
    const matrix = encodeQR('TEST');
    // Top-left finder: 7x7 pattern starts at (0,0)
    // The border cells should be true (dark)
    assert.equal(matrix[0][0], true);
    assert.equal(matrix[0][6], true);
    assert.equal(matrix[6][0], true);
    assert.equal(matrix[6][6], true);
    // Inner white cell
    assert.equal(matrix[1][1], false);
  });
});

// ── renderQR ─────────────────────────────────────────────────────

describe('renderQR', () => {
  it('renders to an element with child nodes', () => {
    const children = [];
    const el = {
      innerHTML: '',
      style: {},
      appendChild(child) { children.push(child); },
    };
    renderQR(el, 'TEST');
    // Should set innerHTML with table or grid markup
    assert.ok(el.innerHTML.length > 0 || children.length > 0);
  });

  it('renders with custom module size', () => {
    const el = { innerHTML: '', style: {} };
    renderQR(el, 'TEST', { moduleSize: 8 });
    assert.ok(el.innerHTML.length > 0);
  });

  it('renders using table elements', () => {
    const el = { innerHTML: '', style: {} };
    renderQR(el, 'HELLO', { mode: 'table' });
    assert.ok(el.innerHTML.includes('<table') || el.innerHTML.includes('<td'));
  });
});
