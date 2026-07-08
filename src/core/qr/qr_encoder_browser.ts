/**
 * Browser QR encoder facade.
 *
 * This file is allowed to import browser-only WASM encoders. Node/CLI code
 * should import `qr_encoder.ts` so esbuild does not pull browser-only wasm
 * assets into the terminal bundle.
 */

import {
  type QREncoder,
  encodeQRCodeMatrixWithJS,
  renderQRCodeImageDataWithJS,
} from './qr_encoder';
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
} from './fast_qr_wasm';

export * from './qr_encoder';

const ECC_TO_NUM: Record<EccLevel, number> = {
  L: 0,
  M: 1,
  Q: 2,
  H: 3,
};

let fastQrRendererPromise: Promise<QrRenderer | null> | null = null;

export async function encodeQRCodeMatrix(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  encoder: QREncoder = 'fast-qr-wasm',
): Promise<boolean[][]> {
  switch (encoder) {
    case 'fast-qr-wasm':
      // fast_qr path currently exposes a raster renderer, not a matrix API.
      // For matrix callers, use the existing JS encoder as a safe fallback.
      return encodeQRCodeMatrixWithJS(data, version, eccLevel);

    case 'js-qrcode':
      return encodeQRCodeMatrixWithJS(data, version, eccLevel);

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

    case 'js-qrcode':
      return renderQRCodeImageDataWithJS(data, version, eccLevel, scale);

    case 'zxing-wasm':
      return renderQRCodeImageDataWithZXing(data, version, eccLevel, scale);
  }
}

async function getFastQrRenderer(): Promise<QrRenderer | null> {
  if (!fastQrRendererPromise) {
    fastQrRendererPromise = ensureFastQrWasm()
      .then(() => new QrRenderer())
      .catch(() => null);
  }

  return fastQrRendererPromise;
}

async function renderQRCodeImageDataWithFastQr(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  scale: number,
): Promise<ImageData> {
  const renderer = await getFastQrRenderer();

  if (!renderer || !isFastQrAvailable()) {
    return renderQRCodeImageDataWithJS(data, version, eccLevel, scale);
  }

  const eccNum = ECC_TO_NUM[eccLevel];
  const sidePx = renderer.render(data, version, eccNum, scale);
  const byteLen = sidePx * sidePx * 4;

  const memory = getFastQrWasmMemory();
  const ptr = renderer.buf_ptr();
  const view = new Uint8ClampedArray(memory.buffer, ptr, byteLen);

  const copy = new Uint8ClampedArray(byteLen);
  copy.set(view);

  return new ImageData(copy, sidePx, sidePx);
}