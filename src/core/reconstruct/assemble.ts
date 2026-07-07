/**
 * Payload reassembly from decoded RLNC generations, with outer RS recovery.
 *
 * After enough generations have been solved (any G out of G+P), recovers
 * missing source generations using the outer Reed-Solomon code, then
 * concatenates the source symbols in generation order and trims to the
 * exact data length.
 *
 * @module
 */

import {
  sourceGenerationsFromDataLength,
  parityCount,
  K,
  MAX_PAYLOAD_SIZE,
} from '@/core/protocol/constants';
import { decodeOuterRS } from '@/core/fec/outer_rs';

/**
 * Assemble the original preprocessed payload from solved RLNC generations.
 *
 * Uses outer Reed-Solomon to recover missing source generations when
 * enough total generations (source + parity) have been received.
 *
 * @param solvedGenerations - Map from generation index to the array of K source symbols
 * @param totalGenerations  - Total generations in stream (G + P)
 * @param dataLength        - Exact preprocessed size in bytes
 * @returns Concatenated payload bytes, trimmed to dataLength
 * @throws {Error} If not enough generations are available to recover
 */
export function assemblePayload(
  solvedGenerations: Map<number, Uint8Array[]>,
  totalGenerations: number,
  dataLength: number,
  symbolSize: number = MAX_PAYLOAD_SIZE,
): Uint8Array {
  if (totalGenerations === 0) {
    return new Uint8Array(0);
  }

  const sourceGens = sourceGenerationsFromDataLength(dataLength, symbolSize);
  const expectedParity = parityCount(sourceGens);
  const P = totalGenerations - sourceGens;
  if (P < 0 || P !== expectedParity) {
    throw new Error(
      `assemblePayload: inconsistent generation metadata; expected ` +
      `${sourceGens + expectedParity} total generations, got ${totalGenerations}`,
    );
  }

  if (solvedGenerations.size < sourceGens) {
    throw new Error(
      `assemblePayload: only ${solvedGenerations.size} generations solved, ` +
        `need at least ${sourceGens} (out of ${totalGenerations} total)`,
    );
  }

  // Build chunks from solved generations
  const receivedChunks = new Map<number, Uint8Array>();
  for (const [genIdx, symbols] of solvedGenerations) {
    const chunk = new Uint8Array(K * symbolSize);
    for (let i = 0; i < symbols.length; i++) {
      chunk.set(symbols[i]!, i * symbolSize);
    }
    receivedChunks.set(genIdx, chunk);
  }

  // Apply outer RS to recover missing source generations
  const sourceChunks = decodeOuterRS(receivedChunks, sourceGens, P);

  // Concatenate all source chunks and trim
  const totalSize = sourceChunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of sourceChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined.slice(0, dataLength);
}
