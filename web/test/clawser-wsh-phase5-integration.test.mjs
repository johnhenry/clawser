import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Phase 5 integration — all exports, methods, tools, relay types', () => {

  // ── All message constructors exported ──────────────────────────────

  it('all Phase 5.7 message constructors are exported', async () => {
    const mod = await import('../packages/wsh/src/index.mjs');
    const expected = [
      // Session extended
      'clipboard', 'recordingExport', 'commandJournal', 'metricsRequest',
      'suspendSession', 'restartPty', 'sessionListRequest', 'sessionList',
      'detach', 'detachOk', 'detachFail',
      // Guest
      'guestInvite', 'guestJoin', 'guestRevoke',
      // Sharing
      'shareSession', 'shareRevoke',
      // Compression
      'compressBegin', 'compressAck',
      // Rate control
      'rateControl', 'rateWarning',
      // Linking
      'sessionLink', 'sessionUnlink',
      // Copilot
      'copilotAttach', 'copilotSuggest', 'copilotDetach',
      // E2E
      'keyExchange', 'encryptedFrame',
      // Echo/TermSync
      'echoAck', 'echoState', 'termSync', 'termDiff',
      // Scaling
      'nodeAnnounce', 'nodeRedirect',
      // Principals
      'sessionGrant', 'sessionRevoke',
      // File channel
      'fileOp', 'fileResult', 'fileChunk',
      // Policy
      'policyEval', 'policyResult', 'policyUpdate',
      // Terminal
      'terminalConfig',
    ];
    for (const name of expected) {
      assert.equal(typeof mod[name], 'function', `index.mjs missing: ${name}`);
    }
  });

  it('all Phase 5.7 constructors mirrored in packages-wsh.js', async () => {
    const mod = await import('../packages-wsh.js');
    const expected = [
      'suspendSession', 'restartPty', 'metricsRequest',
      'guestInvite', 'guestJoin', 'guestRevoke',
      'shareSession', 'shareRevoke',
      'compressBegin', 'compressAck',
      'rateControl', 'rateWarning',
      'sessionLink', 'sessionUnlink',
      'copilotAttach', 'copilotSuggest', 'copilotDetach',
      'keyExchange', 'encryptedFrame',
      'fileOp', 'fileResult', 'fileChunk',
      'policyEval', 'policyResult', 'policyUpdate',
      'terminalConfig',
    ];
    for (const name of expected) {
      assert.equal(typeof mod[name], 'function', `packages-wsh.js missing: ${name}`);
    }
  });

  // ── Client methods exist ──────────────────────────────────────────

  it('WshClient has all Phase 5.7 methods', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    const methods = [
      // Unit 2: Suspend/Restart
      'suspendSession', 'restartPty',
      // Unit 3: Metrics
      'requestMetrics',
      // Unit 4: Guest
      'inviteGuest', 'joinAsGuest', 'revokeGuest',
      // Unit 5: Share
      'shareSession', 'revokeShare',
      // Unit 6: Compression
      'negotiateCompression',
      // Unit 7: Rate Control
      'setRateControl',
      // Unit 8: Linking
      'linkSession', 'unlinkSession',
      // Unit 9: Copilot
      'copilotAttach', 'copilotSuggest', 'copilotDetach',
      // Unit 10: E2E
      'initiateE2E',
      // Unit 11: File channel
      'fileOperation', 'fileStat', 'fileList', 'fileRead', 'fileWrite',
      'fileMkdir', 'fileRemove', 'fileRename',
      // Unit 12: Policy
      'evaluatePolicy', 'updatePolicy',
    ];
    for (const method of methods) {
      assert.equal(typeof client[method], 'function', `WshClient missing method: ${method}`);
    }
  });

  // ── Client callbacks exist ────────────────────────────────────────

  it('WshClient has all Phase 5.7 callbacks', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    // These should be null by default
    assert.equal(client.onRateWarning, null);
    assert.equal(client.onCopilotSuggest, null);
    assert.equal(client.onKeyExchange, null);
  });

  // ── Relay-forwardable types ───────────────────────────────────────

  it('all Phase 5.7 relay-forwardable types are registered', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const { MSG } = await import('../packages/wsh/src/messages.gen.mjs');
    const client = new WshClient();

    // Original types
    assert.ok(client._isRelayForwardable(MSG.OPEN));
    assert.ok(client._isRelayForwardable(MSG.MCP_DISCOVER));
    assert.ok(client._isRelayForwardable(MSG.MCP_CALL));
    assert.ok(client._isRelayForwardable(MSG.CLOSE));
    assert.ok(client._isRelayForwardable(MSG.RESIZE));
    assert.ok(client._isRelayForwardable(MSG.SIGNAL));

    // Phase 5.7 additions
    assert.ok(client._isRelayForwardable(MSG.GUEST_JOIN), 'GUEST_JOIN');
    assert.ok(client._isRelayForwardable(MSG.GUEST_REVOKE), 'GUEST_REVOKE');
    assert.ok(client._isRelayForwardable(MSG.COPILOT_ATTACH), 'COPILOT_ATTACH');
    assert.ok(client._isRelayForwardable(MSG.COPILOT_DETACH), 'COPILOT_DETACH');
    assert.ok(client._isRelayForwardable(MSG.FILE_OP), 'FILE_OP');
    assert.ok(client._isRelayForwardable(MSG.POLICY_EVAL), 'POLICY_EVAL');
  });

  // ── Tool registrations ────────────────────────────────────────────

  it('all Phase 5.7 tool classes are exported', async () => {
    const mod = await import('../clawser-wsh-tools.js');
    const toolClasses = [
      'WshSuspendSessionTool', 'WshRestartPtyTool', 'WshMetricsTool',
      'WshGuestInviteTool', 'WshGuestRevokeTool',
      'WshShareSessionTool', 'WshShareRevokeTool',
      'WshCompressTool', 'WshRateControlTool',
      'WshLinkSessionTool', 'WshUnlinkSessionTool',
      'WshCopilotAttachTool', 'WshCopilotDetachTool',
      'WshFileOpTool',
      'WshPolicyEvalTool', 'WshPolicyUpdateTool',
    ];
    for (const cls of toolClasses) {
      assert.equal(typeof mod[cls], 'function', `Tool class missing: ${cls}`);
    }
  });

  it('registerWshTools registers all tools', async () => {
    const { registerWshTools } = await import('../clawser-wsh-tools.js');
    const registry = new Map();
    const fakeRegistry = {
      register(tool) { registry.set(tool.name, tool); },
    };
    registerWshTools(fakeRegistry);

    // Should have at least 27 tools (11 original + 16 new)
    assert.ok(registry.size >= 27, `Expected >= 27 tools, got ${registry.size}`);

    // Check new tool names
    const expectedTools = [
      'wsh_suspend_session', 'wsh_restart_pty', 'wsh_metrics',
      'wsh_guest_invite', 'wsh_guest_revoke',
      'wsh_share_session', 'wsh_share_revoke',
      'wsh_compress', 'wsh_rate_control',
      'wsh_link_session', 'wsh_unlink_session',
      'wsh_copilot_attach', 'wsh_copilot_detach',
      'wsh_file_op',
      'wsh_policy_eval', 'wsh_policy_update',
    ];
    for (const name of expectedTools) {
      assert.ok(registry.has(name), `Tool not registered: ${name}`);
    }
  });

  // ── ROADMAP reflects completion ────────────────────────────────────

  it('ROADMAP marks Phase 5 as COMPLETE', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const roadmap = readFileSync(resolve(import.meta.dirname, '..', '..', 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /Phase 5: Remote Execution \(wsh\) -- COMPLETE/);
    assert.match(roadmap, /Phase 5\.7: Protocol Extensions — COMPLETE/);
  });
});
