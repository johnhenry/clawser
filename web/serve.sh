#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WASM_SRC="$PROJECT_ROOT/target/wasm32-unknown-unknown/release/clawser_wasm.wasm"
WASM_DST="$SCRIPT_DIR/clawser_wasm.wasm"

echo "==> Building clawser-wasm (release)..."
cargo build \
  --manifest-path "$PROJECT_ROOT/Cargo.toml" \
  --target wasm32-unknown-unknown \
  --release \
  -p clawser-wasm

echo "==> Copying WASM binary to web/..."
cp "$WASM_SRC" "$WASM_DST"
echo "    $(ls -lh "$WASM_DST" | awk '{print $5}') — $WASM_DST"

echo "==> Serving at http://localhost:8080"
echo "    Press Ctrl+C to stop."
cd "$SCRIPT_DIR"
python3 -m http.server 8080
