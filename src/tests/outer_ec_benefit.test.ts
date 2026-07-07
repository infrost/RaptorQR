/**
 * Benchmark: confirm outer EC reduces tail waiting time.
 *
 * Simulates frame loss at the packet level and compares decode success
 * with outer EC (any G of G+P generations) vs without (all G source gens).
 */
import { describe, it, expect } from 'vitest';
import { packetize } from '@/core/sender/packetizer';
import { scheduleFrames } from '@/core/sender/scheduler';
import { parsePacket } from '@/core/protocol/packet';
import { GenerationDecoder } from '@/core/fec/rlnc_decoder';
import { assemblePayload } from '@/core/reconstruct/assemble';
import { K, MAX_PAYLOAD_SIZE } from '@/core/protocol/constants';
import { inflateSync } from 'fflate';

describe('Outer EC Benefit', () => {
  it('should succeed with outer EC when a source generation is lost, while without EC fails', async () => {
    // Use ~120KB of random (uncompressible) data to force >34 source generations
    // so outer RS actually creates parity generations.
    const payload = new Uint8Array(120000);
    for (let i = 0; i < payload.length; i += 65536) {
      crypto.getRandomValues(payload.subarray(i, Math.min(i + 65536, payload.length)));
    }

    const result = packetize(payload, false, true);
    expect(result.sourceGenerations).toBeGreaterThanOrEqual(34);
    expect(result.totalGenerations).toBeGreaterThan(result.sourceGenerations);

    const frames = scheduleFrames(result.packets, result.totalGenerations);

    // Drop ALL frames from the LAST source generation
    const missingGen = result.sourceGenerations - 1;

    // With EC: can use parity generations
    const decoderWithEC = new GenerationDecoder(K, MAX_PAYLOAD_SIZE);
    const solvedWithEC = new Set<number>();
    let packetsNeededWithEC = 0;

    // Without EC: must solve all source generations
    const decoderWithoutEC = new GenerationDecoder(K, MAX_PAYLOAD_SIZE);
    const solvedWithoutEC = new Set<number>();

    for (let i = 0; i < frames.length; i++) {
      const pkt = parsePacket(frames[i]!);
      if (pkt.header.generationIndex === missingGen) continue;

      const isSystematic = pkt.header.symbolIndex < K;
      if (isSystematic) {
        decoderWithEC.addSystematicSymbol(pkt.header.generationIndex, pkt.payload, pkt.header.symbolIndex);
        decoderWithoutEC.addSystematicSymbol(pkt.header.generationIndex, pkt.payload, pkt.header.symbolIndex);
      } else {
        decoderWithEC.addCodedSymbol(pkt.header.generationIndex, pkt.payload, pkt.header.symbolIndex - K);
        decoderWithoutEC.addCodedSymbol(pkt.header.generationIndex, pkt.payload, pkt.header.symbolIndex - K);
      }

      if (decoderWithEC.isSolved(pkt.header.generationIndex)) {
        solvedWithEC.add(pkt.header.generationIndex);
      }
      if (decoderWithoutEC.isSolved(pkt.header.generationIndex) && pkt.header.generationIndex < result.sourceGenerations) {
        solvedWithoutEC.add(pkt.header.generationIndex);
      }

      if (packetsNeededWithEC === 0 && solvedWithEC.size >= result.sourceGenerations) {
        packetsNeededWithEC = i + 1;
      }
    }

    // With EC should succeed
    expect(solvedWithEC.size).toBeGreaterThanOrEqual(result.sourceGenerations);
    expect(packetsNeededWithEC).toBeGreaterThan(0);

    // Without EC should fail (missing one source generation)
    expect(solvedWithoutEC.size).toBeLessThan(result.sourceGenerations);

    // Assemble and verify
    const solvedMap = new Map<number, Uint8Array[]>();
    for (const genIdx of solvedWithEC) {
      solvedMap.set(genIdx, decoderWithEC.getSourceSymbols(genIdx)!);
    }
    const assembled = assemblePayload(solvedMap, result.totalGenerations, result.dataLength);
    const recovered = result.isCompressed ? inflateSync(assembled) : assembled;
    expect(recovered).toEqual(payload);

    console.log('Outer EC benefit:', {
      payloadBytes: payload.length,
      compressedBytes: result.dataLength,
      sourceGenerations: result.sourceGenerations,
      totalGenerations: result.totalGenerations,
      totalPackets: frames.length,
      packetsNeededWithEC,
      solvedWithEC: solvedWithEC.size,
      solvedWithoutEC: solvedWithoutEC.size,
    });
  }, 30000);

  it('should recover when a whole source generation is missing', async () => {
    // Large payload (>34 source generations) so outer RS creates parity.
    const payload = new TextEncoder().encode(
      'Whole generation missing test payload that is long enough. '.repeat(2000),
    );

    const result = packetize(payload, false, false);
    expect(result.sourceGenerations).toBeGreaterThanOrEqual(34);
    expect(result.totalGenerations).toBeGreaterThan(result.sourceGenerations);

    const frames = scheduleFrames(result.packets, result.totalGenerations);

    // Drop EVERY frame from the LAST source generation
    const missingGen = result.sourceGenerations - 1;

    const decoder = new GenerationDecoder(K, MAX_PAYLOAD_SIZE);
    const solvedGens = new Set<number>();

    for (let i = 0; i < frames.length; i++) {
      const pkt = parsePacket(frames[i]!);
      if (pkt.header.generationIndex === missingGen) continue;

      const isSystematic = pkt.header.symbolIndex < K;
      if (isSystematic) {
        decoder.addSystematicSymbol(pkt.header.generationIndex, pkt.payload, pkt.header.symbolIndex);
      } else {
        decoder.addCodedSymbol(pkt.header.generationIndex, pkt.payload, pkt.header.symbolIndex - K);
      }

      if (decoder.isSolved(pkt.header.generationIndex)) {
        solvedGens.add(pkt.header.generationIndex);
      }
    }

    // We should still have enough generations solved because
    // parity generation(s) compensate for the missing source generation.
    expect(solvedGens.size).toBeGreaterThanOrEqual(result.sourceGenerations);

    const solvedMap = new Map<number, Uint8Array[]>();
    for (const genIdx of solvedGens) {
      solvedMap.set(genIdx, decoder.getSourceSymbols(genIdx)!);
    }

    const assembled = assemblePayload(solvedMap, result.totalGenerations, result.dataLength);
    expect(assembled).toEqual(payload);
  }, 30000);
});
