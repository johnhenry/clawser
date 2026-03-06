import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('wsh roadmap/implementation consistency', () => {
  it('roadmap reflects non-final phase wording and includes CLI matrix', () => {
    const roadmap = readFileSync(resolve(ROOT, 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /Phase 5: Remote Execution \(wsh\) -- MOSTLY COMPLETE/);
    assert.match(roadmap, /Rust CLI Status Matrix/);
  });

  it('core wsh-cli commands no longer contain placeholder transport text', () => {
    const files = [
      'crates/wsh-cli/src/commands/connect.rs',
      'crates/wsh-cli/src/commands/exec.rs',
      'crates/wsh-cli/src/commands/scp.rs',
      'crates/wsh-cli/src/commands/sessions.rs',
      'crates/wsh-cli/src/commands/tools.rs',
    ];

    for (const rel of files) {
      const content = readFileSync(resolve(ROOT, rel), 'utf8');
      assert.equal(
        content.includes('transport not yet implemented'),
        false,
        `${rel} still contains placeholder transport text`
      );
    }
  });
});
