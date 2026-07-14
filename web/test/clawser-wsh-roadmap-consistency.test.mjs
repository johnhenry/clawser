import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('wsh roadmap/implementation consistency', () => {
  it('roadmap reflects wsh phase wording and remote runtime expansion', () => {
    const roadmap = readFileSync(resolve(ROOT, 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /Remote runtime access expansion \(`wsh`\)/);
    assert.match(roadmap, /wsh/);
  });

  // Removed: wsh-cli Rust source files were deleted in 7a2d7a5
  // ("chore: remove legacy Rust crates and Cargo workspace")
});
