import { describe, expect, it } from 'vitest';
import {
  stripedFrameCount,
  stripedOrderedPacketIndex,
} from '@raptorqr/core/sender/parallel_striping';

describe('ordered parallel QR striping', () => {
  it.each([1, 2, 4, 6, 8] as const)('keeps %s-way frames mixed and complete', (parallelCount) => {
    const packetOrder = [0, 6, 1, 7, 2, 8, 3, 9, 4, 10, 5, 11];
    const frameCount = stripedFrameCount(packetOrder.length, parallelCount);
    const displayed: number[] = [];

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      for (let tileIndex = 0; tileIndex < parallelCount; tileIndex++) {
        const packetIndex = stripedOrderedPacketIndex(
          packetOrder,
          parallelCount,
          frameIndex,
          tileIndex,
        );
        if (packetIndex !== null) displayed.push(packetIndex);
      }
    }

    expect(displayed).toEqual(packetOrder);
    expect(new Set(displayed).size).toBe(packetOrder.length);
  });

  it('leaves only tail tile slots empty', () => {
    const packetOrder = [0, 1, 2, 3, 4];
    expect(stripedFrameCount(packetOrder.length, 4)).toBe(2);
    expect(stripedOrderedPacketIndex(packetOrder, 4, 1, 0)).toBe(4);
    expect(stripedOrderedPacketIndex(packetOrder, 4, 1, 1)).toBeNull();
    expect(stripedOrderedPacketIndex(packetOrder, 4, 1, 3)).toBeNull();
  });
});
