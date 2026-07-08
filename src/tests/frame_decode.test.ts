/**
 * Frame decode test: verify QR encode -> decode roundtrip at the packet level.
 */
import { describe, it, expect } from 'vitest';
import { packetize } from '@/core/sender/packetizer';
import { scheduleFrames } from '@/core/sender/scheduler';
import { renderQRCodeImageData } from '@/core/qr/qr_encoder_browser';
import { decodeQRFromCanvas } from '@/core/qr/qr_decode';
import { parsePacket } from '@/core/protocol/packet';
import { QR_VERSION, ECC_LEVEL } from '@/core/protocol/constants';

describe('Frame Decode', () => {
  it('should decode every frame in a small transmission', async () => {
    const text = 'Frame decode roundtrip test!';
    const data = new TextEncoder().encode(text);
    const result = packetize(data, false, false);
    const frames = scheduleFrames(result.packets, result.totalGenerations);

    expect(frames.length).toBeGreaterThan(0);

    for (let i = 0; i < frames.length; i++) {
      const originalPacket = frames[i]!;

      const imageData = await renderQRCodeImageData(
        originalPacket,
        QR_VERSION,
        ECC_LEVEL,
        4,
        'fast-qr-wasm',
      );

      // Decode QR
      const decodedQR = await decodeQRFromCanvas(imageData);
      expect(decodedQR, `Frame ${i} failed to decode`).not.toBeNull();

      // Parse and verify header fields match
      const decoded = parsePacket(decodedQR!.bytes);
      const original = parsePacket(originalPacket);
      expect(decodedQR!.version).toBe(QR_VERSION);

      expect(decoded.header.generationIndex).toBe(original.header.generationIndex);
      expect(decoded.header.symbolIndex).toBe(original.header.symbolIndex);
      expect(decoded.header.isText).toBe(original.header.isText);
      expect(decoded.header.isLastGeneration).toBe(original.header.isLastGeneration);
      expect(decoded.header.compressed).toBe(original.header.compressed);
      expect(decoded.header.totalGenerations).toBe(original.header.totalGenerations);
      expect(decoded.header.dataLength).toBe(original.header.dataLength);
      expect(decoded.payload).toEqual(original.payload);
    }
  });
});
