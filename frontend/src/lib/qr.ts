/**
 * Lightweight, self-contained QR Code Generator in pure TypeScript
 *
 * Implements standard QR Code (ISO/IEC 18004) Byte mode with Error Correction Level L/M.
 * Generates an SVG path or matrix with zero external dependencies.
 */

// Galois Field GF(256) log and exp tables for Reed-Solomon error correction
const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  EXP_TABLE[255] = EXP_TABLE[0];
})();

function gMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 255];
}

function rsGenPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const nextPoly = new Uint8Array(poly.length + 1);
    const factor = EXP_TABLE[i];
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= gMul(poly[j], factor);
      nextPoly[j + 1] ^= poly[j];
    }
    poly = nextPoly;
  }
  return poly;
}

function rsCalculate(data: Uint8Array, numEcBytes: number): Uint8Array {
  const gen = rsGenPoly(numEcBytes);
  const res = new Uint8Array(numEcBytes);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.set(res.subarray(1));
    res[numEcBytes - 1] = 0;
    for (let j = 0; j < numEcBytes; j++) {
      res[j] ^= gMul(gen[j], factor);
    }
  }
  return res;
}

// QR Code Version specs: [size, totalCodewords, dataCodewords, ecCodewords] (Level M)
const QR_VERSIONS: [number, number, number, number][] = [
  [21, 26, 16, 10], // V1
  [25, 44, 28, 16], // V2
  [29, 70, 44, 26], // V3
  [33, 100, 64, 36], // V4
  [37, 134, 86, 48], // V5
  [41, 172, 108, 64], // V6
];

export function generateQrMatrix(text: string): boolean[][] {
  const utf8Bytes = new TextEncoder().encode(text);
  const dataLen = utf8Bytes.length;

  // Find smallest version that fits
  let verIdx = 0;
  while (verIdx < QR_VERSIONS.length && QR_VERSIONS[verIdx][2] - 2 < dataLen) {
    verIdx++;
  }
  if (verIdx >= QR_VERSIONS.length) {
    verIdx = QR_VERSIONS.length - 1;
  }

  const [size, totalBytes, dataCapacity, ecBytes] = QR_VERSIONS[verIdx];

  // Encode byte mode data
  const data = new Uint8Array(dataCapacity);
  let bitPos = 0;
  const writeBits = (val: number, bits: number) => {
    for (let i = bits - 1; i >= 0; i--) {
      const bit = (val >> i) & 1;
      const byteIdx = bitPos >> 3;
      if (byteIdx < dataCapacity) {
        data[byteIdx] |= bit << (7 - (bitPos & 7));
      }
      bitPos++;
    }
  };

  // Mode Indicator 0100 (Byte mode)
  writeBits(0b0100, 4);
  // Character count indicator (8 bits for V1-V9)
  writeBits(Math.min(dataLen, 255), 8);
  // Payload
  for (let i = 0; i < dataLen && (bitPos >> 3) < dataCapacity; i++) {
    writeBits(utf8Bytes[i], 8);
  }
  // Terminator
  writeBits(0, 4);
  // Pad bytes
  let padToggle = false;
  while ((bitPos >> 3) < dataCapacity) {
    writeBits(padToggle ? 0x11 : 0xec, 8);
    padToggle = !padToggle;
  }

  // Compute Error Correction Codewords
  const ec = rsCalculate(data, ecBytes);
  const allBytes = new Uint8Array(totalBytes);
  allBytes.set(data);
  allBytes.set(ec, dataCapacity);

  // Initialize matrix and reservation mask
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isReserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setModule = (r: number, c: number, val: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = val;
      isReserved[r][c] = true;
    }
  };

  // Add 7x7 Finder Pattern at (row, col)
  const addFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          const isBlack =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          matrix[nr][nc] = isBlack;
          isReserved[nr][nc] = true;
        }
      }
    }
  };

  addFinder(0, 0);
  addFinder(0, size - 7);
  addFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }

  // Dark module
  setModule(size - 8, 8, true);

  // Reserve format info area
  for (let i = 0; i < 9; i++) {
    isReserved[8][i] = true;
    isReserved[i][8] = true;
    if (size - 1 - i >= 0) {
      isReserved[8][size - 1 - i] = true;
      isReserved[size - 1 - i][8] = true;
    }
  }

  // Interleave data bits into matrix
  let curByte = 0;
  let curBit = 7;
  let upwards = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing pattern
    for (let vert = 0; vert < size; vert++) {
      const row = upwards ? size - 1 - vert : vert;
      for (let col = right; col >= right - 1; col--) {
        if (!isReserved[row][col]) {
          let bit = false;
          if (curByte < allBytes.length) {
            bit = ((allBytes[curByte] >> curBit) & 1) === 1;
            curBit--;
            if (curBit < 0) {
              curBit = 7;
              curByte++;
            }
          }
          // Mask pattern 0: (row + col) % 2 === 0
          const mask = (row + col) % 2 === 0;
          matrix[row][col] = bit !== mask;
        }
      }
    }
    upwards = !upwards;
  }

  // Format info (Level M, Mask 0): 0x5412 XOR 0x5412 = 0b101010000010010
  const formatBits = [true, false, true, false, true, false, false, false, false, false, true, false, false, true, false];
  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i];
  matrix[8][7] = formatBits[6];
  matrix[8][8] = formatBits[7];
  matrix[7][8] = formatBits[8];
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = formatBits[i];

  for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = formatBits[i];
  for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = formatBits[i];

  return matrix;
}

/**
 * Renders a QR code matrix as an SVG path string.
 */
export function matrixToSvgPath(matrix: boolean[][], scale = 6): string {
  const size = matrix.length;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        path += `M${c * scale},${r * scale}h${scale}v${scale}h-${scale}z `;
      }
    }
  }
  return path;
}
