/**
 * Minimal, dependency-free QR Code encoder — byte mode, error-correction
 * level M, automatic version selection (1–10). Sufficient for the short ASCII
 * `hive://pair?…` deep link (§3.7); not a general-purpose QR library.
 *
 * Returns a square boolean matrix (true = dark module). Rendered as SVG by
 * QrCode.tsx. Unit-tested for structure (finder patterns, size, quiet zone).
 *
 * Reference: ISO/IEC 18004. Only the subset needed here is implemented.
 */

// Galois field (GF(256)) tables for Reed–Solomon.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array<number>(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i], factor);
  }
  return res;
}

// Per-version (level M) capacity + ECC parameters for versions 1–10.
// [version]: { size, ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data }
interface VersionSpec {
  version: number;
  ecPerBlock: number;
  g1Blocks: number;
  g1Data: number;
  g2Blocks: number;
  g2Data: number;
}

const VERSIONS_M: VersionSpec[] = [
  { version: 1, ecPerBlock: 10, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0 },
  { version: 2, ecPerBlock: 16, g1Blocks: 1, g1Data: 28, g2Blocks: 0, g2Data: 0 },
  { version: 3, ecPerBlock: 26, g1Blocks: 1, g1Data: 44, g2Blocks: 0, g2Data: 0 },
  { version: 4, ecPerBlock: 18, g1Blocks: 2, g1Data: 32, g2Blocks: 0, g2Data: 0 },
  { version: 5, ecPerBlock: 24, g1Blocks: 2, g1Data: 43, g2Blocks: 0, g2Data: 0 },
  { version: 6, ecPerBlock: 16, g1Blocks: 4, g1Data: 27, g2Blocks: 0, g2Data: 0 },
  { version: 7, ecPerBlock: 18, g1Blocks: 4, g1Data: 31, g2Blocks: 0, g2Data: 0 },
  { version: 8, ecPerBlock: 22, g1Blocks: 2, g1Data: 38, g2Blocks: 2, g2Data: 39 },
  { version: 9, ecPerBlock: 22, g1Blocks: 3, g1Data: 36, g2Blocks: 2, g2Data: 37 },
  { version: 10, ecPerBlock: 26, g1Blocks: 4, g1Data: 43, g2Blocks: 1, g2Data: 44 },
];

function totalDataBytes(spec: VersionSpec): number {
  return spec.g1Blocks * spec.g1Data + spec.g2Blocks * spec.g2Data;
}

function sizeForVersion(version: number): number {
  return version * 4 + 17;
}

function encodeToBitStream(text: string, spec: VersionSpec): number[] {
  const bytes = new TextEncoder().encode(text);
  const capacity = totalDataBytes(spec);
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  // Byte mode indicator 0100.
  push(0b0100, 4);
  // Character-count indicator: 8 bits for versions 1–9, 16 for 10+.
  push(bytes.length, spec.version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  // Terminator (up to 4 bits) then pad to byte boundary.
  const dataBits = capacity * 8;
  for (let i = 0; i < 4 && bits.length < dataBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad bytes 0xEC, 0x11 alternating.
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < dataBits) {
    push(padBytes[padIdx % 2], 8);
    padIdx++;
  }
  return bits;
}

function bitsToBytes(bits: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] ?? 0);
    out.push(v);
  }
  return out;
}

function interleave(dataBytes: number[], spec: VersionSpec): number[] {
  // Split into blocks.
  const blocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < spec.g1Blocks; i++) {
    blocks.push(dataBytes.slice(offset, offset + spec.g1Data));
    offset += spec.g1Data;
  }
  for (let i = 0; i < spec.g2Blocks; i++) {
    blocks.push(dataBytes.slice(offset, offset + spec.g2Data));
    offset += spec.g2Data;
  }
  const ecBlocks = blocks.map((b) => rsEncode(b, spec.ecPerBlock));
  const maxData = Math.max(...blocks.map((b) => b.length));
  const result: number[] = [];
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ec of ecBlocks) result.push(ec[i]);
  }
  return result;
}

type Matrix = (boolean | null)[][];

function placeFinder(m: Matrix, row: number, col: number): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const isBorder = r === -1 || r === 7 || c === -1 || c === 7;
      const outer = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
      const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[rr][cc] = !isBorder && (outer || inner);
    }
  }
}

function placeAlignment(m: Matrix, version: number): void {
  const centers = ALIGNMENT_CENTERS[version];
  if (!centers) return;
  for (const r of centers) {
    for (const c of centers) {
      if (m[r][c] !== null) continue; // overlaps finder
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isRing = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          m[r + dr][c + dc] = isRing;
        }
      }
    }
  }
}

const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function placeTiming(m: Matrix): void {
  const size = m.length;
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] === null) m[6][i] = i % 2 === 0;
    if (m[i][6] === null) m[i][6] = i % 2 === 0;
  }
}

function reserveFormat(m: Matrix): void {
  const size = m.length;
  // Mark format-info areas as reserved (temporarily false, overwritten later).
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) m[8][i] = false;
    if (m[i][8] === null) m[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false;
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false;
  }
  m[size - 8][8] = true; // dark module
}

function isFunctionModule(m: Matrix, funcMask: boolean[][], r: number, c: number): boolean {
  return funcMask[r][c];
}

function placeData(m: Matrix, funcMask: boolean[][], bytes: number[]): void {
  const size = m.length;
  let bitIndex = 0;
  const totalBits = bytes.length * 8;
  const getBit = (i: number): boolean => {
    if (i >= totalBits) return false;
    const byte = bytes[i >> 3];
    return ((byte >> (7 - (i & 7))) & 1) === 1;
  };
  let col = size - 1;
  let upward = true;
  while (col > 0) {
    if (col === 6) col--; // skip timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const c = col - j;
        if (isFunctionModule(m, funcMask, row, c)) continue;
        m[row][c] = getBit(bitIndex);
        bitIndex++;
      }
    }
    col -= 2;
    upward = !upward;
  }
}

function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

// Format info for level M + mask, 15 bits with BCH, XORed with mask 101010000010010.
const FORMAT_M: number[] = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

function placeFormat(m: Matrix, mask: number): void {
  const size = m.length;
  const bits = FORMAT_M[mask];
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >> i) & 1) === 1;
    // Around top-left.
    if (i < 6) m[i][8] = bit;
    else if (i === 6) m[7][8] = bit;
    else if (i === 7) m[8][8] = bit;
    else if (i === 8) m[8][7] = bit;
    else m[8][14 - i] = bit;
    // Around top-right / bottom-left.
    if (i < 8) m[8][size - 1 - i] = bit;
    else m[size - 15 + i][8] = bit;
  }
  m[size - 8][8] = true; // dark module
}

function penalty(m: Matrix): number {
  const size = m.length;
  const at = (r: number, c: number) => m[r][c] === true;
  let score = 0;
  // Rule 1: runs of 5+.
  for (let r = 0; r < size; r++) {
    let runColor = at(r, 0), runLen = 1;
    for (let c = 1; c < size; c++) {
      if (at(r, c) === runColor) runLen++;
      else { if (runLen >= 5) score += 3 + (runLen - 5); runColor = at(r, c); runLen = 1; }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = at(0, c), runLen = 1;
    for (let r = 1; r < size; r++) {
      if (at(r, c) === runColor) runLen++;
      else { if (runLen >= 5) score += 3 + (runLen - 5); runColor = at(r, c); runLen = 1; }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  // Rule 2: 2x2 blocks.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }
  return score;
}

export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

/** Encode text into a QR matrix (level M). Throws if it exceeds version 10. */
export function encodeQr(text: string): QrMatrix {
  const spec = VERSIONS_M.find((v) => {
    const bits = encodeToBitStream(text, v).length; // side effect: validates capacity fit below
    return bits <= totalDataBytes(v) * 8;
  });
  if (!spec) throw new Error("QR payload too large for supported versions (1–10)");

  const bits = encodeToBitStream(text, spec);
  const dataBytes = bitsToBytes(bits);
  const finalBytes = interleave(dataBytes, spec);

  const size = sizeForVersion(spec.version);
  const m: Matrix = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));

  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  placeAlignment(m, spec.version);
  placeTiming(m);
  reserveFormat(m);

  // Function-module mask: any cell already set before data placement.
  const funcMask: boolean[][] = m.map((row) => row.map((cell) => cell !== null));

  placeData(m, funcMask, finalBytes);

  // Choose the best mask by penalty.
  let best: { mask: number; matrix: Matrix; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate: Matrix = m.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (funcMask[r][c]) continue;
        if (maskFn(mask, r, c)) candidate[r][c] = !(candidate[r][c] === true);
      }
    }
    placeFormat(candidate, mask);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { mask, matrix: candidate, score };
  }

  const chosen = best!.matrix;
  const modules = chosen.map((row) => row.map((cell) => cell === true));
  return { size, modules };
}
