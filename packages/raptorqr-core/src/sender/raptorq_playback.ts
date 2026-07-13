/**
 * RaptorQ playback strategy and packet-index scheduling.
 *
 * The scheduler only moves canonical packet indexes. Packet bytes stay in the
 * packetizer's canonical array and are never copied or modified here.
 */

export type RaptorQPlaybackStrategy = 'fast-start' | 'balanced' | 'even-spread';

export const DEFAULT_RAPTORQ_PLAYBACK_STRATEGY: RaptorQPlaybackStrategy = 'balanced';

export const RAPTORQ_PLAYBACK_STRATEGIES: readonly RaptorQPlaybackStrategy[] = [
  'fast-start',
  'balanced',
  'even-spread',
];

export interface RaptorQPlaybackOrders {
  initialOrder: number[];
  loopOrder: number[];
}

export type RaptorQPlaybackPhase = 'initial' | 'loop';

/** Normalize persisted or untrusted strategy values to the stable default. */
export function normalizeRaptorQPlaybackStrategy(value: unknown): RaptorQPlaybackStrategy {
  if (value === 'fast-start' || value === 'balanced' || value === 'even-spread') {
    return value;
  }
  return DEFAULT_RAPTORQ_PLAYBACK_STRATEGY;
}

export function formatRaptorQPlaybackStrategy(value: RaptorQPlaybackStrategy): string {
  switch (value) {
    case 'fast-start':
      return 'Fast start';
    case 'even-spread':
      return 'Even spread';
    case 'balanced':
    default:
      return 'Balanced';
  }
}

/**
 * Build a source-first order from the packetizer's classification metadata.
 */
export function createSourceFirstPacketIndexOrder(
  sourcePacketIndices: readonly number[],
  repairPacketIndices: readonly number[],
): number[] {
  return validateAndCopyPacketIndexes(sourcePacketIndices, repairPacketIndices);
}

/**
 * Build an even source/repair order using cumulative proportions.
 *
 * After each source packet, R is accumulated. Once the accumulated value
 * reaches S, a repair packet is emitted and S is subtracted. This gives
 * source gaps that differ by at most one packet while preserving every input
 * index exactly once.
 */
export function createEvenlyInterleavedPacketIndexOrder(
  sourcePacketIndices: readonly number[],
  repairPacketIndices: readonly number[],
): number[] {
  const source = [...sourcePacketIndices];
  const repair = [...repairPacketIndices];
  validatePacketIndexes(source, repair);

  if (source.length === 0) return repair;
  if (repair.length === 0) return source;

  const order: number[] = [];
  let sourceIndex = 0;
  let repairIndex = 0;
  let accumulatedRepair = 0;

  while (sourceIndex < source.length) {
    order.push(source[sourceIndex++]!);
    accumulatedRepair += repair.length;

    while (repairIndex < repair.length && accumulatedRepair >= source.length) {
      order.push(repair[repairIndex++]!);
      accumulatedRepair -= source.length;
    }
  }

  // The normal RaptorQ repair range is 0..100%, but keep this total and
  // deterministic for callers using synthetic metadata too.
  while (repairIndex < repair.length) {
    order.push(repair[repairIndex++]!);
  }

  return order;
}

/**
 * Create the initial and loop orders for a Live/GIF transfer.
 *
 * GIFs always use loopOrder. Live playback starts with initialOrder and may
 * switch to loopOrder after its first complete display cycle.
 */
export function createRaptorQPlaybackOrders(
  sourcePacketIndices: readonly number[],
  repairPacketIndices: readonly number[],
  strategy: RaptorQPlaybackStrategy = DEFAULT_RAPTORQ_PLAYBACK_STRATEGY,
): RaptorQPlaybackOrders {
  const normalized = normalizeRaptorQPlaybackStrategy(strategy);
  const initialSourceFirst = createSourceFirstPacketIndexOrder(
    sourcePacketIndices,
    repairPacketIndices,
  );
  const evenSpread = createEvenlyInterleavedPacketIndexOrder(
    sourcePacketIndices,
    repairPacketIndices,
  );

  const initialOrder = normalized === 'even-spread' ? evenSpread : initialSourceFirst;
  const loopOrder = normalized === 'fast-start' ? initialSourceFirst : evenSpread;

  return {
    initialOrder,
    loopOrder,
  };
}

/**
 * Return the canonical packets needed by a render window in display order.
 * An initial window that crosses the first-cycle boundary uses loopOrder for
 * its wrapped portion, so Balanced can pre-render its first repair-spread loop.
 */
export function getRaptorQPlaybackWindowPacketIndices(
  orders: Pick<RaptorQPlaybackOrders, 'initialOrder' | 'loopOrder'>,
  activePhase: RaptorQPlaybackPhase,
  parallelCount: number,
  startFrameIndex: number,
  windowFrameCount: number,
): number[] {
  if (!Number.isInteger(parallelCount) || parallelCount <= 0) {
    throw new RangeError(`Invalid parallel QR count: ${parallelCount}`);
  }
  if (!Number.isInteger(startFrameIndex) || startFrameIndex < 0) {
    throw new RangeError(`Invalid playback start frame: ${startFrameIndex}`);
  }
  if (!Number.isInteger(windowFrameCount) || windowFrameCount < 0) {
    throw new RangeError(`Invalid playback window frame count: ${windowFrameCount}`);
  }
  if (orders.initialOrder.length !== orders.loopOrder.length) {
    throw new RangeError('RaptorQ initial and loop orders must have the same length.');
  }
  if (orders.initialOrder.length === 0 || windowFrameCount === 0) return [];

  const displayFrameCount = Math.ceil(orders.initialOrder.length / parallelCount);
  const packetIndices: number[] = [];
  const seen = new Set<number>();

  for (let offset = 0; offset < windowFrameCount; offset++) {
    const absoluteFrameIndex = startFrameIndex + offset;
    const useLoopOrder = activePhase === 'loop' || absoluteFrameIndex >= displayFrameCount;
    const order = useLoopOrder ? orders.loopOrder : orders.initialOrder;
    const normalizedFrameIndex = absoluteFrameIndex % displayFrameCount;
    const firstPacketPosition = normalizedFrameIndex * parallelCount;

    for (let tileIndex = 0; tileIndex < parallelCount; tileIndex++) {
      const packetIndex = order[firstPacketPosition + tileIndex];
      if (packetIndex === undefined || seen.has(packetIndex)) continue;
      seen.add(packetIndex);
      packetIndices.push(packetIndex);
    }
  }

  return packetIndices;
}

function validateAndCopyPacketIndexes(
  sourcePacketIndices: readonly number[],
  repairPacketIndices: readonly number[],
): number[] {
  validatePacketIndexes(sourcePacketIndices, repairPacketIndices);
  return [...sourcePacketIndices, ...repairPacketIndices];
}

function validatePacketIndexes(
  sourcePacketIndices: readonly number[],
  repairPacketIndices: readonly number[],
): void {
  const seen = new Set<number>();
  for (const packetIndex of [...sourcePacketIndices, ...repairPacketIndices]) {
    if (!Number.isInteger(packetIndex) || packetIndex < 0) {
      throw new RangeError(`Invalid RaptorQ packet index: ${packetIndex}`);
    }
    if (seen.has(packetIndex)) {
      throw new RangeError(`Duplicate RaptorQ packet index: ${packetIndex}`);
    }
    seen.add(packetIndex);
  }
}
