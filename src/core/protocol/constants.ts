/**
 * Core protocol constants for the QR transfer system.
 *
 * Default profile: V10, ECC M, K=16, R=8. Larger QR profiles reuse the same
 * packet header and FEC geometry with a larger per-symbol payload size.
 *
 * @module
 */

// ─── Magic Byte ──────────────────────────────────────────────────────────────

/** Single-byte magic identifier: 'Q' (0x51). */
export const MAGIC_BYTE = 0x51;

// ─── Packet Geometry ─────────────────────────────────────────────────────────

/** Size of the fixed packet header in bytes. */
export const HEADER_SIZE = 8;

/** Size of the CRC32C trailer in bytes. */
export const CRC32C_SIZE = 4;

/** Total overhead per packet: header + CRC32C. */
export const PACKET_OVERHEAD = HEADER_SIZE + CRC32C_SIZE;

/** Max payload that fits in a V10-M QR code with our header (213 - 8 - 4). */
export const MAX_PAYLOAD_SIZE = 201;

/** Max total packet size that fits in a V10-M QR code. */
export const MAX_PACKET_SIZE = 213;

// ─── Flag Bits (embedded in the packed 32-bit header word) ───────────────────

/** Flag bit masks for the packet flags. */
export enum Flags {
  /** No flags set. */
  NONE = 0,
  /** Payload is plain text (not a file). */
  IS_TEXT = 1 << 0,
  /** This packet belongs to the last generation. */
  LAST_GENERATION = 1 << 1,
  /** Payload is deflate-raw compressed. */
  COMPRESSED = 1 << 2,
}

// ─── Single Hardcoded Profile ────────────────────────────────────────────────

/** Number of source symbols per generation. */
export const K = 16;

/** Number of coded repair symbols per generation. */
export const R = 8;

/** Reserved symbol index used to mark RaptorQ WASM transport packets. */
export const RAPTORQ_SYMBOL_INDEX = 31;

/** QR code version. */
export const QR_VERSION = 10;

/** QR error correction level. */
export const ECC_LEVEL = 'M' as const;

/** Inter-frame delay in milliseconds (5 fps). */
export const FRAME_DELAY_MS = 200;

// ─── Outer Error Correction ────────────────────────────────────────────────

/** Fraction of extra parity generations (3%). */
export const OUTER_EC_OVERHEAD = 0.03;

/** GF(256) Reed-Solomon can use at most 255 distinct non-zero eval points. */
export const GF256_RS_MAX_EVALUATION_POINTS = 255;

/** Compute number of parity generations for G source generations. */
export function parityCount(sourceGenerations: number): number {
  if (sourceGenerations <= 0) return 0;
  const requestedParity = Math.floor(sourceGenerations * OUTER_EC_OVERHEAD);
  const maxSafeParity = Math.max(0, GF256_RS_MAX_EVALUATION_POINTS - sourceGenerations);
  return Math.min(requestedParity, maxSafeParity);
}

/** Compute source generation count from the exact encoded payload size. */
export function sourceGenerationsFromDataLength(dataLength: number, symbolSize: number): number {
  if (!Number.isInteger(symbolSize) || symbolSize <= 0) {
    throw new RangeError(`Invalid symbol size: ${symbolSize}`);
  }
  const totalSymbols = Math.max(1, Math.ceil(Math.max(0, dataLength) / symbolSize));
  return Math.max(1, Math.ceil(totalSymbols / K));
}
