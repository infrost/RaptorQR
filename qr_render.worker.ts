/**
 * QR render worker — one instance per parallel QR slot.
 *
 * On startup, attempts to initialise the fast_qr WASM module and allocate a
 * single `QrRenderer` whose fixed RGBA buffer lives for the worker's lifetime.
 * If the WASM artifacts are not installed (stub throws), the worker falls back
 * to the synchronous JS path (`generateQRMatrix` + `rasterizeQR`).
 *
 * Zero-copy hot path (WASM available):
 *   1. `renderer.render()` writes RGBA directly into the fixed in-WASM buffer.
 *   2. We build a `Uint8ClampedArray` view over WASM linear memory (no copy).
 *   3. We `.slice()` that view once into a transferable `ArrayBuffer`.
 *   4. The `ArrayBuffer` is posted back via structured clone transfer — no
 *      additional allocation on the main thread.
 *
 * @module
 */

import {
  ensureFastQrWasm,
  isFastQrAvailable,
  getFastQrWasmMemory,
  QrRenderer,
} from '@/core/qr/fast_qr_wasm';
import { generateQRMatrix } from '@/core/qr/qr_encode';
import { rasterizeQR } from '@/core/qr/frame_raster';
import type { EccLevel } from '@/core/qr/qr_encode';

// ─── Message types ────────────────────────────────────────────────────────────

export interface RenderRequest {
  type: 'render';
  /** Transferred ArrayBuffer — the worker owns it after postMessage. */
  packet: ArrayBuffer;
  version: number;
  ecc: EccLevel;
  scale: number;
  /** Opaque job identifier echoed back in the response. */
  jobId: number;
}

export interface RenderResult {
  type: 'rendered';
  /** Transferred ArrayBuffer containing flat RGBA bytes. */
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

// ─── ECC mapping ─────────────────────────────────────────────────────────────

const ECC_TO_NUM: Record<EccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

// ─── Worker-level singleton QrRenderer ────────────────────────────────────────

let renderer: QrRenderer | null = null;

// Kick off WASM init immediately; allocate renderer on success.
void ensureFastQrWasm()
  .then(() => {
    renderer = new QrRenderer();
  })
  .catch(() => {
    // WASM not available — renderer stays null, JS fallback will be used.
  });

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const msg = e.data;
  if (msg.type !== 'render') return;

  try {
    const data = new Uint8Array(msg.packet);
    let buffer: ArrayBuffer;
    let width: number;
    let height: number;

    if (isFastQrAvailable() && renderer !== null) {
      // ── WASM hot path ───────────────────────────────────────────────────
      const eccNum = ECC_TO_NUM[msg.ecc];
      const sidePx = renderer.render(data, msg.version, eccNum, msg.scale);
      const byteLen = sidePx * sidePx * 4;

      // `memory.buffer` must be re-read after every render call because a
      // WASM heap growth would have detached the previous ArrayBuffer.
      const mem = getFastQrWasmMemory();
      const ptr = renderer.buf_ptr();
      const view = new Uint8ClampedArray(mem.buffer, ptr, byteLen);

      // One copy from WASM heap to a standalone transferable buffer.
      const copy = new Uint8ClampedArray(byteLen);
      copy.set(view);
      buffer = copy.buffer;
      width = sidePx;
      height = sidePx;
    } else {
      // ── JS fallback path ────────────────────────────────────────────────
      const matrix = generateQRMatrix(data, msg.version, msg.ecc);
      const imageData = rasterizeQR(matrix, msg.scale);
      // Slice to get an ownable ArrayBuffer (imageData.data.buffer may be
      // shared with the ImageData object internals).
      buffer = imageData.data.buffer.slice(
        imageData.data.byteOffset,
        imageData.data.byteOffset + imageData.data.byteLength,
      ) as ArrayBuffer;
      width = imageData.width;
      height = imageData.height;
    }

    const result: RenderResult = {
      type: 'rendered',
      buffer,
      width,
      height,
      jobId: msg.jobId,
    };
    (self as unknown as Worker).postMessage(result, { transfer: [buffer] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const result: RenderError = { type: 'error', message, jobId: msg.jobId };
    (self as unknown as Worker).postMessage(result);
  }
};
