export type ParallelQRCount = 1 | 2 | 4 | 6 | 8;

export function stripedFrameCount(packetCount: number, parallelCount: ParallelQRCount): number {
  if (!Number.isInteger(packetCount) || packetCount < 0) {
    throw new RangeError(`Invalid packet count: ${packetCount}`);
  }
  return Math.max(1, Math.ceil(packetCount / parallelCount));
}

export function stripedPacketIndex(
  packetCount: number,
  parallelCount: ParallelQRCount,
  frameIndex: number,
  tileIndex: number,
): number | null {
  if (!Number.isInteger(packetCount) || packetCount < 0) {
    throw new RangeError(`Invalid packet count: ${packetCount}`);
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= parallelCount) {
    throw new RangeError(`Invalid tile index: ${tileIndex}`);
  }

  const packetIndex = frameIndex * parallelCount + tileIndex;
  return packetIndex < packetCount ? packetIndex : null;
}
