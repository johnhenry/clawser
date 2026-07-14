# Multi-device sync + deploy

Clawser runs entirely in the browser, but you can pair multiple
browsers — running on different machines under the same identity —
and push skills, configs, and memory between them with cryptographic
verification, capability gates, and full rollback.

This guide walks you through the full lifecycle:

1. **Pair** a second device under the same identity.
2. **Mark items** on the source for sync (skills, configs, memory).
3. **Deploy** to one device (or fan out to many).
4. **Approve** on the target the first time a manifest fingerprint
   is seen.
5. **Review** trusted publishers + audit log.
6. **Roll back** a deploy event you regret.

Everything is built on the same identity, mesh, and OPFS primitives
the rest of Clawser uses — there is no central server.

---

## Concepts at a glance

| Concept | What it is | Where it lives |
|---|---|---|
| **Paired device** | A peer registered against this identity that you can target with `Deploy now` | `state.pairedDevices` (per-identity registry) |
| **Sync flag** | Per-item bit marking it as "ship this when I deploy" | `state.syncFlags` (per-workspace) |
| **Trusted publisher** | A `did:key:` you've granted permission to push to this device | `state.deployTarget.deployAcl` (per-workspace) |
| **Manifest approval** | Your one-time consent for a specific manifest fingerprint | `state.deployTarget.deployApprovals` |
| **Audit log** | Append-only record of every accepted/rejected/applied/rolled-back deploy | `state.deployTarget.deployAudit` |
| **Snapshot ring** | Pre-deploy snapshots used by rollback | `state.deployTarget.deploySnapshots` |
| **Replay counter** | Per-source monotonic counter; old packages are rejected | `state.deployTarget.replayCounter` |

The split between "paired devices" (a property of your identity)
and "trusted publishers" (a property of *this* workspace's deploy
target) is intentional: pairing means "I know this device exists";
trust means "I'll accept code from it here."

---

## 1. Pair a second device

Open Settings → **My Devices** → click **Pair new device**.

A modal opens with two things:

- A **pairing payload** — a base64 blob bundling your identity's
  public key, the source label, and a freshly generated short code.
- A **6-character code** under the payload.

On the *other* device, open Settings → **My Devices** → **Pair new
device** → paste the payload + code. The two devices now share the
same identity (same `did:key:z…`) and each has the other registered
in `state.pairedDevices`.

> Behind the scenes: the source generates a fresh AES key, encrypts
> the JWK private key with it, base64-bundles `{jwk, code, label}`,
> and the target derives the same AES key from the code + decrypts.
> Both devices end up with identical Ed25519 keypairs in their
> identity managers.

The new pairing shows up immediately — `mountMyDevicesPanel`
subscribes to `state.pairedDevices` and re-renders on every
mutation.

---

## 2. Mark items for sync

Sync flags are per-item: you flip them on for the things you want
shipped when you deploy, leave them off for everything else.

The shell exposes these directly:

```sh
$ clsh sync mark skill:code-review
$ clsh sync mark config:autonomy
$ clsh sync mark memory:project-context

$ clsh sync list
skill:code-review
config:autonomy
memory:project-context
```

Or programmatically:

```js
await state.syncFlags.setFlag('skill:code-review', true)
await state.syncFlags.listFlagged()
// → ['skill:code-review', 'config:autonomy', 'memory:project-context']
```

Marking is per-workspace — workspace A's flagged set is invisible
from workspace B. This is deliberate: deploys are per-workspace,
even when the underlying identity is global.

---

## 3. Deploy now

In **My Devices**, click **Deploy now** on the row of the device
you want to push to.

A picker modal opens. It shows three sections — Skills, Configs,
Memory — with a checkbox per item. By default every item flagged
in step 2 is pre-checked; you can uncheck individual rows or add
unflagged items as a one-off.

Below the item list, the modal shows the **derived capability set**:

```
Capabilities the recipient is being asked to grant:
  config: ['autonomy']
  memory: ['project-context']
  fs: []
  net: []
  mesh: []
```

Capability derivation is **strictly declarative**: a config item
contributes its domain (e.g. `autonomy`) to `config[]`; a memory
item contributes its category to `memory[]`; a skill contributes
**nothing** — there is no inference from skill content. (Anything
else would be a security laundering surface — code with hidden
side effects could quietly grant itself FS/net access.)

Click **Deploy** and the source:

1. Reads each item's payload from local storage (skills via
   `SkillStorage.readSkill`, configs via `readConfig`, memory via
   the agent's memory store).
2. Builds a `manifest = { sourceLabel, items, capabilities,
   createdAt }`.
3. Signs `(version, sourceDid, counter, canonicalManifest)` with
   the identity's Ed25519 private key. The signed region binds
   the source DID + counter + manifest as a single unit.
4. Sends a `{ type: 'deploy', package: <signed> }` envelope to the
   target's pubKey via `pod.sendMessage`.
5. Stamps `lastSyncAt` on the paired-device entry so the row
   shows "synced 2 minutes ago" the next time you open the panel.

---

## 4. Approve on the target

The target's `pod.onMessage` dispatcher catches the envelope and
runs `acceptPackage`:

```
verify signature against did:key public key   ← packageVerifier
counter > last-seen for this source            ← replayCounter
source listed in deployAcl                     ← acl
manifestHash already approved? (skip prompt)   ← approvals
otherwise prompt the user                      ← promptApprove
write a `pending` audit entry
take pre-snapshot                              ← snapshotDriver.create
applyTransport.applyBatch(items)               ← applyTransport
write the audit entry as `applied`
```

The approval modal shows:

- **Source label + shortened DID** — who's pushing.
- **Manifest fingerprint** (first 16 chars of the manifest hash) —
  approve once, all future deploys with this same fingerprint skip
  the prompt.
- **Capability list** — the same five-kind summary the sender saw,
  rendered with empty groups suppressed.
- **Items being deployed** — kind + itemId per row.
- **Approve / Deny** — Deny is focused by default; Escape and
  click-outside both resolve `false`. Defensive UX.

If you approve, items get persisted via the apply transport:

- **Skill** — `payload.files` written via `SkillStorage.writeSkill(scope,
  wsId, name, fileMap)`.
- **Config** — `payload` is the JSON value; `itemId` is the domain;
  written via `writeConfig(domain, wsId, value)`. The config
  domain MUST be in `manifest.capabilities.config[]` or the item
  is rejected.
- **Memory** — `payload = {key, content, category?}`; written via
  `state.agent.memoryStore({...})`. Same gate against `capabilities.memory[]`.

If you deny, the audit log records `{status: 'rejected', error:
'user rejected'}` and nothing else happens.

---

## 5. Review trusted publishers + audit

Settings → **Trusted Publishers** lists three sections:

### Trusted DIDs

The `did:key:` URIs you've granted with a label. Each has a
**Revoke** button. Revoking does *not* undo past deploys — it
just blocks future ones from this source.

### Approved manifest fingerprints

Each entry: source DID + manifest hash + when first approved.
**Revoke approval** removes the fingerprint; the next deploy with
that fingerprint will re-prompt. Useful when you want to be asked
again before re-applying a manifest you previously fast-tracked.

### Deploy history (audit log)

Append-only. Every event has `{id, source, manifestHash, items,
status, ts, error?}`. `applied` rows show a **Roll back** button.

---

## 6. Roll back

Click **Roll back** on an `applied` row. A confirm dialog warns
that this and any later deploys may be undone (snapshots are
ordered, so restoring to T-1 also undoes everything that landed
between T-1 and now).

Rollback calls `state.deployTarget.deploySnapshots.restore(eventId)`,
which calls `snapshotDriver.restore(snapshotId)`. The default
driver in production swaps the workspace's active OPFS state back
to the snapshot taken just before the deploy.

The audit log gains a `rolled-back` event referencing the original
`applied` event so the history stays auditable.

---

## Realistic examples

### Push a skill from your laptop to your tablet

```sh
# On the laptop (workspace `dev`):
$ clsh sync mark skill:react-review
$ clsh sync mark skill:test-coverage

# Open My Devices → Deploy now on "Tablet"
# Picker: skills both checked, no configs, no memory
# capabilities: { fs: [], net: [], mesh: [], config: [], memory: [] }
# Click Deploy.

# On the tablet (workspace `dev` — same wsId):
# Approval modal pops: "Laptop wants to deploy 2 skills".
# Click Approve. Skills land in clawser_workspaces/dev/.skills/.
```

### Push agent autonomy + project memory to a fresh workstation

```sh
# Source:
$ clsh sync mark config:autonomy        # set to "supervised"
$ clsh sync mark memory:project-context # current sprint goals

# Deploy now → Picker auto-checks both.
# capabilities: { config: ['autonomy'], memory: ['project'] }

# Target prompts: "Source is asking to set config(autonomy) and
# add to memory(project)". You see exactly what's being changed.
```

### Push to all paired devices at once

You don't need to fan out from the UI — the underlying
`publishDeployToAll({targets, publishOpts})` API runs sends in
parallel. The UI exposes a "Deploy to all" button on the
**My Devices** header that calls it for every paired device with
`syncEnabled: true`.

A failure to one peer doesn't abort the others — each peer's
result lands in its row.

---

## Threat model summary

What this protects against:

- **Tampering in flight** — manifest + payloads are bound by
  signature; any byte flip kills verify.
- **Replay** — counter must strictly exceed the last-seen value
  per source.
- **Untrusted source** — `acceptPackage` rejects sources not in
  `deployAcl`; `rejected` audit entry written.
- **Capability laundering** — config + memory items must declare
  their capability in the manifest; runtime gate enforces.
- **Silent escalation** — every `applied` event lands in the
  audit log; rollback is one click.

What this does **not** protect against:

- **Compromised identity** — if the source's private key is
  exfiltrated, the attacker can sign valid packages. Identity
  hygiene is your job.
- **Approve-once tunnel vision** — you can approve a manifest
  fingerprint that contains a malicious skill if you don't read
  the items list. The modal puts items front-and-center for this
  reason.

---

## Reference

- [`docs/multi-device-deploy.md`](../docs/multi-device-deploy.md)
  — implementation status, test counts, storage paths.
- [`docs/DEPLOY.md`](../docs/DEPLOY.md) — wire format, signature
  scheme, threat model.
- [`web/clawser-multi-device.mjs`](../web/clawser-multi-device.mjs)
  — wiring entry point.
- [`web/clawser-multi-device-controllers.mjs`](../web/clawser-multi-device-controllers.mjs)
  — production controller logic.
- [`web/test/clawser-multi-device-e2e.test.mjs`](../web/test/clawser-multi-device-e2e.test.mjs)
  — end-to-end round-trip tests.
