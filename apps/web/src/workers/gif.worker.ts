/**
 * GIF generation worker — receives packets, renders QR frames with the
 * selected QR encoder, and creates an animated GIF.
 *
 * @module
 */

import type { EccLevel } from '@raptorqr/core/qr/qr_encode';
import {
  normalizeQREncoder,
  renderQRCodeImageData,
  type QREncoder,
} from '@raptorqr/core/qr/qr_encoder_browser';
import { createQRGif } from '@raptorqr/core/gif/gif_render';
import { QR_VERSION, ECC_LEVEL, FRAME_DELAY_MS } from '@raptorqr/core/protocol/constants';
import {
  stripedFrameCount,
  stripedOrderedPacketIndex,
  type ParallelQRCount,
} from '@raptorqr/core/sender/parallel_striping';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GenerateInput {
  type: 'generate';
  packets: Uint8Array[];
  /** Canonical packet indexes in playback order. */
  packetOrder?: number[];
  frameDelayMs?: number;
  qrVersion?: number;
  eccLevel?: EccLevel;
  qrEncoder?: QREncoder;
  parallelCount?: number;
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

  void (async () => {
    try {
      const result = await handleGenerate(msg);
      self.postMessage(result, [result.gifData]);
    } catch (err: any) {
      self.postMessage({ type: 'error', message: err.message ?? String(err) } satisfies ErrorOutput);
    }
  })();
};

async function handleGenerate(input: GenerateInput): Promise<GifOutput> {
  const { packets } = input;
  const packetOrder = normalizePacketOrder(input.packetOrder, packets.length);
  const frameDelayMs = normalizeFrameDelayMs(input.frameDelayMs);
  const qrVersion = normalizeQRVersion(input.qrVersion);
  const eccLevel = normalizeEccLevel(input.eccLevel);
  const qrEncoder = normalizeQREncoder(input.qrEncoder);
  const parallelCount = normalizeParallelQRCount(input.parallelCount);

  const moduleCount = qrVersion * 4 + 17;

  // Determine optimal scale: aim for ~300-400 px width
  const targetPx = 360;
  const quietModules = 8; // 4 on each side
  const totalModules = moduleCount + quietModules;
  const scale = Math.max(2, Math.round(targetPx / totalModules));
  const tileSize = totalModules * scale;
  const layout = getParallelLayout(parallelCount);

  // ─── Generate QR matrix for each packet ─────────────────────────────────────────
  const frames: Uint8Array[] = [];
  const width = tileSize * layout.columns;
  const height = tileSize * layout.rows;
  const frameCount = stripedFrameCount(packetOrder.length, parallelCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const composite = new Uint8ClampedArray(width * height * 4);
    composite.fill(255);

    for (let tileIndex = 0; tileIndex < parallelCount; tileIndex++) {
      const packetIndex = stripedOrderedPacketIndex(packetOrder, parallelCount, frameIndex, tileIndex);
      if (packetIndex === null) continue;
      const imageData = await renderQRCodeImageData(
        packets[packetIndex]!,
        qrVersion,
        eccLevel,
        scale,
        qrEncoder,
      );
      const x = (tileIndex % layout.columns) * tileSize;
      const y = Math.floor(tileIndex / layout.columns) * tileSize;
      blitImageData(composite, width, imageData.data, imageData.width, imageData.height, x, y);
    }

    frames.push(new Uint8Array(composite.buffer));
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

function normalizeParallelQRCount(value: number | undefined): ParallelQRCount {
  return value === 1 || value === 2 || value === 4 || value === 6 || value === 8 ? value : 4;
}

function normalizePacketOrder(order: number[] | undefined, packetCount: number): number[] {
  if (!order) return Array.from({ length: packetCount }, (_, index) => index);
  if (order.length !== packetCount) {
    throw new RangeError(`Invalid GIF packet order length: ${order.length}, expected ${packetCount}`);
  }

  const seen = new Set<number>();
  for (const packetIndex of order) {
    if (!Number.isInteger(packetIndex) || packetIndex < 0 || packetIndex >= packetCount) {
      throw new RangeError(`Invalid GIF packet index: ${packetIndex}`);
    }
    if (seen.has(packetIndex)) {
      throw new RangeError(`Duplicate GIF packet index: ${packetIndex}`);
    }
    seen.add(packetIndex);
  }
  return order;
}

function getParallelLayout(parallelCount: ParallelQRCount): { columns: number; rows: number } {
  if (parallelCount === 1) return { columns: 1, rows: 1 };
  if (parallelCount === 2) return { columns: 2, rows: 1 };
  if (parallelCount === 4) return { columns: 2, rows: 2 };
  if (parallelCount === 6) return { columns: 3, rows: 2 };
  return { columns: 4, rows: 2 };
}

function blitImageData(
  target: Uint8ClampedArray,
  targetWidth: number,
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
): void {
  for (let row = 0; row < sourceHeight; row++) {
    const sourceStart = row * sourceWidth * 4;
    const sourceEnd = sourceStart + sourceWidth * 4;
    const targetStart = ((y + row) * targetWidth + x) * 4;
    target.set(source.subarray(sourceStart, sourceEnd), targetStart);
  }
}
