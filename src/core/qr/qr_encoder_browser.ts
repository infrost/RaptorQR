/**
 * Browser QR encoder facade.
 *
 * This file is allowed to import the ZXing WASM writer. Node/CLI code should
 * import `qr_encoder.ts` so esbuild does not pull browser-only wasm assets into
 * the terminal bundle.
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

export * from './qr_encoder';

export async function encodeQRCodeMatrix(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  encoder: QREncoder = 'zxing-wasm',
): Promise<boolean[][]> {
  switch (encoder) {
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
  encoder: QREncoder = 'zxing-wasm',
): Promise<ImageData> {
  switch (encoder) {
    case 'js-qrcode':
      return renderQRCodeImageDataWithJS(data, version, eccLevel, scale);
    case 'zxing-wasm':
      return renderQRCodeImageDataWithZXing(data, version, eccLevel, scale);
  }
}
