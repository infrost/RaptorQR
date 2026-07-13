/**
 * Full-chain benchmark for the publishable packages.
 *
 * Usage:
 *   pnpm install
 *   pnpm build
 *   pnpm benchmark
 *
 * What this measures:
 * - @raptorqr/core packetizeRaptorQ over the RaptorQ WASM package
 * - @raptorqr/fast-qr-wasm rendering each transport packet to QR ImageData
 * - zxing-wasm decoding those QR images back to packet bytes
 * - @raptorqr/core RaptorQ decoder reconstructing the original payload
 *
 * Useful knobs:
 *   RAPTORQR_BENCH_PAYLOAD_KB=8
 *   RAPTORQR_BENCH_ITERATIONS=3
 *   RAPTORQR_BENCH_SCALE=3
 *
 * Optional regression gates:
 *   RAPTORQR_BENCH_MAX_AVG_TOTAL_MS=5000
 *   RAPTORQR_BENCH_MAX_QR_DECODE_FRAME_MS=80
 *   RAPTORQR_BENCH_MAX_RENDER_FRAME_MS=20
 *   RAPTORQR_BENCH_MIN_KBPS=20
 *
 * Default gates are intentionally loose because local laptops and CI runners
 * vary a lot. Use the env gates above once you have a baseline for your target
 * machine or CI runner.
 */

import './apps/web/src/tests/setup';

import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { initSync as initRaptorQSync } from '@raptorqr/raptorq-wasm';
import { DEFAULT_RAPTORQ_REPAIR_PERCENT } from '@raptorqr/core/fec/codec';
import { RaptorQWasmDecoder } from '@raptorqr/core/fec/raptorq_wasm';
import {
  ECC_LEVEL,
  MAX_PAYLOAD_SIZE,
  QR_VERSION,
  RAPTORQ_SYMBOL_INDEX,
} from '@raptorqr/core/protocol/constants';
import { packetCodec, parsePacket } from '@raptorqr/core/protocol/packet';
import type { Packet as ParsedPacket } from '@raptorqr/core/protocol/packet';
import { decodeQRFromCanvas } from '@raptorqr/core/qr/qr_decode';
import { renderQRCodeImageData } from '@raptorqr/core/qr/qr_encoder_browser';
import { packetizeRaptorQ } from '@raptorqr/core/sender/raptorq_packetizer';
import { createRaptorQPlaybackOrders } from '@raptorqr/core/sender/raptorq_playback';

interface BenchConfig {
  payloadBytes: number;
  iterations: number;
  scale: number;
  maxAvgTotalMs: number;
  maxQrDecodeFrameMs: number;
  maxRenderFrameMs: number;
  minKbPerSecond: number;
}

interface BenchRun {
  iteration: number;
  payloadBytes: number;
  frames: number;
  packetizeMs: number;
  qrRenderMs: number;
  qrDecodeMs: number;
  raptorqDecodeMs: number;
  totalMs: number;
  qrRenderFrameMs: number;
  qrDecodeFrameMs: number;
  kbPerSecond: number;
}

const BENCH_TIMEOUT_MS = 120_000;
const textEncoder = new TextEncoder();

function envNumber(name: string, fallback: number, options: { integer?: boolean; min?: number } = {}): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number, got ${raw}`);
  }

  const rounded = options.integer ? Math.round(parsed) : parsed;
  if (options.min !== undefined && rounded < options.min) {
    throw new Error(`${name} must be >= ${options.min}, got ${raw}`);
  }

  return rounded;
}

function benchConfig(): BenchConfig {
  return {
    payloadBytes: envNumber('RAPTORQR_BENCH_PAYLOAD_KB', 4, { integer: true, min: 1 }) * 1024,
    iterations: envNumber('RAPTORQR_BENCH_ITERATIONS', 2, { integer: true, min: 1 }),
    scale: envNumber('RAPTORQR_BENCH_SCALE', 3, { integer: true, min: 2 }),
    maxAvgTotalMs: envNumber('RAPTORQR_BENCH_MAX_AVG_TOTAL_MS', 60_000, { min: 1 }),
    maxQrDecodeFrameMs: envNumber('RAPTORQR_BENCH_MAX_QR_DECODE_FRAME_MS', 2_000, { min: 1 }),
    maxRenderFrameMs: envNumber('RAPTORQR_BENCH_MAX_RENDER_FRAME_MS', 1_000, { min: 1 }),
    minKbPerSecond: envNumber('RAPTORQR_BENCH_MIN_KBPS', 0.05, { min: 0 }),
  };
}

function packageRoot(packageName: string): string {
  const linkPath = join('node_modules', '@raptorqr', packageName);
  expect(existsSync(linkPath)).toBe(true);
  return realpathSync(linkPath);
}

function raptorqWasmPath(): string {
  return join(
    packageRoot('raptorq-wasm'),
    'src',
    'wasm',
    'raptorqr_raptorq_wasm_bg.wasm',
  );
}

function deterministicPayload(byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  let state = 0x6d2b79f5;

  for (let i = 0; i < out.length; i++) {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    out[i] = (state ^ (state >>> 14) ^ i) & 0xff;
  }

  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

async function timed<T>(work: () => Promise<T>): Promise<[T, number]> {
  const startedAt = performance.now();
  const value = await work();
  return [value, performance.now() - startedAt];
}

async function renderFrames(packets: Uint8Array[], scale: number): Promise<ImageData[]> {
  const images: ImageData[] = [];

  for (const packet of packets) {
    images.push(
      await renderQRCodeImageData(
        packet,
        QR_VERSION,
        ECC_LEVEL,
        scale,
        'fast-qr-wasm',
      ),
    );
  }

  return images;
}

async function decodeFrames(images: ImageData[]): Promise<ParsedPacket[]> {
  const packets: ParsedPacket[] = [];

  for (let i = 0; i < images.length; i++) {
    const decoded = await decodeQRFromCanvas(images[i]!);
    expect(decoded, `QR frame ${i} did not decode`).not.toBeNull();
    expect(decoded!.version).toBe(QR_VERSION);

    const parsed = parsePacket(decoded!.bytes);
    expect(packetCodec(parsed.header), `QR frame ${i} codec`).toBe('wasm-raptorq');
    expect(parsed.header.symbolIndex, `QR frame ${i} symbol index`).toBe(RAPTORQ_SYMBOL_INDEX);
    packets.push(parsed);
  }

  return packets;
}

async function decodePayload(packets: ParsedPacket[], expectedBytes: number): Promise<Uint8Array> {
  expect(packets.length).toBeGreaterThan(0);

  const decoder = await RaptorQWasmDecoder.create(
    packets[0]!.header.dataLength,
    packets[0]!.payload.length,
  );

  let decoded: Uint8Array | null = null;
  for (const packet of packets) {
    decoded = decoder.push(packet.payload);
    if (decoded) break;
  }

  expect(decoded).not.toBeNull();
  return decoded!.slice(0, expectedBytes);
}

async function runFullChainOnce(iteration: number, payload: Uint8Array, config: BenchConfig): Promise<BenchRun> {
  const totalStartedAt = performance.now();

  const [packetized, packetizeMs] = await timed(() => packetizeRaptorQ(
    payload,
    false,
    false,
    undefined,
    undefined,
    {
      maxTransportPayloadSize: MAX_PAYLOAD_SIZE,
      repairPercent: DEFAULT_RAPTORQ_REPAIR_PERCENT,
    },
  ));
  const { loopOrder } = createRaptorQPlaybackOrders(
    packetized.sourcePacketIndices,
    packetized.repairPacketIndices,
    'balanced',
  );
  const scheduledPackets = loopOrder.map((packetIndex) => packetized.packets[packetIndex]!);
  const parsedOriginalPackets = scheduledPackets.map((packet) => parsePacket(packet));

  expect(packetized.dataLength).toBe(payload.length);
  expect(packetized.symbolSize).toBe(MAX_PAYLOAD_SIZE);
  expect(packetized.packets.length).toBeGreaterThan(0);
  expect(parsedOriginalPackets.every((packet) => packetCodec(packet.header) === 'wasm-raptorq')).toBe(true);
  expect(parsedOriginalPackets.every((packet) => packet.header.symbolIndex === RAPTORQ_SYMBOL_INDEX)).toBe(true);

  const [images, qrRenderMs] = await timed(() => renderFrames(scheduledPackets, config.scale));
  const [decodedPackets, qrDecodeMs] = await timed(() => decodeFrames(images));

  expect(decodedPackets).toHaveLength(parsedOriginalPackets.length);
  decodedPackets.forEach((decoded, index) => {
    const original = parsedOriginalPackets[index]!;
    expect(decoded.header).toEqual(original.header);
    expect(decoded.payload).toEqual(original.payload);
  });

  const [decodedPayload, raptorqDecodeMs] = await timed(() => decodePayload(decodedPackets, payload.length));
  expect(bytesEqual(payload, decodedPayload)).toBe(true);

  const totalMs = performance.now() - totalStartedAt;
  const frames = packetized.packets.length;
  const kbPerSecond = (payload.length / 1024) / (totalMs / 1000);

  return {
    iteration,
    payloadBytes: payload.length,
    frames,
    packetizeMs,
    qrRenderMs,
    qrDecodeMs,
    raptorqDecodeMs,
    totalMs,
    qrRenderFrameMs: qrRenderMs / frames,
    qrDecodeFrameMs: qrDecodeMs / frames,
    kbPerSecond,
  };
}

function summarize(runs: BenchRun[]): BenchRun {
  const totals = runs.reduce(
    (acc, run) => ({
      iteration: 0,
      payloadBytes: run.payloadBytes,
      frames: acc.frames + run.frames,
      packetizeMs: acc.packetizeMs + run.packetizeMs,
      qrRenderMs: acc.qrRenderMs + run.qrRenderMs,
      qrDecodeMs: acc.qrDecodeMs + run.qrDecodeMs,
      raptorqDecodeMs: acc.raptorqDecodeMs + run.raptorqDecodeMs,
      totalMs: acc.totalMs + run.totalMs,
      qrRenderFrameMs: acc.qrRenderFrameMs + run.qrRenderFrameMs,
      qrDecodeFrameMs: acc.qrDecodeFrameMs + run.qrDecodeFrameMs,
      kbPerSecond: acc.kbPerSecond + run.kbPerSecond,
    }),
    {
      iteration: 0,
      payloadBytes: runs[0]?.payloadBytes ?? 0,
      frames: 0,
      packetizeMs: 0,
      qrRenderMs: 0,
      qrDecodeMs: 0,
      raptorqDecodeMs: 0,
      totalMs: 0,
      qrRenderFrameMs: 0,
      qrDecodeFrameMs: 0,
      kbPerSecond: 0,
    },
  );
  const divisor = Math.max(1, runs.length);

  return {
    iteration: 0,
    payloadBytes: totals.payloadBytes,
    frames: totals.frames / divisor,
    packetizeMs: totals.packetizeMs / divisor,
    qrRenderMs: totals.qrRenderMs / divisor,
    qrDecodeMs: totals.qrDecodeMs / divisor,
    raptorqDecodeMs: totals.raptorqDecodeMs / divisor,
    totalMs: totals.totalMs / divisor,
    qrRenderFrameMs: totals.qrRenderFrameMs / divisor,
    qrDecodeFrameMs: totals.qrDecodeFrameMs / divisor,
    kbPerSecond: totals.kbPerSecond / divisor,
  };
}

function printableRun(run: BenchRun): Record<string, string | number> {
  return {
    iteration: run.iteration || 'avg',
    payloadKB: (run.payloadBytes / 1024).toFixed(1),
    frames: run.frames.toFixed(1),
    packetizeMs: run.packetizeMs.toFixed(1),
    qrRenderMs: run.qrRenderMs.toFixed(1),
    qrDecodeMs: run.qrDecodeMs.toFixed(1),
    raptorqDecodeMs: run.raptorqDecodeMs.toFixed(1),
    totalMs: run.totalMs.toFixed(1),
    renderFrameMs: run.qrRenderFrameMs.toFixed(2),
    qrDecodeFrameMs: run.qrDecodeFrameMs.toFixed(2),
    kbPerSecond: run.kbPerSecond.toFixed(2),
  };
}

describe('full-chain benchmark', () => {
  test('packetize -> QR render -> QR decode -> RaptorQ decode', async () => {
    const config = benchConfig();
    const payload = deterministicPayload(config.payloadBytes);

    console.info('[bench] config', config);

    // Initialize the split RaptorQ WASM package from its installed package path.
    // This makes the core packetizer use the real RaptorQ path in Node tests.
    initRaptorQSync({ module: readFileSync(raptorqWasmPath()) });

    // Warm up lazy WASM/module initializers so the measured iterations are less
    // dominated by one-time compilation and fetch setup.
    const warmupPayload = deterministicPayload(Math.min(1024, config.payloadBytes));
    const [, warmupMs] = await timed(() => runFullChainOnce(
      0,
      warmupPayload,
      { ...config, payloadBytes: warmupPayload.length },
    ));
    console.info(`[bench] warmup completed in ${warmupMs.toFixed(1)}ms`);

    const runs: BenchRun[] = [];
    for (let i = 0; i < config.iterations; i++) {
      const run = await runFullChainOnce(i + 1, payload, config);
      runs.push(run);
      console.info('[bench] iteration', printableRun(run));
    }

    const average = summarize(runs);
    console.table([...runs, average].map(printableRun));

    expect(average.totalMs).toBeLessThanOrEqual(config.maxAvgTotalMs);
    expect(average.qrDecodeFrameMs).toBeLessThanOrEqual(config.maxQrDecodeFrameMs);
    expect(average.qrRenderFrameMs).toBeLessThanOrEqual(config.maxRenderFrameMs);
    expect(average.kbPerSecond).toBeGreaterThanOrEqual(config.minKbPerSecond);
  }, BENCH_TIMEOUT_MS);
});
