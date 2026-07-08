/**
 * QR render worker — used by QrWorkerPool.
 *
 * Fast path:
 *   fast_qr WASM writes RGBA directly into its fixed buffer.
 *
 * Fallback:
 *   - if fast_qr_wasm is selected but unavailable, fall back to JS matrix raster.
 *   - otherwise use the selected browser QR encoder.
 */

import {
  ensureFastQrWasm,
  isFastQrAvailable,
  getFastQrWasmMemory,
  QrRenderer,
  fastQrUnavailableMessage,
} from '@/core/qr/fast_qr_wasm';
import {
  normalizeQREncoder,
  renderQRCodeImageData,
  type QREncoder,
} from '@/core/qr/qr_encoder_browser';
import type { EccLevel } from '@/core/qr/qr_encode';

export interface RenderRequest {
  type: 'render';
  packet: ArrayBuffer;
  version: number;
  ecc: EccLevel;
  scale: number;
  qrEncoder?: QREncoder;
  jobId: number;
}

export interface RenderResult {
  type: 'rendered';
  buffer: ArrayBuffer;
  width: number;
  height: number;
  jobId: number;
}

export interface RenderError {
  type: 'error';
  message: string;
  jobId: number;
}

const ECC_TO_NUM: Record<EccLevel, number> = {
  L: 0,
  M: 1,
  Q: 2,
  H: 3,
};

let renderer: QrRenderer | null = null;

const rendererReady = ensureFastQrWasm()
  .then(() => {
    renderer = new QrRenderer();
    return renderer;
  })
  .catch(() => {
    renderer = null;
    return null;
  });

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const msg = e.data;
  if (msg.type !== 'render') return;

  void renderPacket(msg);
};

async function renderPacket(msg: RenderRequest): Promise<void> {
  try {
    const packet = new Uint8Array(msg.packet);
    const qrEncoder = normalizeQREncoder(msg.qrEncoder);

    let buffer: ArrayBuffer;
    let width: number;
    let height: number;

    if (shouldUseFastQrWasm(qrEncoder)) {
      const activeRenderer = renderer ?? await rendererReady;

      if (isFastQrAvailable() && activeRenderer !== null) {
        const eccNum = ECC_TO_NUM[msg.ecc];
        const sidePx = activeRenderer.render_rgba(packet, msg.version, eccNum, msg.scale);
        const byteLen = sidePx * sidePx * 4;

        const memory = getFastQrWasmMemory();
        const ptr = activeRenderer.rgba_ptr();
        const view = new Uint8ClampedArray(memory.buffer, ptr, byteLen);

        const copy = new Uint8ClampedArray(byteLen);
        copy.set(view);

        buffer = copy.buffer as ArrayBuffer;
        width = sidePx;
        height = sidePx;
      } else {
        throw new Error(fastQrUnavailableMessage());
      }
    } else {
      const imageData = await renderQRCodeImageData(
        packet,
        msg.version,
        msg.ecc,
        msg.scale,
        qrEncoder,
      );

      buffer = imageData.data.buffer.slice(
        imageData.data.byteOffset,
        imageData.data.byteOffset + imageData.data.byteLength,
      ) as ArrayBuffer;
      width = imageData.width;
      height = imageData.height;
    }

    self.postMessage(
      {
        type: 'rendered',
        buffer,
        width,
        height,
        jobId: msg.jobId,
      } satisfies RenderResult,
      { transfer: [buffer] },
    );
  } catch (err: unknown) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      jobId: msg.jobId,
    } satisfies RenderError);
  }
}

function shouldUseFastQrWasm(qrEncoder: QREncoder): boolean {
  const id = String(qrEncoder);
  return id === 'fast-qr-wasm' || id === 'fast_qr_wasm' || id === 'fastQrWasm';
}
