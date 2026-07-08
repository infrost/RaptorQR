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
 * - Node/CLI WASM loading is wired in `qr_encoder_node.ts`.
 */

export const QR_ENCODERS = [
  'fast-qr-wasm',
  'zxing-wasm',
] as const;

export type QREncoder = typeof QR_ENCODERS[number];

export const DEFAULT_QR_ENCODER: QREncoder = 'fast-qr-wasm';

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
  }
}
