// Mock ImageData for Vitest/happy-dom which doesn't support it
// This is a minimal implementation sufficient for tests

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';

class MockImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: 'srgb';

  constructor(
    data: Uint8ClampedArray | number,
    width: number,
    height?: number,
  ) {
    if (typeof data === 'number') {
      // new ImageData(width, height)
      this.width = data;
      this.height = width as number;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = data;
      this.width = width;
      this.height = height ?? data.byteLength / (width * 4);
    }
    this.colorSpace = 'srgb';
  }
}

// @ts-expect-error - Global mock
globalThis.ImageData = MockImageData;

const originalFetch = globalThis.fetch?.bind(globalThis);
const zxingReaderWasmPath = join(
  process.cwd(),
  'node_modules',
  'zxing-wasm',
  'dist',
  'reader',
  'zxing_reader.wasm',
);

// happy-dom's Response is not accepted by Node's instantiateStreaming; tests can
// use the same local wasm bytes through the ArrayBuffer fallback.
Object.defineProperty(WebAssembly, 'instantiateStreaming', {
  configurable: true,
  value: undefined,
});

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' || input instanceof URL
    ? String(input)
    : input.url;

  if (url.includes('zxing_reader.wasm')) {
    const bytes = await readFile(zxingReaderWasmPath);
    const body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new Response(body, {
      headers: { 'Content-Type': 'application/wasm' },
      status: 200,
    });
  }

  if (!originalFetch) {
    throw new Error(`Unexpected fetch in test: ${url}`);
  }
  return originalFetch(input, init);
};
