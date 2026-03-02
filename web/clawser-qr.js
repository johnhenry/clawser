/**
 * clawser-qr.js — Minimal QR Code Encoder (Phase 7c)
 *
 * Alphanumeric mode, versions 1-10 auto-select.
 * encodeQR(text) returns a 2D boolean matrix.
 * renderQR(el, text, opts) renders to an HTML element using table or CSS grid.
 *
 * @module clawser-qr
 */

// ── QR Capacity Table (alphanumeric, error correction L) ────────

const ALPHANUMERIC_CAPACITY = [
  0,   // version 0 doesn't exist
  25,  // version 1
  47,  // version 2
  77,  // version 3
  114, // version 4
  154, // version 5
  195, // version 6
  224, // version 7
  279, // version 8
  335, // version 9
  395, // version 10
];

// Byte-mode capacity for fallback (error correction L)
const BYTE_CAPACITY = [
  0,
  17, 32, 53, 78, 106, 134, 154, 192, 230, 271,
];

const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// ── Version selection ────────────────────────────────────────────

/**
 * Determine the QR version needed for a given text.
 * @param {string} text
 * @returns {number} Version 1-10
 */
export function getQRVersion(text) {
  const isAlphanumeric = [...text].every(ch => ALPHANUMERIC_CHARS.includes(ch.toUpperCase()));
  const capacities = isAlphanumeric ? ALPHANUMERIC_CAPACITY : BYTE_CAPACITY;
  const len = isAlphanumeric ? text.length : new TextEncoder().encode(text).length;

  for (let v = 1; v <= 10; v++) {
    if (len <= capacities[v]) return v;
  }
  throw new Error('Text too long for QR version 1-10');
}

// ── Data encoding ────────────────────────────────────────────────

function isAlphanumericMode(text) {
  return [...text].every(ch => ALPHANUMERIC_CHARS.includes(ch.toUpperCase()));
}

function alphanumericValue(ch) {
  const idx = ALPHANUMERIC_CHARS.indexOf(ch.toUpperCase());
  return idx >= 0 ? idx : 0;
}

function encodeToBits(text, version) {
  const bits = [];

  function pushBits(value, count) {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((value >> i) & 1);
    }
  }

  if (isAlphanumericMode(text)) {
    // Mode indicator: alphanumeric = 0010
    pushBits(0b0010, 4);
    // Character count: 9 bits for versions 1-9, 11 bits for versions 10+
    const ccBits = version >= 10 ? 11 : 9;
    pushBits(text.length, ccBits);
    // Encode pairs
    const upper = text.toUpperCase();
    for (let i = 0; i < upper.length; i += 2) {
      if (i + 1 < upper.length) {
        const val = alphanumericValue(upper[i]) * 45 + alphanumericValue(upper[i + 1]);
        pushBits(val, 11);
      } else {
        pushBits(alphanumericValue(upper[i]), 6);
      }
    }
  } else {
    // Byte mode = 0100
    pushBits(0b0100, 4);
    const bytes = new TextEncoder().encode(text);
    // Character count: 8 bits for versions 1-9, 16 bits for versions 10+
    const ccBits = version >= 10 ? 16 : 8;
    pushBits(bytes.length, ccBits);
    for (const b of bytes) {
      pushBits(b, 8);
    }
  }

  // Terminator
  pushBits(0, 4);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  return bits;
}

// ── Matrix construction ──────────────────────────────────────────

function createMatrix(size) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function createReserved(size) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function drawFinderPattern(matrix, reserved, row, col) {
  const pattern = [
    [1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],
    [1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1],
  ];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const mr = row + r;
      const mc = col + c;
      if (mr >= 0 && mr < matrix.length && mc >= 0 && mc < matrix.length) {
        matrix[mr][mc] = pattern[r][c] === 1;
        reserved[mr][mc] = true;
      }
    }
  }
}

function drawSeparators(matrix, reserved, size) {
  // White separator borders around finder patterns
  const positions = [
    // Top-left: right border (col=7) and bottom border (row=7)
    ...Array.from({ length: 8 }, (_, i) => [[i, 7], [7, i]]).flat(),
    // Top-right: left border (col=size-8) and bottom border (row=7)
    ...Array.from({ length: 8 }, (_, i) => [[i, size - 8], [7, size - 8 + i]]).flat(),
    // Bottom-left: right border (col=7) and top border (row=size-8)
    ...Array.from({ length: 8 }, (_, i) => [[size - 8 + i, 7], [size - 8, i]]).flat(),
  ];
  for (const [r, c] of positions) {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = false;
      reserved[r][c] = true;
    }
  }
}

function drawTimingPatterns(matrix, reserved, size) {
  for (let i = 8; i < size - 8; i++) {
    // Horizontal timing (row 6)
    matrix[6][i] = i % 2 === 0;
    reserved[6][i] = true;
    // Vertical timing (col 6)
    matrix[i][6] = i % 2 === 0;
    reserved[i][6] = true;
  }
}

function drawDarkModule(matrix, reserved, version) {
  const row = 4 * version + 9;
  if (row < matrix.length) {
    matrix[row][8] = true;
    reserved[row][8] = true;
  }
}

function reserveFormatInfo(reserved, size) {
  // Around top-left finder
  for (let i = 0; i < 9; i++) {
    if (i < size) reserved[8][i] = true;
    if (i < size) reserved[i][8] = true;
  }
  // Around top-right finder
  for (let i = 0; i < 8; i++) {
    if (size - 1 - i >= 0) reserved[8][size - 1 - i] = true;
  }
  // Around bottom-left finder
  for (let i = 0; i < 7; i++) {
    if (size - 1 - i >= 0) reserved[size - 1 - i][8] = true;
  }
}

function placeData(matrix, reserved, bits) {
  const size = matrix.length;
  let bitIdx = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    // Skip timing pattern column
    if (right === 6) right = 5;

    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const row of rows) {
      for (const col of [right, right - 1]) {
        if (col < 0 || col >= size) continue;
        if (reserved[row][col]) continue;

        if (bitIdx < bits.length) {
          matrix[row][col] = bits[bitIdx] === 1;
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }
}

function applyMask(matrix, reserved) {
  // Mask pattern 0: (row + col) % 2 === 0
  const size = matrix.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && (r + c) % 2 === 0) {
        matrix[r][c] = !matrix[r][c];
      }
    }
  }
}

function writeFormatInfo(matrix, size) {
  // Format info for mask 0, error correction L
  // Pre-computed BCH-encoded format string for EC level L (01), mask 0 (000)
  // Format: 01 000 → data = 01000 (8), BCH(15,5) with XOR mask 101010000010010
  const formatBits = [1,1,1,0,1,1,1,1,1,0,0,0,1,0,0];

  // Place around top-left
  const positions1 = [
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],
    [8,7],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  ];
  for (let i = 0; i < 15 && i < positions1.length; i++) {
    const [r, c] = positions1[i];
    if (r < size && c < size) matrix[r][c] = formatBits[i] === 1;
  }

  // Place around top-right and bottom-left
  const positions2 = [
    [8, size - 1],[8, size - 2],[8, size - 3],[8, size - 4],
    [8, size - 5],[8, size - 6],[8, size - 7],[8, size - 8],
    [size - 7, 8],[size - 6, 8],[size - 5, 8],[size - 4, 8],
    [size - 3, 8],[size - 2, 8],[size - 1, 8],
  ];
  for (let i = 0; i < 15 && i < positions2.length; i++) {
    const [r, c] = positions2[i];
    if (r < size && c < size) matrix[r][c] = formatBits[i] === 1;
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Encode text into a QR code matrix.
 * @param {string} text - Text to encode
 * @returns {boolean[][]} 2D boolean matrix (true = dark module)
 */
export function encodeQR(text) {
  const version = getQRVersion(text);
  const size = 4 * version + 17;

  const matrix = createMatrix(size);
  const reserved = createReserved(size);

  // Draw finder patterns
  drawFinderPattern(matrix, reserved, 0, 0);               // top-left
  drawFinderPattern(matrix, reserved, 0, size - 7);         // top-right
  drawFinderPattern(matrix, reserved, size - 7, 0);         // bottom-left

  // Draw separators
  drawSeparators(matrix, reserved, size);

  // Draw timing patterns
  drawTimingPatterns(matrix, reserved, size);

  // Draw dark module
  drawDarkModule(matrix, reserved, version);

  // Reserve format info areas
  reserveFormatInfo(reserved, size);

  // Encode data
  const bits = encodeToBits(text, version);

  // Place data
  placeData(matrix, reserved, bits);

  // Apply mask
  applyMask(matrix, reserved);

  // Write format info
  writeFormatInfo(matrix, size);

  return matrix;
}

/**
 * Render a QR code into an HTML element.
 * @param {HTMLElement} el - Target element
 * @param {string} text - Text to encode
 * @param {object} [opts]
 * @param {number} [opts.moduleSize=4] - Size of each module in pixels
 * @param {string} [opts.mode='table'] - Render mode: 'table' or 'grid'
 * @param {string} [opts.darkColor='#000'] - Dark module color
 * @param {string} [opts.lightColor='#fff'] - Light module color
 */
export function renderQR(el, text, opts = {}) {
  const moduleSize = opts.moduleSize || 4;
  const mode = opts.mode || 'table';
  const dark = opts.darkColor || '#000';
  const light = opts.lightColor || '#fff';
  const matrix = encodeQR(text);
  const size = matrix.length;

  if (mode === 'grid') {
    const totalPx = size * moduleSize;
    let html = `<div style="display:inline-grid;grid-template-columns:repeat(${size},${moduleSize}px);width:${totalPx}px;height:${totalPx}px;line-height:0">`;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const bg = matrix[r][c] ? dark : light;
        html += `<div style="width:${moduleSize}px;height:${moduleSize}px;background:${bg}"></div>`;
      }
    }
    html += '</div>';
    el.innerHTML = html;
  } else {
    // Table mode (default)
    let html = `<table style="border-collapse:collapse;border-spacing:0;line-height:0">`;
    for (let r = 0; r < size; r++) {
      html += '<tr>';
      for (let c = 0; c < size; c++) {
        const bg = matrix[r][c] ? dark : light;
        html += `<td style="width:${moduleSize}px;height:${moduleSize}px;padding:0;background:${bg}"></td>`;
      }
      html += '</tr>';
    }
    html += '</table>';
    el.innerHTML = html;
  }
}
