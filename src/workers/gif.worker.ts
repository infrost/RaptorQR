/**
 * GIF generation worker — receives packets, generates QR matrices,
 * rasterizes them, and creates an animated GIF.
 *
 * @module
 */

import { generateQRMatrix } from '@/core/qr/qr_encode';
import type { EccLevel } from '@/core/qr/qr_encode';
import { rasterizeQR } from '@/core/qr/frame_raster';
import { createQRGif } from '@/core/gif/gif_render';
import { QR_VERSION, ECC_LEVEL, FRAME_DELAY_MS } from '@/core/protocol/constants';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GenerateInput {
  type: 'generate';
  packets: Uint8Array[];
  frameDelayMs?: number;
  qrVersion?: number;
  eccLevel?: EccLevel;
}

interface GifOutput {
  type: 'gifReady';
  gifData: ArrayBuffer;
  width: number;
  height: number;
  frameCount: number;
}

interface ErrorOutput {
  type: 'error';
  message: string;
}

// ─── Worker handler ──────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<GenerateInput>) => {
  const msg = e.data;
  if (msg.type !== 'generate') return;

  try {
    const result = handleGenerate(msg);
    self.postMessage(result, [result.gifData]);
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message ?? String(err) } satisfies ErrorOutput);
  }
};

function handleGenerate(input: GenerateInput): GifOutput {
  const { packets } = input;
  const frameDelayMs = normalizeFrameDelayMs(input.frameDelayMs);
  const qrVersion = normalizeQRVersion(input.qrVersion);
  const eccLevel = normalizeEccLevel(input.eccLevel);

  const moduleCount = qrVersion * 4 + 17;

  // Determine optimal scale: aim for ~300-400 px width
  const targetPx = 360;
  const quietModules = 8; // 4 on each side
  const totalModules = moduleCount + quietModules;
  const scale = Math.max(2, Math.round(targetPx / totalModules));

  // ─── Generate QR matrix for each packet ─────────────────────────────────────────
  const frames: Uint8Array[] = [];
  let width = 0;
  let height = 0;

  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i]!;
    const matrix = generateQRMatrix(packet, qrVersion, eccLevel);
    const imageData = rasterizeQR(matrix, scale);
    if (i === 0) {
      width = imageData.width;
      height = imageData.height;
    }
    frames.push(new Uint8Array(imageData.data.buffer));
  }

  // ─── Create animated GIF ───────────────────────────────────────────────
  const gifBytes = createQRGif(frames, frameDelayMs, width, height);

  return {
    type: 'gifReady',
    gifData: gifBytes.buffer.slice(gifBytes.byteOffset, gifBytes.byteOffset + gifBytes.byteLength) as ArrayBuffer,
    width,
    height,
    frameCount: frames.length,
  };
}

function normalizeFrameDelayMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return FRAME_DELAY_MS;
  return Math.min(500, Math.max(17, Math.round(value!)));
}

function normalizeQRVersion(value: number | undefined): number {
  if (value === undefined) return QR_VERSION;
  if (!Number.isInteger(value) || value < 1 || value > 40) {
    throw new RangeError(`Invalid QR version: ${value}`);
  }
  return value;
}

function normalizeEccLevel(value: EccLevel | undefined): EccLevel {
  return value ?? ECC_LEVEL;
}
