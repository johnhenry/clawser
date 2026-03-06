#!/usr/bin/env bash
# build.sh — Concatenate pod ES modules into a single IIFE for chrome.scripting.executeScript.
#
# Chrome's executeScript doesn't support type="module", so we wrap everything
# in a classic-script IIFE. Deduplicates the PodIdentity import by inlining
# the identity module first.
#
# Usage: bash web/packages/pod/build.sh
# Output: extension/pod-inject.js

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
POD_SRC="$ROOT/web/packages/pod/src"
MESH_SRC="$ROOT/web/packages/mesh-primitives/src"
OUT="$ROOT/extension/pod-inject.js"

cat > "$OUT" <<'HEADER'
// pod-inject.js — Auto-generated IIFE bundle for Chrome extension injection.
// Do not edit directly. Regenerate with: bash web/packages/pod/build.sh
(function() {
'use strict';
if (globalThis[Symbol.for('pod.runtime')]) return;

HEADER

# 1. Inline identity.mjs (strip import/export, wrap in namespace)
echo "// ── mesh-primitives/identity.mjs ──" >> "$OUT"
sed -E '/^export /s/^export //' "$MESH_SRC/identity.mjs" \
  | sed '/^import /d' \
  >> "$OUT"
echo "" >> "$OUT"

# 2. Inline detect-kind.mjs
echo "// ── pod/detect-kind.mjs ──" >> "$OUT"
sed -E '/^export /s/^export //' "$POD_SRC/detect-kind.mjs" \
  | sed '/^import /d' \
  >> "$OUT"
echo "" >> "$OUT"

# 3. Inline capabilities.mjs
echo "// ── pod/capabilities.mjs ──" >> "$OUT"
sed -E '/^export /s/^export //' "$POD_SRC/capabilities.mjs" \
  | sed '/^import /d' \
  >> "$OUT"
echo "" >> "$OUT"

# 4. Inline messages.mjs
echo "// ── pod/messages.mjs ──" >> "$OUT"
sed -E '/^export /s/^export //' "$POD_SRC/messages.mjs" \
  | sed '/^import /d' \
  >> "$OUT"
echo "" >> "$OUT"

# 5. Inline pod.mjs (strip imports — deps already inlined above)
echo "// ── pod/pod.mjs ──" >> "$OUT"
sed -E '/^export /s/^export //' "$POD_SRC/pod.mjs" \
  | sed '/^import /d' \
  >> "$OUT"
echo "" >> "$OUT"

# 6. Inline injected-pod.mjs
echo "// ── pod/injected-pod.mjs ──" >> "$OUT"
sed -E '/^export /s/^export //' "$POD_SRC/injected-pod.mjs" \
  | sed '/^import /d' \
  >> "$OUT"
echo "" >> "$OUT"

# 7. Boot sequence
cat >> "$OUT" <<'FOOTER'
// ── Boot ──
const pod = new InjectedPod();
pod.boot({ discoveryTimeout: 2000 }).then(() => {
  console.log('[pod-inject] Pod ready:', pod.podId);
}).catch((err) => {
  console.warn('[pod-inject] Boot failed:', err.message);
});
})();
FOOTER

echo "Built: $OUT ($(wc -c < "$OUT") bytes)"
