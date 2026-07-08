/**
 * Browser QR encoder facade.
 *
 * This file is allowed to import browser-only WASM encoders. Node/CLI code
 * should import `qr_encoder_node.ts` so esbuild does not pull browser-only wasm
 * assets into the terminal bundle.
 */

import { type QREncoder } from './qr_encoder';
import type { EccLevel } from './qr_encode';
import {
  generateQRMatrixWithZXing,
  renderQRCodeImageDataWithZXing,
} from './qr_write_wasm';
import {
  ensureFastQrWasm,
  isFastQrAvailable,
  getFastQrWasmMemory,
  QrRenderer,
  fastQrUnavailableMessage,
} from './fast_qr_wasm';

export * from './qr_encoder';

const ECC_TO_NUM: Record<EccLevel, number> = {
  L: 0,
  M: 1,
  Q: 2,
  H: 3,
};

let fastQrRendererPromise: Promise<QrRenderer> | null = null;

export async function encodeQRCodeMatrix(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  encoder: QREncoder = 'fast-qr-wasm',
): Promise<boolean[][]> {
  switch (encoder) {
    case 'fast-qr-wasm':
      return encodeQRCodeMatrixWithFastQr(data, version, eccLevel);

    case 'zxing-wasm':
      return generateQRMatrixWithZXing(data, version, eccLevel);
  }
}

export async function renderQRCodeImageData(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  scale: number,
  encoder: QREncoder = 'fast-qr-wasm',
): Promise<ImageData> {
  switch (encoder) {
    case 'fast-qr-wasm':
      return renderQRCodeImageDataWithFastQr(data, version, eccLevel, scale);

    case 'zxing-wasm':
      return renderQRCodeImageDataWithZXing(data, version, eccLevel, scale);
  }
}

async function getFastQrRenderer(): Promise<QrRenderer> {
  if (!fastQrRendererPromise) {
    fastQrRendererPromise = ensureFastQrWasm()
      .then(() => new QrRenderer())
      .catch((err: unknown) => {
        fastQrRendererPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${fastQrUnavailableMessage()} ${message}`);
      });
  }

  const renderer = await fastQrRendererPromise;
  if (!renderer || !isFastQrAvailable()) {
    throw new Error(fastQrUnavailableMessage());
  }
  return renderer;
}

async function renderQRCodeImageDataWithFastQr(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  scale: number,
): Promise<ImageData> {
  const renderer = await getFastQrRenderer();
  const eccNum = ECC_TO_NUM[eccLevel];
  const sidePx = renderer.render_rgba(data, version, eccNum, scale);
  const byteLen = sidePx * sidePx * 4;

  const memory = getFastQrWasmMemory();
  const ptr = renderer.rgba_ptr();
  const view = new Uint8ClampedArray(memory.buffer, ptr, byteLen);

  const copy = new Uint8ClampedArray(byteLen);
  copy.set(view);

  return new ImageData(copy, sidePx, sidePx);
}

async function encodeQRCodeMatrixWithFastQr(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
): Promise<boolean[][]> {
  const renderer = await getFastQrRenderer();
  const eccNum = ECC_TO_NUM[eccLevel];
  const sideModules = renderer.render_matrix(data, version, eccNum);
  const byteLen = sideModules * sideModules;

  const memory = getFastQrWasmMemory();
  const ptr = renderer.matrix_ptr();
  const modules = new Uint8Array(memory.buffer, ptr, byteLen);

  return matrixFromModuleBytes(modules, sideModules);
}

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
