/**
 * QR capacity helpers.
 *
 * The actual QR symbol writers live in `qr_encoder_browser.ts` and
 * `qr_encoder_node.ts`; this module only keeps the shared capacity math used
 * by transfer profiles and packet sizing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EccLevel = 'L' | 'M' | 'Q' | 'H';

// ---------------------------------------------------------------------------
// RS block table
// Layout per version: [L-entry, M-entry, Q-entry, H-entry]
// Each entry is a flat array of [count, totalCodewords, dataCodewords, …]
// repeating for each block-group type.
// ---------------------------------------------------------------------------

const RS_BLOCK_TABLE: number[][] = [
  // V1
  [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
  // V2
  [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
  // V3
  [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
  // V4
  [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
  // V5
  [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
  // V6
  [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
  // V7
  [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
  // V8
  [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
  // V9
  [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
  // V10
  [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
  // V11
  [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
  // V12
  [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
  // V13
  [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
  // V14
  [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
  // V15
  [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13],
  // V16
  [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
  // V17
  [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
  // V18
  [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
  // V19
  [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
  // V20
  [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
  // V21
  [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
  // V22
  [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
  // V23
  [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
  // V24
  [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
  // V25
  [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
  // V26
  [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
  // V27
  [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
  // V28
  [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
  // V29
  [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
  // V30
  [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
  // V31
  [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
  // V32
  [17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
  // V33
  [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
  // V34
  [13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17],
  // V35
  [12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16],
  // V36
  [6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16],
  // V37
  [17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16],
  // V38
  [4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16],
  // V39
  [20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16],
  // V40
  [19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16],
];

// ---------------------------------------------------------------------------
// Capacity helpers
// ---------------------------------------------------------------------------

const ECC_INDEX: Record<EccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ZXING_UINT8_ECI_OVERHEAD_BITS = 20;

/**
 * Returns the maximum number of data bytes that can be stored in a QR code
 * of the given version using **Byte mode**.
 *
 * Formula:  floor((totalDataCodewords * 8 - overhead) / 8)
 * Overhead = 4 bits (mode indicator) + character-count bits (8 for v1-9, 16 for v10-40).
 */
export function getMaxByteCapacity(version: number, eccLevel: EccLevel): number {
  return getMaxByteCapacityWithExtraOverhead(version, eccLevel, 0);
}

/**
 * Maximum raw bytes accepted by `zxing-wasm/writer` when the input is a
 * Uint8Array. ZXing emits a binary ECI segment for byte input, which consumes
 * two extra QR codewords versus the plain Byte-mode path used by fast_qr.
 */
export function getMaxZXingWriterByteCapacity(
  version: number,
  eccLevel: EccLevel,
): number {
  return getMaxByteCapacityWithExtraOverhead(
    version,
    eccLevel,
    ZXING_UINT8_ECI_OVERHEAD_BITS,
  );
}

/**
 * Find the minimum QR version (1-40) that can hold `dataLength` bytes
 * in byte mode at the given ECC level.  Throws if V40 is insufficient.
 */
export function getMinVersion(dataLength: number, eccLevel: EccLevel): number {
  for (let v = 1; v <= 40; v++) {
    if (dataLength <= getMaxByteCapacity(v, eccLevel)) {
      return v;
    }
  }
  throw new Error(
    `Data too large (${dataLength} bytes) for any QR version at ECC level ${eccLevel}.`,
  );
}

function getMaxByteCapacityWithExtraOverhead(
  version: number,
  eccLevel: EccLevel,
  extraOverheadBits: number,
): number {
  const totalDataCodewords = getTotalDataCodewords(version, eccLevel);
  const charCountBits = version <= 9 ? 8 : 16;
  const overheadBits = 4 + charCountBits + extraOverheadBits;
  return Math.max(0, Math.floor((totalDataCodewords * 8 - overheadBits) / 8));
}

function getTotalDataCodewords(version: number, eccLevel: EccLevel): number {
  const idx = (version - 1) * 4 + ECC_INDEX[eccLevel];
  const entry = RS_BLOCK_TABLE[idx];

  if (!entry) {
    throw new Error(`No RS block table entry for V${version}-${eccLevel}`);
  }

  let totalDataCodewords = 0;
  for (let i = 0; i < entry.length; i += 3) {
    totalDataCodewords += entry[i] * entry[i + 2];
  }
  return totalDataCodewords;
}

