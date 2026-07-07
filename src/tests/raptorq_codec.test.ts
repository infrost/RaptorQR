import { describe, expect, it } from 'vitest';
import { CRC32C_SIZE, HEADER_SIZE, RAPTORQ_SYMBOL_INDEX } from '@/core/protocol/constants';
import { createPacket, packetCodec, parsePacket } from '@/core/protocol/packet';
import {
  RaptorQWasmDecoder,
  encodeRaptorQPackets,
  ensureRaptorQWasm,
  raptorQUnavailableMessage,
} from '@/core/fec/raptorq_wasm';
import { packetizeRaptorQ } from '@/core/sender/raptorq_packetizer';

describe('RaptorQ codec sentinel', () => {
  it('should classify existing RLNC packets and RaptorQ sentinel packets', () => {
    const common = {
      generationIndex: 0,
      totalGenerations: 1,
      isText: true,
      isLastGeneration: true,
      compressed: false,
      dataLength: 3,
    };

    const rlnc = parsePacket(createPacket({ ...common, symbolIndex: 0 }, new Uint8Array([1, 2, 3])));
    const raptorq = parsePacket(
      createPacket({ ...common, symbolIndex: RAPTORQ_SYMBOL_INDEX }, new Uint8Array([0, 0, 0, 0, 1])),
    );

    expect(packetCodec(rlnc.header)).toBe('js-rlnc');
    expect(packetCodec(raptorq.header)).toBe('wasm-raptorq');
  });

  it('should use the existing header space for codec detection', () => {
    const common = {
      generationIndex: 0,
      totalGenerations: 1,
      isText: true,
      isLastGeneration: true,
      compressed: false,
      dataLength: 4,
    };
    const payload = new Uint8Array([0, 0, 0, 1]);
    const rlncPacket = createPacket({ ...common, symbolIndex: 0 }, payload);
    const raptorqPacket = createPacket({ ...common, symbolIndex: RAPTORQ_SYMBOL_INDEX }, payload);

    expect(raptorqPacket.length).toBe(rlncPacket.length);
    expect(raptorqPacket.length).toBe(HEADER_SIZE + payload.length + CRC32C_SIZE);
  });
});

describe('RaptorQ WASM loader', () => {
  it('should expose a controlled unavailable error when stub artifacts are installed', async () => {
    try {
      await ensureRaptorQWasm();
    } catch (err: any) {
      expect(err.message).toContain(raptorQUnavailableMessage());
    }
  });

  it('should keep WASM sender selection controlled when artifacts are missing', async () => {
    try {
      const result = await packetizeRaptorQ(
        new TextEncoder().encode('missing wasm guard'),
        true,
        false,
        undefined,
        undefined,
        { maxTransportPayloadSize: 128, repairPercent: 20 },
      );
      expect(result.packets.length).toBeGreaterThan(0);
    } catch (err: any) {
      expect(err.message).toContain(raptorQUnavailableMessage());
    }
  });

  it.runIf(process.env.QR_STREAM_TEST_RAPTORQ_WASM === '1')(
    'should round-trip through generated WASM artifacts',
    async () => {
      const original = new TextEncoder().encode('raptorq wasm roundtrip');
      const packets = await encodeRaptorQPackets(original, 128, 20);
      const decoder = await RaptorQWasmDecoder.create(original.length, 128);

      let decoded: Uint8Array | null = null;
      for (const packet of packets) {
        decoded = decoder.push(packet);
        if (decoded) break;
      }

      expect(decoded).not.toBeNull();
      expect(decoded!.slice(0, original.length)).toEqual(original);
    },
  );
});
