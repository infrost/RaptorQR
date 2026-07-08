/**
 * QR symbol encoder facade.
 *
 * The transfer protocol is independent from the library used to turn packet
 * bytes into a QR symbol. Keep that choice explicit so browser workers, tests,
 * and the CLI do not accidentally drift onto different encoder paths.
 *
 * Important:
 * - This file must stay browser-WASM-free.
 * - Browser-only encoders such as ZXing WASM and fast_qr WASM are wired in
 *   `qr_encoder_browser.ts`.
 * - Node/CLI-safe fallback is always `js-qrcode`.
 */

import { rasterizeQR } from './frame_raster';
import { generateQRMatrix, type EccLevel } from './qr_encode';

export const QR_ENCODERS = [
  'fast-qr-wasm',
  'zxing-wasm',
  'js-qrcode',
] as const;

export type QREncoder = typeof QR_ENCODERS[number];

export const DEFAULT_QR_ENCODER: QREncoder = 'fast-qr-wasm';
export const COMPATIBLE_QR_ENCODER: QREncoder = 'js-qrcode';

export function normalizeQREncoder(value: unknown): QREncoder {
  switch (value) {
    case 'fast-qr-wasm':
    case 'fast_qr_wasm':
    case 'fastQrWasm':
      return 'fast-qr-wasm';

    case 'zxing-wasm':
    case 'zxing':
    case 'zxingWasm':
      return 'zxing-wasm';

    case 'js-qrcode':
    case 'js':
    case 'jsQRCode':
      return 'js-qrcode';

    default:
      return DEFAULT_QR_ENCODER;
  }
}

export function formatQREncoder(encoder: QREncoder): string {
  switch (encoder) {
    case 'fast-qr-wasm':
      return 'fast_qr WASM';
    case 'zxing-wasm':
      return 'ZXing WASM';
    case 'js-qrcode':
      return 'JS QR';
  }
}

export function encodeQRCodeMatrixWithJS(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
): boolean[][] {
  return generateQRMatrix(data, version, eccLevel);
}

export function renderQRCodeImageDataWithJS(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  scale: number,
): ImageData {
  return rasterizeQR(generateQRMatrix(data, version, eccLevel), scale);
}

export async function encodeQRCodeMatrix(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  encoder: QREncoder = COMPATIBLE_QR_ENCODER,
): Promise<boolean[][]> {
  if (encoder !== 'js-qrcode') {
    throw new Error(
      `${formatQREncoder(encoder)} is only available through qr_encoder_browser.`,
    );
  }

  return encodeQRCodeMatrixWithJS(data, version, eccLevel);
}

export async function renderQRCodeImageData(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  scale: number,
  encoder: QREncoder = COMPATIBLE_QR_ENCODER,
): Promise<ImageData> {
  if (encoder !== 'js-qrcode') {
    throw new Error(
      `${formatQREncoder(encoder)} is only available through qr_encoder_browser.`,
    );
  }

  return renderQRCodeImageDataWithJS(data, version, eccLevel, scale);
}