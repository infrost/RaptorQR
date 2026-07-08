/**
 * Node/CLI QR encoder facade.
 *
 * The web app uses `qr_encoder_browser.ts`, where Vite owns WASM URL loading.
 * The CLI uses this file instead so fast_qr's wasm-bindgen module can be
 * initialised from filesystem bytes.
 */

import {
  QrRenderer,
  initSync,
  type InitOutput,
} from '../../fast_qr_wasm/wasm/qrstream_fast_qr_wasm.js';
import {
  DEFAULT_QR_ENCODER,
  formatQREncoder,
  type QREncoder,
} from './qr_encoder';
import type { EccLevel } from './qr_encode';
import { readNodeWasmAsset } from '@/core/wasm/node_assets';

export * from './qr_encoder';

export const DEFAULT_CLI_QR_ENCODER: QREncoder = DEFAULT_QR_ENCODER;

const FAST_QR_WASM_ASSET = {
  distFileName: 'qrstream_fast_qr_wasm_bg.wasm',
  sourceRelativePath: 'src/fast_qr_wasm/wasm/qrstream_fast_qr_wasm_bg.wasm',
  envVar: 'QRSTREAM_FAST_QR_WASM',
};

const ECC_TO_NUM: Record<EccLevel, number> = {
  L: 0,
  M: 1,
  Q: 2,
  H: 3,
};

let fastQrInitOutput: InitOutput | null = null;
let fastQrRenderer: QrRenderer | null = null;
let fastQrInitFailed = false;

export function isFastQrNodeAvailable(): boolean {
  try {
    getFastQrNodeRenderer();
    return true;
  } catch {
    return false;
  }
}

export async function encodeQRCodeMatrix(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  encoder: QREncoder = DEFAULT_CLI_QR_ENCODER,
): Promise<boolean[][]> {
  switch (encoder) {
    case 'fast-qr-wasm':
      return encodeQRCodeMatrixWithFastQr(data, version, eccLevel);

    case 'zxing-wasm':
      throw new Error(
        `${formatQREncoder(encoder)} is not available in the CLI yet. ` +
        'Use fast_qr WASM.',
      );
  }
}

export async function renderQRCodeImageData(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  scale: number,
  encoder: QREncoder = DEFAULT_CLI_QR_ENCODER,
): Promise<ImageData> {
  if (encoder === 'zxing-wasm') {
    throw new Error(
      `${formatQREncoder(encoder)} is not available in the CLI yet. ` +
      'Use fast_qr WASM.',
    );
  }

  const renderer = getFastQrNodeRenderer();
  const eccNum = ECC_TO_NUM[eccLevel];
  const sidePx = renderer.render_rgba(data, version, eccNum, scale);
  const byteLen = sidePx * sidePx * 4;
  const view = new Uint8ClampedArray(
    fastQrInitOutput!.memory.buffer,
    renderer.rgba_ptr(),
    byteLen,
  );
  const copy = new Uint8ClampedArray(byteLen);
  copy.set(view);
  return new ImageData(copy, sidePx, sidePx);
}

function encodeQRCodeMatrixWithFastQr(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
): boolean[][] {
  const renderer = getFastQrNodeRenderer();
  const eccNum = ECC_TO_NUM[eccLevel];
  const sideModules = renderer.render_matrix(data, version, eccNum);
  const byteLen = sideModules * sideModules;
  const modules = new Uint8Array(
    fastQrInitOutput.memory.buffer,
    renderer.matrix_ptr(),
    byteLen,
  );

  return matrixFromModuleBytes(modules, sideModules);
}

function getFastQrNodeRenderer(): QrRenderer {
  if (fastQrRenderer) return fastQrRenderer;
  if (fastQrInitFailed) {
    throw new Error('fast_qr WASM is unavailable in Node.');
  }

  try {
    const wasmBytes = readNodeWasmAsset(FAST_QR_WASM_ASSET);
    fastQrInitOutput = initSync({ module: wasmBytes });
    fastQrRenderer = new QrRenderer();
    return fastQrRenderer;
  } catch (err) {
    fastQrInitFailed = true;
    throw err instanceof Error ? err : new Error(String(err));
  }
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
