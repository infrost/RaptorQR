/**
 * Encode worker — receives raw data, compresses, and packetizes.
 *
 * @module
 */

import { packetizeRaptorQ } from '@raptorqr/core/sender/raptorq_packetizer';
import {
  packetizeLegacyRlnc,
  scheduleLegacyRlncFrames,
} from '@raptorqr/core/sender/legacy_rlnc';
import { MAX_PAYLOAD_SIZE } from '@raptorqr/core/protocol/constants';
import {
  DEFAULT_RAPTORQ_REPAIR_PERCENT,
  normalizeFecCodec,
  normalizeRaptorQRepairPercent,
  type FecCodec,
} from '@raptorqr/core/fec/codec';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EncodeInput {
  type: 'encode';
  data: ArrayBuffer;
  isText: boolean;
  compress: boolean;
  filename?: string;
  mimeType?: string;
  symbolSize?: number;
  fecCodec?: FecCodec;
  raptorqRepairPercent?: number;
}

interface EncodeOutput {
  type: 'encoded';
  packets: Uint8Array[];
  sourcePacketIndices?: number[];
  repairPacketIndices?: number[];
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

  void (async () => {
    try {
      const result = await handleEncode(msg);
      const transfer: ArrayBufferLike[] = result.packets
        .map((p) => p.buffer as ArrayBuffer)
        .filter((b): b is ArrayBuffer => b instanceof ArrayBuffer && b.byteLength <= 1024 * 1024);
      self.postMessage(result, transfer.length > 0 ? { transfer } : undefined);
    } catch (err: any) {
      self.postMessage({ type: 'error', message: err.message ?? String(err) } satisfies ErrorOutput);
    }
  })();
};

async function handleEncode(input: EncodeInput): Promise<EncodeOutput> {
  const originalBytes = new Uint8Array(input.data);
  const fecCodec = normalizeFecCodec(input.fecCodec);

  if (fecCodec === 'wasm-raptorq') {
    const result = await packetizeRaptorQ(
      originalBytes,
      input.isText,
      input.compress,
      input.filename,
      input.mimeType,
      {
        maxTransportPayloadSize: input.symbolSize ?? MAX_PAYLOAD_SIZE,
        repairPercent: normalizeRaptorQRepairPercent(
          input.raptorqRepairPercent ?? DEFAULT_RAPTORQ_REPAIR_PERCENT,
        ),
      },
    );

    return {
      type: 'encoded',
      packets: result.packets,
      sourcePacketIndices: result.sourcePacketIndices,
      repairPacketIndices: result.repairPacketIndices,
      totalGenerations: result.totalGenerations,
      stats: {
        originalSize: originalBytes.length,
        preprocessedSize: result.dataLength,
        frameCount: result.packets.length,
      },
    };
  }

  // Legacy JS RLNC is explicit only; do not use it as a RaptorQ fallback.
  const result = packetizeLegacyRlnc(
    originalBytes,
    input.isText,
    input.compress,
    input.filename,
    input.mimeType,
    { symbolSize: input.symbolSize },
  );
  const frames = scheduleLegacyRlncFrames(result.packets, result.totalGenerations);

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
