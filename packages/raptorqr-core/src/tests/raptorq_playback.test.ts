import { describe, expect, it } from 'vitest';
import {
  createEvenlyInterleavedPacketIndexOrder,
  createRaptorQPlaybackOrders,
  formatRaptorQPlaybackStrategy,
  getRaptorQPlaybackWindowPacketIndices,
  normalizeRaptorQPlaybackStrategy,
} from '@raptorqr/core/sender/raptorq_playback';
import {
  classifyRaptorQPackets,
  packetizeRaptorQ,
} from '@raptorqr/core/sender/raptorq_packetizer';
import { packetCodec, parsePacket } from '@raptorqr/core/protocol/packet';
import { RaptorQWasmDecoder } from '@raptorqr/core/fec/raptorq_wasm';

function packetIds(
  ids: Array<{ sourceBlock: number; esi: number }>,
): Uint8Array[] {
  return ids.map(({ sourceBlock, esi }) => new Uint8Array([
    sourceBlock,
    (esi >>> 16) & 0xff,
    (esi >>> 8) & 0xff,
    esi & 0xff,
  ]));
}

function indexRange(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function assertCompleteOrder(order: number[], sourceCount: number, repairCount: number): void {
  expect(order).toHaveLength(sourceCount + repairCount);
  expect(new Set(order).size).toBe(order.length);
  expect(order).toEqual(expect.arrayContaining(indexRange(0, sourceCount + repairCount)));
}

describe('RaptorQ playback strategy', () => {
  it('normalizes and formats the three public strategies', () => {
    expect(normalizeRaptorQPlaybackStrategy('fast-start')).toBe('fast-start');
    expect(normalizeRaptorQPlaybackStrategy('balanced')).toBe('balanced');
    expect(normalizeRaptorQPlaybackStrategy('even-spread')).toBe('even-spread');
    expect(normalizeRaptorQPlaybackStrategy('unknown')).toBe('balanced');
    expect(formatRaptorQPlaybackStrategy('fast-start')).toBe('Fast start');
    expect(formatRaptorQPlaybackStrategy('balanced')).toBe('Balanced');
    expect(formatRaptorQPlaybackStrategy('even-spread')).toBe('Even spread');
  });

  it('creates exact 1000/100 cumulative-proportion spacing', () => {
    const source = indexRange(0, 1000);
    const repair = indexRange(1000, 100);
    const order = createEvenlyInterleavedPacketIndexOrder(source, repair);

    assertCompleteOrder(order, 1000, 100);
    expect(order[0]).toBe(0);

    const sourceCountsBetweenRepairs: number[] = [];
    let sourceCount = 0;
    for (const packetIndex of order) {
      if (packetIndex < 1000) {
        sourceCount++;
      } else {
        sourceCountsBetweenRepairs.push(sourceCount);
        sourceCount = 0;
      }
    }
    expect(sourceCountsBetweenRepairs).toEqual(new Array(100).fill(10));
    expect(sourceCount).toBe(0);
  });

  it('keeps non-divisible source gaps within one packet', () => {
    const order = createEvenlyInterleavedPacketIndexOrder(indexRange(0, 7), indexRange(7, 3));
    assertCompleteOrder(order, 7, 3);

    const gaps: number[] = [];
    let sourceCount = 0;
    for (const packetIndex of order) {
      if (packetIndex < 7) {
        sourceCount++;
      } else {
        gaps.push(sourceCount);
        sourceCount = 0;
      }
    }
    expect(gaps).toEqual([3, 2, 2]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it.each([
    [0, 0],
    [10, 10],
    [20, 20],
    [100, 100],
  ])('handles %s%% repair without losing packet indexes', (repairPercent, expectedRepairCount) => {
    const source = indexRange(0, 100);
    const repair = indexRange(100, expectedRepairCount);
    const order = createEvenlyInterleavedPacketIndexOrder(source, repair);
    assertCompleteOrder(order, source.length, repair.length);
    expect(order[0]).toBe(0);
  });

  it('maps strategy semantics to initial and loop orders', () => {
    const source = [0, 2, 4, 6];
    const repair = [1, 3];
    const sourceFirst = [0, 2, 4, 6, 1, 3];
    const even = createEvenlyInterleavedPacketIndexOrder(source, repair);

    const fast = createRaptorQPlaybackOrders(source, repair, 'fast-start');
    expect(fast.initialOrder).toEqual(sourceFirst);
    expect(fast.loopOrder).toEqual(sourceFirst);

    const balanced = createRaptorQPlaybackOrders(source, repair, 'balanced');
    expect(balanced.initialOrder).toEqual(sourceFirst);
    expect(balanced.loopOrder).toEqual(even);

    const spread = createRaptorQPlaybackOrders(source, repair, 'even-spread');
    expect(spread.initialOrder).toEqual(even);
    expect(spread.loopOrder).toEqual(even);
  });

  it('prefetches loop-order packets when an initial window crosses the cycle boundary', () => {
    const orders = createRaptorQPlaybackOrders(
      indexRange(0, 8),
      indexRange(8, 4),
      'balanced',
    );

    const initialTail = orders.initialOrder.slice(8, 12);
    const loopHead = orders.loopOrder.slice(0, 8);
    const window = getRaptorQPlaybackWindowPacketIndices(
      orders,
      'initial',
      4,
      2,
      3,
    );

    expect(window).toEqual([...new Set([...initialTail, ...loopHead])]);
    expect(window).not.toEqual([...new Set([
      ...initialTail,
      ...orders.initialOrder.slice(0, 8),
    ])]);
  });

  it('keeps using loop order when a loop window wraps', () => {
    const orders = createRaptorQPlaybackOrders(
      indexRange(0, 8),
      indexRange(8, 4),
      'balanced',
    );
    const window = getRaptorQPlaybackWindowPacketIndices(orders, 'loop', 4, 2, 3);

    expect(window).toEqual([
      ...orders.loopOrder.slice(8, 12),
      ...orders.loopOrder.slice(0, 8),
    ]);
  });
});

describe('RaptorQ packet classification', () => {
  it.each([
    [0, 0],
    [10, 1],
    [20, 2],
    [100, 10],
  ])('exposes ceil-based source/repair metadata for %s%% repair', async (repairPercent, repairCount) => {
    const data = new Uint8Array(1_240);
    const result = await packetizeRaptorQ(
      data,
      false,
      false,
      undefined,
      undefined,
      { maxTransportPayloadSize: 128, repairPercent },
    );

    expect(result.sourcePacketIndices).toHaveLength(10);
    expect(result.repairPacketIndices).toHaveLength(repairCount);
    expect([
      ...result.sourcePacketIndices,
      ...result.repairPacketIndices,
    ].sort((a, b) => a - b)).toEqual(indexRange(0, result.packets.length));
  });

  it('classifies interspersed single-block source and repair packets by ESI', () => {
    const packets = packetIds([
      { sourceBlock: 0, esi: 0 },
      { sourceBlock: 0, esi: 10 },
      { sourceBlock: 0, esi: 1 },
      { sourceBlock: 0, esi: 11 },
    ]);
    const result = classifyRaptorQPackets(packets, 100, 14);

    expect(result.sourcePacketIndices).toEqual([0, 2]);
    expect(result.repairPacketIndices).toEqual([1, 3]);
  });

  it('classifies multiple source blocks using each block K and its ESI', () => {
    const totalSourceSymbols = 56_405;
    const packets = packetIds([
      { sourceBlock: 0, esi: 28_202 },
      { sourceBlock: 0, esi: 28_203 },
      { sourceBlock: 1, esi: 28_201 },
      { sourceBlock: 1, esi: 28_202 },
    ]);
    const result = classifyRaptorQPackets(
      packets,
      totalSourceSymbols * 10,
      14,
    );

    expect(result.sourcePacketIndices).toEqual([0, 2]);
    expect(result.repairPacketIndices).toEqual([1, 3]);
  });
});

describe('RaptorQ playback roundtrip', () => {
  it.each(['fast-start', 'balanced', 'even-spread'] as const)(
    'recovers after deterministic loss with %s order',
    async (strategy) => {
      const data = new Uint8Array(30_000);
      for (let index = 0; index < data.length; index++) data[index] = (index * 17 + 31) & 0xff;

      const packetized = await packetizeRaptorQ(
        data,
        false,
        false,
        undefined,
        undefined,
        { maxTransportPayloadSize: 128, repairPercent: 20 },
      );
      const { loopOrder } = createRaptorQPlaybackOrders(
        packetized.sourcePacketIndices,
        packetized.repairPacketIndices,
        strategy,
      );
      const decoder = await RaptorQWasmDecoder.create(packetized.dataLength, packetized.symbolSize);

      let decoded: Uint8Array | null = null;
      for (let position = 0; position < loopOrder.length; position++) {
        if (position % 11 === 0) continue;
        const packet = parsePacket(packetized.packets[loopOrder[position]!]!);
        expect(packetCodec(packet.header)).toBe('wasm-raptorq');
        decoded = decoder.push(packet.payload);
        if (decoded) break;
      }

      expect(decoded).not.toBeNull();
      expect(decoded!.slice(0, data.length)).toEqual(data);
    },
  );
});
