import {
  getMaxByteCapacity,
  getMaxZXingWriterByteCapacity,
} from '../core/qr/qr_encode.ts';
import { rasterizeQR, rasterizeToGrayscale, getRasterDimensions } from '../core/qr/frame_raster.ts';
import { decodeQRFromBuffer, decodeQRCodesFromCanvas } from '../core/qr/qr_decode.ts';
import {
  DEFAULT_QR_ENCODER,
  QR_ENCODERS,
  encodeQRCodeMatrix,
  renderQRCodeImageData,
} from '../core/qr/qr_encoder_browser.ts';
import {
  QrRenderer,
  ensureFastQrWasm,
  getFastQrWasmMemory,
  isFastQrAvailable,
} from '../core/qr/fast_qr_wasm.ts';
import { renderQRCodeImageDataWithZXing } from '../core/qr/qr_write_wasm.ts';
import { createQRGif, estimateGifSize } from '../core/gif/gif_render.ts';
import { describe, it, expect } from 'vitest';

function matrixFromModuleBytes(modules: Uint8Array, sideModules: number): boolean[][] {
  const matrix: boolean[][] = [];

  for (let row = 0; row < sideModules; row++) {
    const outRow: boolean[] = [];
    const rowOffset = row * sideModules;

    for (let col = 0; col < sideModules; col++) {
      outRow.push(modules[rowOffset + col] === 1);
    }

    matrix.push(outRow);
  }

  return matrix;
}

function makeTestMatrix(size = 21): boolean[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) =>
      row === col || row === Math.floor(size / 2) || col === Math.floor(size / 2),
    ),
  );
}

describe('QR encode', () => {
  it('should compute capacities for profile versions', () => {
    expect(getMaxByteCapacity(31, 'Q')).toBeGreaterThan(1000);
    expect(getMaxByteCapacity(35, 'M')).toBeGreaterThan(1000);
    expect(getMaxByteCapacity(40, 'M')).toBeGreaterThan(2000);
  });

  it('should only apply ZXing writer binary ECI overhead to ZXing transfer profiles', async () => {
    const { createQRTransferProfile, getQRTransferProfile } = await import('@/core/protocol/profiles');

    expect(getMaxByteCapacity(20, 'L')).toBe(858);
    expect(getMaxZXingWriterByteCapacity(20, 'L')).toBe(856);
    expect(getQRTransferProfile('v20-l').maxPacketSize).toBe(858);
    expect(getQRTransferProfile('v20-l').maxPayloadSize).toBe(846);
    expect(createQRTransferProfile(20, 'L', 'fast-qr-wasm').maxPacketSize).toBe(858);
    expect(createQRTransferProfile(20, 'L', 'fast-qr-wasm').maxPayloadSize).toBe(846);
    expect(createQRTransferProfile(20, 'L', 'zxing-wasm').maxPacketSize).toBe(856);
    expect(createQRTransferProfile(20, 'L', 'zxing-wasm').maxPayloadSize).toBe(844);
  });

  it('should expose low-ECC transfer profiles with more payload room', async () => {
    const { getQRTransferProfile } = await import('@/core/protocol/profiles');

    const medium = getQRTransferProfile('v20-m');
    const low = getQRTransferProfile('v20-l');

    expect(low.maxPayloadSize).toBeGreaterThan(medium.maxPayloadSize);
    expect(low.version).toBe(medium.version);
  });

  it('should throw on data too large', async () => {
    await expect(
      encodeQRCodeMatrix(new Uint8Array(100), 1, 'L', 'fast-qr-wasm'),
    ).rejects.toThrow();
  });

  it('should generate a matrix', async () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // 'Hello'
    const matrix = await encodeQRCodeMatrix(data, 1, 'L', 'fast-qr-wasm');
    expect(matrix.length).toBe(21);
    expect(matrix[0]!.length).toBe(21);
  });

  it('should expose an encoder abstraction for ZXing WASM and fast_qr WASM', async () => {
    const payload = new TextEncoder().encode('encoder facade');

    expect(DEFAULT_QR_ENCODER).toBe('fast-qr-wasm');

    for (const encoder of QR_ENCODERS) {
      const matrix = await encodeQRCodeMatrix(payload, 10, 'L', encoder);
      const image = await renderQRCodeImageData(payload, 10, 'L', 3, encoder);
      const decoded = await decodeQRCodesFromCanvas(image, 1);

      expect(matrix.length).toBe(57);
      expect(matrix[0]!.length).toBe(57);
      expect(decoded).toHaveLength(1);
      expect(new TextDecoder().decode(decoded[0]!.bytes)).toBe('encoder facade');
    }
  });

  it('should initialize fast_qr WASM and expose its fixed render buffer', async () => {
    await ensureFastQrWasm();
    expect(isFastQrAvailable()).toBe(true);

    const renderer = new QrRenderer();
    const payload = new TextEncoder().encode('fast qr buffer');
    const sidePx = renderer.render_rgba(payload, 10, 0, 2);
    const byteLength = sidePx * sidePx * 4;
    const memory = getFastQrWasmMemory();
    const view = new Uint8ClampedArray(memory.buffer, renderer.rgba_ptr(), byteLength);

    expect(sidePx).toBe((10 * 4 + 17 + 8) * 2);
    expect(renderer.rgba_len()).toBeGreaterThanOrEqual(byteLength);
    expect(renderer.buf_ptr()).toBe(renderer.rgba_ptr());
    expect(renderer.buf_len()).toBe(renderer.rgba_len());
    expect(renderer.render(payload, 10, 0, 2)).toBe(sidePx);
    expect(view.byteLength).toBe(byteLength);
  });

  it('should expose fast_qr WASM matrix output through the browser encoder facade', async () => {
    await ensureFastQrWasm();

    const payload = new TextEncoder().encode('fast qr matrix');
    const renderer = new QrRenderer();
    const sideModules = renderer.render_matrix(payload, 10, 0);
    const byteLength = sideModules * sideModules;
    const memory = getFastQrWasmMemory();
    const modules = new Uint8Array(memory.buffer, renderer.matrix_ptr(), byteLength);
    const expectedMatrix = matrixFromModuleBytes(modules.slice(), sideModules);
    const matrix = await encodeQRCodeMatrix(payload, 10, 'L', 'fast-qr-wasm');

    expect(sideModules).toBe(10 * 4 + 17);
    expect(renderer.last_matrix_size()).toBe(sideModules);
    expect(renderer.matrix_len()).toBeGreaterThanOrEqual(byteLength);
    expect(modules.some((value) => value === 1)).toBe(true);
    expect(modules.every((value) => value === 0 || value === 1)).toBe(true);
    expect(matrix).toEqual(expectedMatrix);
  });

  it('should round-trip binary payloads through fast_qr WASM', async () => {
    const payload = new Uint8Array([0, 1, 2, 3, 4, 5, 31, 127, 128, 200, 255]);
    const image = await renderQRCodeImageData(payload, 10, 'L', 4, 'fast-qr-wasm');
    const decoded = await decodeQRCodesFromCanvas(image, 1);

    expect(image.width).toBe((10 * 4 + 17 + 8) * 4);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.version).toBe(10);
    expect(decoded[0]!.bytes).toEqual(payload);
  });

  it('should write and read a full V40-L transfer packet with fast_qr WASM', async () => {
    const { createQRTransferProfile } = await import('@/core/protocol/profiles');

    const profile = createQRTransferProfile(40, 'L', 'fast-qr-wasm');
    const packet = new Uint8Array(profile.maxPacketSize);
    for (let i = 0; i < packet.length; i++) packet[i] = i & 0xff;

    const image = await renderQRCodeImageData(
      packet,
      profile.version,
      profile.eccLevel,
      2,
      'fast-qr-wasm',
    );
    const decoded = await decodeQRCodesFromCanvas(image, 1);

    expect(image.width).toBe((40 * 4 + 17 + 8) * 2);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.version).toBe(40);
    expect(decoded[0]!.bytes).toEqual(packet);
  });
});

describe('Frame raster', () => {
  it('should produce correct dimensions', () => {
    const matrix = makeTestMatrix();
    const dims = getRasterDimensions(matrix.length, 3);
    expect(dims.width).toBe((21 + 8) * 3); // 87
    expect(dims.height).toBe(87);
  });

  it('should have quiet zone white', () => {
    const matrix = makeTestMatrix();
    const rgba = rasterizeQR(matrix, 3);
    expect(rgba.data[0]).toBe(255); // corner pixel should be white
    expect(rgba.data[1]).toBe(255);
    expect(rgba.data[2]).toBe(255);
  });

  it('should round-trip through decode', async () => {
    const original = 'Hello QR';
    const data = new TextEncoder().encode(original);
    const matrix = await encodeQRCodeMatrix(data, 1, 'L', 'fast-qr-wasm');
    const gray = rasterizeToGrayscale(matrix, 3);
    const decoded = await decodeQRFromBuffer(gray.data, gray.width, gray.height);
    expect(decoded).not.toBeNull();
    expect(decoded!.version).toBe(1);
    expect(new TextDecoder().decode(decoded!.bytes)).toBe(original);
  });

  it('should decode multiple QR codes from one image', async () => {
    const payloads = ['left QR', 'right QR'];
    const images = await Promise.all(
      payloads.map((text) =>
        renderQRCodeImageData(new TextEncoder().encode(text), 1, 'L', 4, 'fast-qr-wasm'),
      ),
    );
    const tileWidth = images[0]!.width;
    const tileHeight = images[0]!.height;
    const width = tileWidth * images.length;
    const height = tileHeight;
    const composite = new Uint8ClampedArray(width * height * 4);
    composite.fill(255);

    images.forEach((image, tileIndex) => {
      for (let row = 0; row < tileHeight; row++) {
        const sourceStart = row * tileWidth * 4;
        const sourceEnd = sourceStart + tileWidth * 4;
        const targetStart = (row * width + tileIndex * tileWidth) * 4;
        composite.set(image.data.subarray(sourceStart, sourceEnd), targetStart);
      }
    });

    const decoded = await decodeQRCodesFromCanvas(new ImageData(composite, width, height), 2);
    const texts = decoded
      .map((result) => new TextDecoder().decode(result.bytes))
      .sort();

    expect(texts).toEqual([...payloads].sort());
  });

  it('should round-trip QR images written by ZXing WASM', async () => {
    const payload = new Uint8Array([0, 1, 2, 3, 4, 5, 127, 128, 255]);
    const image = await renderQRCodeImageDataWithZXing(payload, 10, 'L', 4);
    const decoded = await decodeQRCodesFromCanvas(image, 1);

    expect(image.width).toBe((10 * 4 + 17 + 8) * 4);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.version).toBe(10);
    expect(decoded[0]!.bytes).toEqual(payload);
  });

  it('should write and read a full V20-L transfer packet with ZXing WASM', async () => {
    const { createQRTransferProfile } = await import('@/core/protocol/profiles');

    const profile = createQRTransferProfile(20, 'L', 'zxing-wasm');
    const packet = new Uint8Array(profile.maxPacketSize);
    for (let i = 0; i < packet.length; i++) packet[i] = i & 0xff;

    const image = await renderQRCodeImageDataWithZXing(
      packet,
      profile.version,
      profile.eccLevel,
      2,
    );
    const decoded = await decodeQRCodesFromCanvas(image, 1);

    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.version).toBe(20);
    expect(decoded[0]!.bytes).toEqual(packet);
  });
});

describe('GIF render', () => {
  it('should produce valid GIF', () => {
    const matrix = makeTestMatrix();
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

describe('Parallel striping', () => {
  it('should assign each packet once per loop and leave incomplete tail tiles empty', async () => {
    const { stripedFrameCount, stripedPacketIndex } = await import('@/core/sender/parallel_striping');

    const packetCount = 10;
    const parallelCount = 4;
    const frameCount = stripedFrameCount(packetCount, parallelCount);
    const seen: number[] = [];
    let emptyTiles = 0;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      for (let tileIndex = 0; tileIndex < parallelCount; tileIndex++) {
        const packetIndex = stripedPacketIndex(packetCount, parallelCount, frameIndex, tileIndex);
        if (packetIndex === null) {
          emptyTiles++;
        } else {
          seen.push(packetIndex);
        }
      }
    }

    expect(frameCount).toBe(3);
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(emptyTiles).toBe(2);
  });

  it('should support 8-way striping without duplicating packets', async () => {
    const { stripedFrameCount, stripedPacketIndex } = await import('@/core/sender/parallel_striping');

    const packetCount = 17;
    const parallelCount = 8;
    const frameCount = stripedFrameCount(packetCount, parallelCount);
    const seen: number[] = [];
    let emptyTiles = 0;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      for (let tileIndex = 0; tileIndex < parallelCount; tileIndex++) {
        const packetIndex = stripedPacketIndex(packetCount, parallelCount, frameIndex, tileIndex);
        if (packetIndex === null) {
          emptyTiles++;
        } else {
          seen.push(packetIndex);
        }
      }
    }

    expect(frameCount).toBe(3);
    expect(seen).toEqual(Array.from({ length: packetCount }, (_, index) => index));
    expect(emptyTiles).toBe(7);
  });
});

describe('Transfer defaults', () => {
  it('should default RaptorQ repair to 10 percent and expose manual 6/8 decode symbols', async () => {
    const { DEFAULT_RAPTORQ_REPAIR_PERCENT, normalizeFecCodec } = await import('@/core/fec/codec');
    const { MAX_SYMBOL_OPTIONS, normalizeDecodeSettings } = await import('@/core/qr/decode_settings');

    expect(DEFAULT_RAPTORQ_REPAIR_PERCENT).toBe(10);
    expect(normalizeFecCodec('js-rlnc')).toBe('js-rlnc');
    expect(normalizeFecCodec('wasm-raptorq')).toBe('wasm-raptorq');
    expect(MAX_SYMBOL_OPTIONS).toEqual(['auto', 1, 2, 4, 6, 8]);
    expect(normalizeDecodeSettings({ maxSymbols: 8 }).maxSymbols).toBe(8);
  });
});
