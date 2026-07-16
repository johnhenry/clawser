# Guide expansion — 2026-05-04

**Status: reverted as of 2026-07-16** (dated snapshot, not live guidance).
The walkthroughs this pass added to `guide/safety.md`, `guide/mesh.md`, and
`guide/shell.md` do not survive in the current tree — a later `guide/`
regeneration from `docs/data/*.yaml` (which was never updated with this
content) silently discarded the hand-edited additions. Re-adding this
content (via the yaml source, not the generated output) is still
outstanding work.

**Update 2026-07-16:** re-added via the yaml source this time, so it
survives regeneration. `docs/data/safety.yaml`'s "Secret Vault" entry was
rewritten to describe the v2 wrapped-DEK architecture (passphrase +
passkey/WebAuthn-PRF + recovery-code wraps, `enrollPasskey`,
`unlockWithPasskey`, `performChangePassphrase`, etc. — see `docs/VAULT.md`).
The multi-device sync / deploy-target content is now its own
`docs/data/multi-device.yaml` (10 features: pairing, sync flags, sync
engine, signed packages, ACL/approvals/audit/rollback, apply transport,
publish/flow, wiring, and the UI panels) rather than folded into
`mesh.yaml` — it renders as its own `guide/multi-device.md` page, linked
from the guide index. The `/home/<name>` workspace-home view is now a
"Workspace Home" entry in `docs/data/shell.yaml`, cross-linked from
`workspace.yaml`'s `/proc Virtual Filesystem` entry.

Compared `guide/*.md` against the actual user-facing surface of the
codebase. Filled the largest gaps by expanding existing pages with
walkthroughs and examples (no new files; the guide is already 11
pages and adding more wouldn't help discovery).

## Files expanded

| File | Status before | Change |
|------|---------------|--------|
| `guide/safety.md` | Vault entry described v1 (PBKDF2-only). No mention of passkey, change-passphrase, or wrapped-DEK. | **Rewrote the Vault section.** Added v2 architecture summary, four user-facing walkthroughs (change passphrase, enroll passkey, unlock with passkey, remove a passkey), expanded API surface listing, link to `docs/VAULT.md`. |
| `guide/mesh.md` | Listed mesh primitives (peer, swarm, DHT, etc.) but had nothing on the deploy / multi-device sync system shipped in May 2026. | **Added two new sections.** "Personal multi-device sync" with pairing walkthrough, sync-flag UX, sync-mode comparison, atomicity guarantees. "Remote deploy targets" with end-to-end deploy walkthrough, capability tokens, audit + rollback, source-compromise mitigations. Both sections link to `docs/DEPLOY.md` and the wire-protocol spec. |
| `guide/shell.md` | No coverage of the new `/home/<name>` view or workspace `$HOME` semantics. | **Added "Workspace home" section** between "OPFS Filesystem" and "Pipes and Redirects". Covers `/home/<name>` ↔ `~` aliasing, sanitization rules with examples, `/proc/clawser/workspaces` listing, workspace switch live `$HOME`, cross-workspace isolation with concrete denial messages. |

## Files reviewed but unchanged

- `guide/workspace.md` — already covers workspace switching, lifecycle,
  per-workspace state. The new `/home/<name>` shell view is documented
  in `guide/shell.md` (where shell users will look). Cross-linking
  `workspace.md` would be redundant.
- `guide/skills.md` — capability tokens are documented in
  `guide/mesh.md`'s deploy-targets section (the user surface where
  capabilities matter is "deploy a skill from elsewhere"). Local
  skills are unchanged from prior behavior, so the existing
  skills.md content is still accurate.
- `guide/tools.md` — auto-generated from per-tool metadata; no manual
  expansion needed for this pass.

## What's still missing (low priority)

- **`guide/pods.md`** — could include a section on the new
  `pod.sendMessage` unicast API now that A3/sync depend on it.
  Punted: the existing pods page is conceptual / architectural;
  adding RPC details fits better in `docs/DEPLOY.md` or a future
  developer-API guide.
- **`guide/networking.md`** — no mention of presence service or sync
  envelope wire format. The wire format is in
  `docs/browsermesh/specs/extensions/sync-protocol.md`; networking.md
  is end-user oriented and doesn't currently dive into wire formats
  for any subsystem.

## Examples now present in the guide

Every documented user-visible surface from the recent feature waves
has at least one realistic example:

- **Vault v2:** four walkthroughs (change pass, enroll, unlock,
  remove). Each names the exact UI clicks.
- **Multi-device sync:** pairing flow with both QR and paste
  variants, sync-flag UX, "Deploy now" preview shape.
- **Deploy targets:** end-to-end Alice/Bob trust scenario, signed
  package JSON example, capability denial error message verbatim,
  rollback flow.
- **`/home/<name>`:** `cat /proc/clawser/workspaces` sample output,
  cross-workspace write denial verbatim, sanitization examples
  (Café → cafe, "My Project" → my-project, collisions →
  my-project-2).

The guide treats these features as shipped + supported, not
experimental.
