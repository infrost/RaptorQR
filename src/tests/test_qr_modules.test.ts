import { generateQRMatrix, getMaxByteCapacity, getMinVersion } from '../core/qr/qr_encode.ts';
import { rasterizeQR, rasterizeToGrayscale, getRasterDimensions } from '../core/qr/frame_raster.ts';
import { decodeQRFromBuffer } from '../core/qr/qr_decode.ts';
import { createQRGif, estimateGifSize } from '../core/gif/gif_render.ts';
import { describe, it, expect } from 'vitest';

describe('QR encode', () => {
  it('should compute capacities for profile versions', () => {
    expect(getMaxByteCapacity(31, 'Q')).toBeGreaterThan(1000);
    expect(getMaxByteCapacity(35, 'M')).toBeGreaterThan(1000);
    expect(getMaxByteCapacity(40, 'M')).toBeGreaterThan(2000);
  });

  it('should throw on data too large', () => {
    expect(() => generateQRMatrix(new Uint8Array(100), 1, 'L')).toThrow();
  });

  it('should generate a matrix', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // 'Hello'
    const matrix = generateQRMatrix(data, 1, 'L');
    expect(matrix.length).toBe(21);
    expect(matrix[0]!.length).toBe(21);
  });
});

describe('Frame raster', () => {
  it('should produce correct dimensions', () => {
    const matrix = generateQRMatrix(new Uint8Array([1,2,3]), 1, 'L');
    const dims = getRasterDimensions(matrix.length, 3);
    expect(dims.width).toBe((21 + 8) * 3); // 87
    expect(dims.height).toBe(87);
  });

  it('should have quiet zone white', () => {
    const matrix = generateQRMatrix(new Uint8Array([1,2,3]), 1, 'L');
    const rgba = rasterizeQR(matrix, 3);
    expect(rgba.data[0]).toBe(255); // corner pixel should be white
    expect(rgba.data[1]).toBe(255);
    expect(rgba.data[2]).toBe(255);
  });

  it('should round-trip through decode', () => {
    const original = 'Hello QR';
    const data = new TextEncoder().encode(original);
    const matrix = generateQRMatrix(data, 1, 'L');
    const gray = rasterizeToGrayscale(matrix, 3);
    const decoded = decodeQRFromBuffer(gray.data, gray.width, gray.height);
    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(1);
    expect(new TextDecoder().decode(decoded!.bytes)).toBe(original);
  });
});

describe('GIF render', () => {
  it('should produce valid GIF', () => {
    const matrix = generateQRMatrix(new Uint8Array([1,2,3]), 1, 'L');
    const rgba = rasterizeQR(matrix, 3);
    const gif = createQRGif([rgba.data], 100, rgba.width, rgba.height);
    expect(gif[0]).toBe(0x47); // G
    expect(gif[1]).toBe(0x49); // I
    expect(gif[2]).toBe(0x46); // F
    expect(gif.length).toBeGreaterThan(20);
  });

  it('estimateGifSize returns reasonable value', () => {
    const size = estimateGifSize(100000, 'V31-Q');
    expect(size).toBeGreaterThan(0);
  });
});
