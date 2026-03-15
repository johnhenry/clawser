import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('wsh roadmap/implementation consistency', () => {
  it('roadmap reflects non-final phase wording and includes CLI matrix', () => {
    const roadmap = readFileSync(resolve(ROOT, 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /Phase 5: Remote Execution \(wsh\) -- COMPLETE/);
    assert.match(roadmap, /Rust CLI Status Matrix/);
  });

  // Removed: wsh-cli Rust source files were deleted in 7a2d7a5
  // ("chore: remove legacy Rust crates and Cargo workspace")
});
