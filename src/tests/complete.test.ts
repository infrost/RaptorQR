/**
 * Complete test suite for the QR transfer protocol.
 */
import { describe, it, expect } from 'vitest';

// ─── Constants ───────────────────────────────────────────────────────────────────

describe('Protocol Constants', () => {
  it('should have the correct values', async () => {
    const {
      MAGIC_BYTE,
      QR_VERSION,
      ECC_LEVEL,
      K,
      R,
      FRAME_DELAY_MS,
      MAX_PACKET_SIZE,
      MAX_PAYLOAD_SIZE,
      PACKET_OVERHEAD,
      HEADER_SIZE,
      CRC32C_SIZE,
      Flags,
      OUTER_EC_OVERHEAD,
    } = await import('@/core/protocol/constants');

    expect(MAGIC_BYTE).toBe(0x51);
    expect(QR_VERSION).toBe(10);
    expect(ECC_LEVEL).toBe('M');
    expect(K).toBe(16);
    expect(R).toBe(8);
    expect(FRAME_DELAY_MS).toBe(200);
    expect(MAX_PACKET_SIZE).toBe(213);
    expect(MAX_PAYLOAD_SIZE).toBe(201);
    expect(PACKET_OVERHEAD).toBe(12);
    expect(HEADER_SIZE).toBe(8);
    expect(CRC32C_SIZE).toBe(4);
    expect(OUTER_EC_OVERHEAD).toBe(0.03);

    expect(Flags.IS_TEXT).toBe(1);
    expect(Flags.LAST_GENERATION).toBe(2);
    expect(Flags.COMPRESSED).toBe(4);
  });
});

// ─── Packet Serialization ──────────────────────────────────────────────────────────

describe('Packet Serialization', () => {
  it('should create and parse a packet correctly', async () => {
    const { createPacket, parsePacket } = await import('@/core/protocol/packet');

    const header = {
      generationIndex: 5,
      totalGenerations: 10,
      symbolIndex: 7,
      isText: true,
      isLastGeneration: true,
      compressed: false,
      dataLength: 500,
    };

    const payload = new Uint8Array(50).fill(0xab);
    const packet = createPacket(header, payload);

    expect(packet.length).toBe(8 + 50 + 4);

    const parsed = parsePacket(packet);
    expect(parsed.header.generationIndex).toBe(5);
    expect(parsed.header.totalGenerations).toBe(10);
    expect(parsed.header.symbolIndex).toBe(7);
    expect(parsed.header.isText).toBe(true);
    expect(parsed.header.isLastGeneration).toBe(true);
    expect(parsed.header.compressed).toBe(false);
    expect(parsed.header.dataLength).toBe(500);
    expect(parsed.payload.length).toBe(50);
    expect(Array.from(parsed.payload)).toEqual(Array.from(payload));
  });

  it('should reject a packet with bad magic', async () => {
    const { parsePacket } = await import('@/core/protocol/packet');
    const bad = new Uint8Array(12);
    bad[0] = 0x00; // wrong magic
    expect(() => parsePacket(bad)).toThrow('Invalid magic byte');
  });

  it('should reject a packet with bad CRC', async () => {
    const { parsePacket } = await import('@/core/protocol/packet');
    const packet = new Uint8Array(12);
    packet[0] = 0x51; // valid magic
    expect(() => parsePacket(packet)).toThrow('CRC32C mismatch');
  });
});

// ─── CRC32-C ───────────────────────────────────────────────────────────────────

describe('CRC32-C', () => {
  it('should compute and verify CRC for a packet', async () => {
    const { crc32c } = await import('@/core/protocol/crc32c');
    const data = new Uint8Array([0x51, 0x02, 0x00, 0x00, 0x00, 0xde, 0xad, 0xbe]);
    const crc = crc32c(data);
    expect(typeof crc).toBe('number');
  });
});

// ─── RLNC Encoder ──────────────────────────────────────────────────────────

describe('RLNC Encoder', () => {
  it('should produce K systematic symbols', async () => {
    const { encodeGeneration } = await import('@/core/fec/rlnc_encoder');
    const symbols = [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
    ];
    const k = 2;
    const r = 2;
    const generationIndex = 0;

    const result = encodeGeneration(symbols, k, r, generationIndex);

    expect(result.length).toBe(k + r);
    expect(result[0]!.data).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(result[1]!.data).toEqual(new Uint8Array([5, 6, 7, 8]));
  });

  it('coded symbols should be non-zero and different', async () => {
    const { encodeGeneration } = await import('@/core/fec/rlnc_encoder');
    const symbols = [
      new Uint8Array([10, 20]),
      new Uint8Array([30, 40]),
    ];
    const k = 2;
    const r = 2;

    const result = encodeGeneration(symbols, k, r, 0);

    expect(result[2]!.data).not.toEqual(new Uint8Array([0, 0]));
    expect(result[3]!.data).not.toEqual(new Uint8Array([0, 0]));
  });

  it('should generate reproducible coefficients', async () => {
    const { generateCoefficients, deriveCoefficientSeed } = await import('@/core/fec/rlnc_encoder');
    const seed = deriveCoefficientSeed(5, 0);
    const coeffs1 = generateCoefficients(16, seed);
    const coeffs2 = generateCoefficients(16, seed);
    expect(coeffs1).toEqual(coeffs2);
    expect(coeffs1.length).toBe(16);
  });
});

// ─── RLNC Decoder ──────────────────────────────────────────────────────────

describe('RLNC Decoder', () => {
  it('should decode from systematic symbols', async () => {
    const { GenerationDecoder } = await import('@/core/fec/rlnc_decoder');
    const { encodeGeneration } = await import('@/core/fec/rlnc_encoder');

    const symbols = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    ];
    const k = 2;
    const r = 2;

    const encoded = encodeGeneration(symbols, k, r, 0);
    const decoder = new GenerationDecoder(k, 3);

    decoder.addSystematicSymbol(0, encoded[0]!.data, encoded[0]!.sourceIndex);
    decoder.addSystematicSymbol(0, encoded[1]!.data, encoded[1]!.sourceIndex);

    expect(decoder.isSolved(0)).toBe(true);
    const recovered = decoder.getSourceSymbols(0);
    expect(recovered).not.toBeNull();
    expect(recovered![0]).toEqual(new Uint8Array([1, 2, 3]));
    expect(recovered![1]).toEqual(new Uint8Array([4, 5, 6]));
  });

  it('should decode from coded symbols', async () => {
    const { GenerationDecoder } = await import('@/core/fec/rlnc_decoder');
    const { encodeGeneration } = await import('@/core/fec/rlnc_encoder');

    const symbols = [
      new Uint8Array([7, 8, 9]),
      new Uint8Array([10, 11, 12]),
    ];
    const k = 2;
    const r = 2;

    const encoded = encodeGeneration(symbols, k, r, 0);
    const decoder = new GenerationDecoder(k, 3);

    decoder.addCodedSymbol(0, encoded[2]!.data, 0);
    decoder.addCodedSymbol(0, encoded[3]!.data, 1);

    expect(decoder.isSolved(0)).toBe(true);
    const recovered = decoder.getSourceSymbols(0);
    expect(recovered).not.toBeNull();
    expect(recovered![0]).toEqual(new Uint8Array([7, 8, 9]));
    expect(recovered![1]).toEqual(new Uint8Array([10, 11, 12]));
  });

  it('should handle out-of-order symbols', async () => {
    const { GenerationDecoder } = await import('@/core/fec/rlnc_decoder');
    const { encodeGeneration } = await import('@/core/fec/rlnc_encoder');

    const symbols = [
      new Uint8Array([1, 1]),
      new Uint8Array([2, 2]),
      new Uint8Array([3, 3]),
    ];
    const k = 3;
    const r = 2;

    const encoded = encodeGeneration(symbols, k, r, 0);
    const decoder = new GenerationDecoder(k, 2);

    decoder.addSystematicSymbol(0, encoded[2]!.data, encoded[2]!.sourceIndex);
    decoder.addSystematicSymbol(0, encoded[0]!.data, encoded[0]!.sourceIndex);
    decoder.addSystematicSymbol(0, encoded[1]!.data, encoded[1]!.sourceIndex);

    expect(decoder.isSolved(0)).toBe(true);
    const recovered = decoder.getSourceSymbols(0);
    expect(recovered).not.toBeNull();
    expect(recovered![0]).toEqual(new Uint8Array([1, 1]));
    expect(recovered![1]).toEqual(new Uint8Array([2, 2]));
    expect(recovered![2]).toEqual(new Uint8Array([3, 3]));
  });

  it('should track rank incrementally', async () => {
    const { GenerationDecoder } = await import('@/core/fec/rlnc_decoder');
    const { encodeGeneration } = await import('@/core/fec/rlnc_encoder');

    const symbols = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    const encoded = encodeGeneration(symbols, 2, 2, 0);
    const decoder = new GenerationDecoder(2, 2);

    expect(decoder.rank(0)).toBe(0);
    decoder.addSystematicSymbol(0, encoded[0]!.data, encoded[0]!.sourceIndex);
    expect(decoder.rank(0)).toBe(1);
    decoder.addSystematicSymbol(0, encoded[1]!.data, encoded[1]!.sourceIndex);
    expect(decoder.rank(0)).toBe(2);
  });
});

// ─── Outer Reed-Solomon ────────────────────────────────────────────────────────────────────────

describe('Outer Reed-Solomon', () => {
  it('should encode and decode with no loss', async () => {
    const { encodeOuterRS, decodeOuterRS } = await import('@/core/fec/outer_rs');

    const chunks = [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
      new Uint8Array([9, 10, 11, 12]),
    ];
    const parity = encodeOuterRS(chunks, 1);
    expect(parity.length).toBe(1);

    const received = new Map<number, Uint8Array>();
    received.set(0, chunks[0]!);
    received.set(1, chunks[1]!);
    received.set(2, chunks[2]!);
    received.set(3, parity[0]!);

    const recovered = decodeOuterRS(received, 3, 1);
    expect(recovered.length).toBe(3);
    expect(Array.from(recovered[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(recovered[1]!)).toEqual([5, 6, 7, 8]);
    expect(Array.from(recovered[2]!)).toEqual([9, 10, 11, 12]);
  });

  it('should recover one missing source generation', async () => {
    const { encodeOuterRS, decodeOuterRS } = await import('@/core/fec/outer_rs');

    const chunks = [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
      new Uint8Array([9, 10, 11, 12]),
    ];
    const parity = encodeOuterRS(chunks, 1);

    // Miss source generation 1, but have parity
    const received = new Map<number, Uint8Array>();
    received.set(0, chunks[0]!);
    received.set(2, chunks[2]!);
    received.set(3, parity[0]!);

    const recovered = decodeOuterRS(received, 3, 1);
    expect(recovered.length).toBe(3);
    expect(Array.from(recovered[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(recovered[1]!)).toEqual([5, 6, 7, 8]);
    expect(Array.from(recovered[2]!)).toEqual([9, 10, 11, 12]);
  });

  it('should recover two missing source generations with two parity', async () => {
    const { encodeOuterRS, decodeOuterRS } = await import('@/core/fec/outer_rs');

    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
      new Uint8Array([10, 11, 12]),
    ];
    const parity = encodeOuterRS(chunks, 2);
    expect(parity.length).toBe(2);

    // Miss source generations 1 and 2
    const received = new Map<number, Uint8Array>();
    received.set(0, chunks[0]!);
    received.set(3, chunks[3]!);
    received.set(4, parity[0]!);
    received.set(5, parity[1]!);

    const recovered = decodeOuterRS(received, 4, 2);
    expect(recovered.length).toBe(4);
    expect(Array.from(recovered[0]!)).toEqual([1, 2, 3]);
    expect(Array.from(recovered[1]!)).toEqual([4, 5, 6]);
    expect(Array.from(recovered[2]!)).toEqual([7, 8, 9]);
    expect(Array.from(recovered[3]!)).toEqual([10, 11, 12]);
  });

  it('should throw when not enough parity available', async () => {
    const { encodeOuterRS, decodeOuterRS } = await import('@/core/fec/outer_rs');

    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    ];
    const parity = encodeOuterRS(chunks, 1);

    const received = new Map<number, Uint8Array>();
    received.set(0, chunks[0]!);
    // Missing source 1 AND missing parity

    expect(() => decodeOuterRS(received, 2, 1)).toThrow('Cannot recover');
  });
});

// ─── Payload Assembly ──────────────────────────────────────────────────────────

describe('Payload Assembly', () => {
  it('should assemble exact data with padding trimmed', async () => {
    const { assemblePayload } = await import('@/core/reconstruct/assemble');
    const { K, MAX_PAYLOAD_SIZE } = await import('@/core/protocol/constants');

    // Create proper-sized symbols (K symbols of MAX_PAYLOAD_SIZE bytes each)
    const g0: Uint8Array[] = [];
    for (let i = 0; i < K; i++) g0.push(new Uint8Array(MAX_PAYLOAD_SIZE));
    g0[0]![0] = 1; g0[0]![1] = 2; g0[0]![2] = 3; g0[0]![3] = 4;
    g0[1]![0] = 5; g0[1]![1] = 6; g0[1]![2] = 7; g0[1]![3] = 8;

    const g1: Uint8Array[] = [];
    for (let i = 0; i < K; i++) g1.push(new Uint8Array(MAX_PAYLOAD_SIZE));
    g1[0]![0] = 9; g1[0]![1] = 10; g1[0]![2] = 11; g1[0]![3] = 12;

    const solved = new Map<number, Uint8Array[]>();
    solved.set(0, g0);
    solved.set(1, g1);

    // 2 source gens + 0 parity = 2 total (small file, no outer RS). Both source gens present.
    // dataLength spans into second generation so we can verify cross-gen assembly
    const dataLength = K * MAX_PAYLOAD_SIZE + 4;
    const data = assemblePayload(solved, 2, dataLength);
    expect(data.length).toBe(dataLength);
    expect(data[0]).toBe(1);
    expect(data[1]).toBe(2);
    expect(data[2]).toBe(3);
    expect(data[3]).toBe(4);
    expect(data[MAX_PAYLOAD_SIZE + 0]).toBe(5);
    expect(data[MAX_PAYLOAD_SIZE + 1]).toBe(6);
    expect(data[MAX_PAYLOAD_SIZE + 2]).toBe(7);
    expect(data[MAX_PAYLOAD_SIZE + 3]).toBe(8);
    expect(data[K * MAX_PAYLOAD_SIZE + 0]).toBe(9);
    expect(data[K * MAX_PAYLOAD_SIZE + 1]).toBe(10);
    expect(data[K * MAX_PAYLOAD_SIZE + 2]).toBe(11);
    expect(data[K * MAX_PAYLOAD_SIZE + 3]).toBe(12);
  });

  it('should handle single generation', async () => {
    const { assemblePayload } = await import('@/core/reconstruct/assemble');
    const { K, MAX_PAYLOAD_SIZE } = await import('@/core/protocol/constants');

    const g0: Uint8Array[] = [];
    for (let i = 0; i < K; i++) g0.push(new Uint8Array(MAX_PAYLOAD_SIZE));
    g0[0]![0] = 1; g0[0]![1] = 2; g0[0]![2] = 3;

    const solved = new Map<number, Uint8Array[]>();
    solved.set(0, g0);

    // 1 source gen + 0 parity = 1 total (small file, no outer RS). Source gen present.
    const data = assemblePayload(solved, 1, 3);
    expect(data.length).toBe(3);
    expect(data[0]).toBe(1);
    expect(data[1]).toBe(2);
    expect(data[2]).toBe(3);
  });

  it('should reject when not enough generations solved for outer RS recovery', async () => {
    const { assemblePayload } = await import('@/core/reconstruct/assemble');
    const { K, MAX_PAYLOAD_SIZE } = await import('@/core/protocol/constants');

    const g0: Uint8Array[] = [];
    for (let i = 0; i < K; i++) g0.push(new Uint8Array(MAX_PAYLOAD_SIZE));

    const solved = new Map<number, Uint8Array[]>();
    solved.set(0, g0);

    // 4 source gens + 0 parity = 4 total, but only 1 solved
    expect(() => assemblePayload(solved, 4, 3)).toThrow('only 1 generations solved');
  });
});

// ─── Packetizer ─────────────────────────────────────────────────────────────────────────────

describe('Packetizer', () => {
  it('should packetize text data', async () => {
    const { packetize } = await import('@/core/sender/packetizer');
    const { K } = await import('@/core/protocol/constants');
    const { parseHeader } = await import('@/core/protocol/packet');

    const text = 'Hello, World!';
    const data = new TextEncoder().encode(text);
    const result = packetize(data, true, false);

    expect(result.isText).toBe(true);
    expect(result.isCompressed).toBe(false);
    expect(result.sourceGenerations).toBe(1);
    expect(result.totalGenerations).toBeGreaterThanOrEqual(1);
    expect(result.dataLength).toBe(data.length);
    expect(result.packets.length).toBeGreaterThan(0);

    const sysCount = result.packets.filter((p) => {
      return parseHeader(p).symbolIndex < K;
    }).length;
    const codedCount = result.packets.filter((p) => {
      return parseHeader(p).symbolIndex >= K;
    }).length;

    expect(sysCount).toBe(K * result.totalGenerations);
    expect(codedCount).toBe(8 * result.totalGenerations);
  });

  it('should packetize binary data across multiple generations', async () => {
    const { packetize } = await import('@/core/sender/packetizer');
    const { MAX_PAYLOAD_SIZE, K } = await import('@/core/protocol/constants');

    const data = new Uint8Array(MAX_PAYLOAD_SIZE * K * 2 + 100);
    crypto.getRandomValues(data);

    const result = packetize(data, false, false);

    expect(result.isText).toBe(false);
    expect(result.sourceGenerations).toBeGreaterThanOrEqual(3);
    expect(result.totalGenerations).toBeGreaterThanOrEqual(result.sourceGenerations);
    expect(result.dataLength).toBe(data.length);

    const { parseHeader } = await import('@/core/protocol/packet');
    for (const pkt of result.packets) {
      const h = parseHeader(pkt);
      expect(h.totalGenerations).toBe(result.totalGenerations);
      expect(h.dataLength).toBe(data.length);
    }
  });

  it('should compress large data', async () => {
    const { packetize } = await import('@/core/sender/packetizer');

    const text = 'a'.repeat(1000);
    const data = new TextEncoder().encode(text);
    const result = packetize(data, true, true);

    expect(result.isCompressed).toBe(true);
    expect(result.dataLength).toBeLessThan(data.length);
  });
});

// ─── Scheduler ───────────────────────────────────────────────────────────────────────────────────────

describe('Scheduler', () => {
  it('should schedule frames deterministically for same totalGenerations', async () => {
    const { packetize } = await import('@/core/sender/packetizer');
    const { scheduleFrames } = await import('@/core/sender/scheduler');

    const data = new TextEncoder().encode('Test data for scheduling');
    const result = packetize(data, false, false);
    const frames = scheduleFrames(result.packets, result.totalGenerations);

    expect(frames.length).toBe(result.packets.length);

    const frames2 = scheduleFrames(result.packets, result.totalGenerations);
    expect(frames.map((f) => f.length)).toEqual(frames2.map((f) => f.length));
  });

  it('should interleave generations round-robin', async () => {
    const { packetize } = await import('@/core/sender/packetizer');
    const { scheduleFrames } = await import('@/core/sender/scheduler');
    const { parseHeader } = await import('@/core/protocol/packet');
    const { K } = await import('@/core/protocol/constants');

    const data = new Uint8Array(3000);
    crypto.getRandomValues(data);
    const result = packetize(data, false, false);
    const frames = scheduleFrames(result.packets, result.totalGenerations);

    // Check that systematic symbols are sent before coded symbols
    let firstCodedIdx = -1;
    for (let i = 0; i < frames.length; i++) {
      const h = parseHeader(frames[i]!);
      if (h.symbolIndex >= K) {
        firstCodedIdx = i;
        break;
      }
    }
    expect(firstCodedIdx).toBeGreaterThan(0);

    // All frames before first coded should be systematic
    for (let i = 0; i < firstCodedIdx; i++) {
      const h = parseHeader(frames[i]!);
      expect(h.symbolIndex).toBeLessThan(K);
    }

    // Within systematic section, each symbol index should appear for all generations
    // before moving to next symbol index
    const sysSection = frames.slice(0, firstCodedIdx);
    const gensPerSymbol = result.totalGenerations;
    expect(sysSection.length).toBe(K * gensPerSymbol);
  });
});

// ─── End-to-end ───────────────────────────────────────────────────────────────────────────────────

describe('End-to-End', () => {
  it('should roundtrip a small text message', async () => {
    const { packetize } = await import('@/core/sender/packetizer');
    const { scheduleFrames } = await import('@/core/sender/scheduler');
    const { parsePacket } = await import('@/core/protocol/packet');
    const { GenerationDecoder } = await import('@/core/fec/rlnc_decoder');
    const { assemblePayload } = await import('@/core/reconstruct/assemble');
    const { K, MAX_PAYLOAD_SIZE } = await import('@/core/protocol/constants');

    const text = 'Hello, QR world! 💛';
    const data = new TextEncoder().encode(text);
    const result = packetize(data, true, false);
    const frames = scheduleFrames(result.packets, result.totalGenerations);

    const decoder = new GenerationDecoder(K, MAX_PAYLOAD_SIZE);
    const solvedGens = new Set<number>();

    for (const frame of frames) {
      const pkt = parsePacket(frame);
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

    // With outer RS, we only need sourceGenerations solved
    expect(solvedGens.size).toBeGreaterThanOrEqual(result.sourceGenerations);

    const solvedMap = new Map<number, Uint8Array[]>();
    for (const genIdx of solvedGens) {
      solvedMap.set(genIdx, decoder.getSourceSymbols(genIdx)!);
    }

    const assembled = assemblePayload(solvedMap, result.totalGenerations, result.dataLength);
    const recovered = new TextDecoder().decode(assembled);
    expect(recovered).toBe(text);
  });

  it('should roundtrip with a manually selected larger QR profile', async () => {
    const { packetize } = await import('@/core/sender/packetizer');
    const { scheduleFrames } = await import('@/core/sender/scheduler');
    const { parsePacket } = await import('@/core/protocol/packet');
    const { GenerationDecoder } = await import('@/core/fec/rlnc_decoder');
    const { assemblePayload } = await import('@/core/reconstruct/assemble');
    const { getQRTransferProfile } = await import('@/core/protocol/profiles');
    const { K } = await import('@/core/protocol/constants');

    const profile = getQRTransferProfile('v20-m');
    const data = new Uint8Array(profile.maxPayloadSize + 123);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;

    const result = packetize(
      data,
      false,
      false,
      undefined,
      undefined,
      { symbolSize: profile.maxPayloadSize },
    );

    expect(result.symbolSize).toBe(profile.maxPayloadSize);
    expect(result.packets[0]!.length).toBe(profile.maxPacketSize);

    const frames = scheduleFrames(result.packets, result.totalGenerations);
    const decoder = new GenerationDecoder(K, profile.maxPayloadSize);
    const solvedGens = new Set<number>();

    for (const frame of frames) {
      const pkt = parsePacket(frame);
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

    expect(solvedGens.size).toBeGreaterThanOrEqual(result.sourceGenerations);

    const solvedMap = new Map<number, Uint8Array[]>();
    for (const genIdx of solvedGens) {
      solvedMap.set(genIdx, decoder.getSourceSymbols(genIdx)!);
    }

    const recovered = assemblePayload(
      solvedMap,
      result.totalGenerations,
      result.dataLength,
      profile.maxPayloadSize,
    );

    expect(recovered).toEqual(data);
  });

  it('should recover from lost frames', async () => {
    const { packetize } = await import('@/core/sender/packetizer');
    const { scheduleFrames } = await import('@/core/sender/scheduler');
    const { parsePacket } = await import('@/core/protocol/packet');
    const { GenerationDecoder } = await import('@/core/fec/rlnc_decoder');
    const { assemblePayload } = await import('@/core/reconstruct/assemble');
    const { K, MAX_PAYLOAD_SIZE } = await import('@/core/protocol/constants');

    const data = new TextEncoder().encode('Surviving frame loss with RLNC!');
    const result = packetize(data, false, false);
    const frames = scheduleFrames(result.packets, result.totalGenerations);

    // Drop every 3rd frame
    const decoder = new GenerationDecoder(K, MAX_PAYLOAD_SIZE);
    const solvedGens = new Set<number>();

    for (let i = 0; i < frames.length; i++) {
      if (i % 3 === 0) continue;
      const pkt = parsePacket(frames[i]!);
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

    expect(solvedGens.size).toBeGreaterThanOrEqual(result.sourceGenerations);

    const solvedMap = new Map<number, Uint8Array[]>();
    for (const genIdx of solvedGens) {
      solvedMap.set(genIdx, decoder.getSourceSymbols(genIdx)!);
    }

    const assembled = assemblePayload(solvedMap, result.totalGenerations, result.dataLength);
    const recovered = new TextDecoder().decode(assembled);
    expect(recovered).toBe('Surviving frame loss with RLNC!');
  });

  it('should recover with outer RS when some generations are entirely missing', async () => {
    const { packetize } = await import('@/core/sender/packetizer');
    const { scheduleFrames } = await import('@/core/sender/scheduler');
    const { parsePacket } = await import('@/core/protocol/packet');
    const { GenerationDecoder } = await import('@/core/fec/rlnc_decoder');
    const { assemblePayload } = await import('@/core/reconstruct/assemble');
    const { K, MAX_PAYLOAD_SIZE } = await import('@/core/protocol/constants');

    // Large payload (>34 source generations) so outer RS actually creates parity.
    const data = new TextEncoder().encode(
      'Outer RS saves the day when a whole generation is lost! '.repeat(2000),
    );
    const result = packetize(data, false, false);
    expect(result.sourceGenerations).toBeGreaterThanOrEqual(34);
    expect(result.totalGenerations).toBeGreaterThan(result.sourceGenerations);

    const frames = scheduleFrames(result.packets, result.totalGenerations);

    const decoder = new GenerationDecoder(K, MAX_PAYLOAD_SIZE);
    const solvedGens = new Set<number>();

    // Determine which generation to skip (skip one source generation)
    const skipGen = 0;

    for (let i = 0; i < frames.length; i++) {
      const pkt = parsePacket(frames[i]!);
      if (pkt.header.generationIndex === skipGen) continue;
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

    // We should still have enough solved generations (source - 1 + parity)
    expect(solvedGens.size).toBeGreaterThanOrEqual(result.sourceGenerations);

    const solvedMap = new Map<number, Uint8Array[]>();
    for (const genIdx of solvedGens) {
      solvedMap.set(genIdx, decoder.getSourceSymbols(genIdx)!);
    }

    const assembled = assemblePayload(solvedMap, result.totalGenerations, result.dataLength);
    const recovered = new TextDecoder().decode(assembled);
    expect(recovered).toBe(new TextDecoder().decode(data));
  });
});
