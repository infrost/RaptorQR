/**
 * QR symbol encoder facade.
 *
 * The transfer protocol is independent from the library used to turn packet
 * bytes into a QR symbol. Keep that choice explicit so browser workers, tests,
 * and the CLI do not accidentally drift onto different encoder paths.
 */

import { rasterizeQR } from './frame_raster';
import { generateQRMatrix, type EccLevel } from './qr_encode';

export const QR_ENCODERS = ['zxing-wasm', 'js-qrcode'] as const;
export type QREncoder = typeof QR_ENCODERS[number];

export const DEFAULT_QR_ENCODER: QREncoder = 'zxing-wasm';
export const COMPATIBLE_QR_ENCODER: QREncoder = 'js-qrcode';

export function normalizeQREncoder(value: unknown): QREncoder {
  return QR_ENCODERS.includes(value as QREncoder)
    ? value as QREncoder
    : DEFAULT_QR_ENCODER;
}

export function formatQREncoder(encoder: QREncoder): string {
  switch (encoder) {
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
    throw new Error('ZXing WASM QR encoder is only available through qr_encoder_browser.');
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
    throw new Error('ZXing WASM QR encoder is only available through qr_encoder_browser.');
  }
  return renderQRCodeImageDataWithJS(data, version, eccLevel, scale);
}
