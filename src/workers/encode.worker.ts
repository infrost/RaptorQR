/**
 * Encode worker — receives raw data, compresses, packetizes, schedules.
 *
 * @module
 */

import { packetize } from '@/core/sender/packetizer';
import { scheduleFrames } from '@/core/sender/scheduler';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EncodeInput {
  type: 'encode';
  data: ArrayBuffer;
  isText: boolean;
  compress: boolean;
  filename?: string;
  mimeType?: string;
  symbolSize?: number;
}

interface EncodeOutput {
  type: 'encoded';
  packets: Uint8Array[];
  totalGenerations: number;
  stats: {
    originalSize: number;
    preprocessedSize: number;
    frameCount: number;
  };
}

interface ErrorOutput {
  type: 'error';
  message: string;
}

// ─── Worker handler ──────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<EncodeInput>) => {
  const msg = e.data;
  if (msg.type !== 'encode') return;

  try {
    const result = handleEncode(msg);
    const transfer: ArrayBufferLike[] = result.packets
      .map((p) => p.buffer as ArrayBuffer)
      .filter((b): b is ArrayBuffer => b instanceof ArrayBuffer && b.byteLength <= 1024 * 1024);
    self.postMessage(result, transfer.length > 0 ? { transfer } : undefined);
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message ?? String(err) } satisfies ErrorOutput);
  }
};

function handleEncode(input: EncodeInput): EncodeOutput {
  const originalBytes = new Uint8Array(input.data);
  const result = packetize(
    originalBytes,
    input.isText,
    input.compress,
    input.filename,
    input.mimeType,
    { symbolSize: input.symbolSize },
  );
  const frames = scheduleFrames(result.packets, result.totalGenerations);

  return {
    type: 'encoded',
    packets: frames,
    totalGenerations: result.totalGenerations,
    stats: {
      originalSize: originalBytes.length,
      preprocessedSize: result.dataLength,
      frameCount: frames.length,
    },
  };
}
