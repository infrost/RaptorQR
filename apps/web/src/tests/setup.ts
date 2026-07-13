// Mock ImageData for Vitest/happy-dom which doesn't support it
// This is a minimal implementation sufficient for tests

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const zxingReaderWasmPath = join(
  repoRoot,
  'node_modules',
  'zxing-wasm',
  'dist',
  'reader',
  'zxing_reader.wasm',
);
const zxingWriterWasmPath = join(
  repoRoot,
  'node_modules',
  'zxing-wasm',
  'dist',
  'writer',
  'zxing_writer.wasm',
);
const raptorqWasmPath = join(
  repoRoot,
  'packages',
  'raptorqr-raptorq-wasm',
  'src',
  'wasm',
  'raptorqr_raptorq_wasm_bg.wasm',
);
const fastQrWasmPath = join(
  repoRoot,
  'packages',
  'raptorqr-fast-qr-wasm',
  'src',
  'wasm',
  'raptorqr_fast_qr_wasm_bg.wasm',
);

// happy-dom's Response is not accepted by Node's instantiateStreaming; tests can
// use the same local wasm bytes through the ArrayBuffer fallback.
Object.defineProperty(WebAssembly, 'instantiateStreaming', {
  configurable: true,
  value: undefined,
});

globalThis.fetch = (async (input, init) => {
  const url = typeof input === 'string' || input instanceof URL
    ? String(input)
    : input.url;

  if (process.env.RAPTORQR_DEBUG_FETCH === '1') {
    console.log('test fetch', url);
  }

  if (url.includes('zxing_reader.wasm')) {
    return wasmResponse(url, zxingReaderWasmPath);
  }

  if (url.includes('zxing_writer.wasm')) {
    return wasmResponse(url, zxingWriterWasmPath);
  }

  if (url.includes('raptorqr_raptorq_wasm_bg.wasm')) {
    return wasmResponse(url, raptorqWasmPath);
  }

  if (url.includes('raptorqr_fast_qr_wasm_bg.wasm')) {
    return wasmResponse(url, fastQrWasmPath);
  }

  if (!originalFetch) {
    throw new Error(`Unexpected fetch in test: ${url}`);
  }
  return originalFetch(input, init);
}) as typeof globalThis.fetch;

function findRepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  const root = parse(dir).root;

  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    if (dir === root) return process.cwd();
    dir = dirname(dir);
  }
}

async function wasmResponse(url: string, fallbackPath: string): Promise<Response> {
  const explicitPath = viteFsPath(url) ?? repoRelativeFsPath(url);
  const localPath = explicitPath ?? fallbackPath;

  if (!existsSync(localPath)) {
    throw new Error(`Unable to resolve test WASM asset: ${url} -> ${localPath}`);
  }

  const bytes = await readFile(localPath);
  const body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return new Response(body, {
    headers: { 'Content-Type': 'application/wasm' },
    status: 200,
  });
}

function viteFsPath(url: string): string | null {
  const marker = '/@fs/';
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const rawPath = decodeURIComponent(url.slice(idx + marker.length));
  return normalize(rawPath);
}

function repoRelativeFsPath(url: string): string | null {
  try {
    const parsed = new URL(url, 'http://localhost');

    if (parsed.protocol === 'file:') {
      return normalize(fileURLToPath(parsed));
    }

    const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    return relativePath ? normalize(join(repoRoot, relativePath)) : null;
  } catch {
    if (!url.startsWith('/')) return null;
    const relativePath = decodeURIComponent(url).replace(/^\/+/, '');
    return relativePath ? normalize(join(repoRoot, relativePath)) : null;
  }
}
