/**
 * Final high-throughput transfer benchmark.
 *
 * Usage:
 *   pnpm install
 *   pnpm build
 *   pnpm benchmark:final
 *
 * Scenario:
 * - QR profile: V30-L, fast QR WASM
 * - Display cadence: 30 fps for 10 seconds
 * - Parallelism: 4 QR codes per display frame, 2x2 layout
 * - QR symbol slots: 30 * 10 * 4 = 1200
 * - RaptorQ repair: 20%
 * - Loss model: deterministic random loss of 200 QR symbols
 *
 * This is intentionally separate from `pnpm benchmark` because it renders and
 * parses 1200 large QR symbols. It is a release/final gate, not a lightweight
 * edit-loop test.
 */

import './apps/web/src/tests/setup';

import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { initSync as initRaptorQSync } from '@raptorqr/raptorq-wasm';
import { RaptorQWasmDecoder } from '@raptorqr/core/fec/raptorq_wasm';
import { RAPTORQ_SYMBOL_INDEX } from '@raptorqr/core/protocol/constants';
import { createQRTransferProfile } from '@raptorqr/core/protocol/profiles';
import { packetCodec, parsePacket } from '@raptorqr/core/protocol/packet';
import { decodeQRCodesFromCanvas } from '@raptorqr/core/qr/qr_decode';
import { renderQRCodeImageData } from '@raptorqr/core/qr/qr_encoder_browser';
import { packetizeRaptorQ } from '@raptorqr/core/sender/raptorq_packetizer';
import { createRaptorQPlaybackOrders } from '@raptorqr/core/sender/raptorq_playback';

const QR_VERSION = 30;
const ECC_LEVEL = 'L';
const FPS = 30;
const DURATION_SECONDS = 10;
const PARALLEL_QR_COUNT = 4;
const DISPLAY_FRAMES = FPS * DURATION_SECONDS;
const TOTAL_QR_SYMBOLS = DISPLAY_FRAMES * PARALLEL_QR_COUNT;
const REPAIR_PERCENT = 20;
const DROPPED_QR_SYMBOLS = 200;
const SCALE = 2;
const FINAL_TIMEOUT_MS = 300_000;
const DROP_SEED = 0x30f5_1200;

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
  let state = 0x9e37_79b9;

  for (let i = 0; i < out.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = (state + i) & 0xff;
  }

  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function droppedSymbolSet(totalSymbols: number, dropCount: number, seed: number): Set<number> {
  const indices = Array.from({ length: totalSymbols }, (_, index) => index);
  let state = seed >>> 0;

  for (let i = indices.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const tmp = indices[i]!;
    indices[i] = indices[j]!;
    indices[j] = tmp;
  }

  return new Set(indices.slice(0, dropCount));
}

function raptorQPayloadId(payload: Uint8Array): string {
  expect(payload.length).toBeGreaterThanOrEqual(4);
  return `${payload[0]}:${payload[1]}:${payload[2]}:${payload[3]}`;
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

function tileOffset(tileIndex: number, tileSize: number): { x: number; y: number } {
  return {
    x: (tileIndex % 2) * tileSize,
    y: Math.floor(tileIndex / 2) * tileSize,
  };
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

describe('final V30 4-way transfer benchmark', () => {
  test('decodes 30fps * 10s * 4 QR with 20% repair and 200 random symbol losses', async () => {
    initRaptorQSync({ module: readFileSync(raptorqWasmPath()) });

    const profile = createQRTransferProfile(QR_VERSION, ECC_LEVEL, 'fast-qr-wasm');
    const sourceSymbols = TOTAL_QR_SYMBOLS - DROPPED_QR_SYMBOLS;
    const payload = deterministicPayload(sourceSymbols * (profile.maxPayloadSize - 4));
    const dropSet = droppedSymbolSet(TOTAL_QR_SYMBOLS, DROPPED_QR_SYMBOLS, DROP_SEED);
    const tileModules = QR_VERSION * 4 + 17 + 8;
    const tileSize = tileModules * SCALE;
    const compositeWidth = tileSize * 2;
    const compositeHeight = tileSize * 2;

    const packetizeStart = performance.now();
    const packetized = await packetizeRaptorQ(
      payload,
      false,
      false,
      undefined,
      undefined,
      {
        maxTransportPayloadSize: profile.maxPayloadSize,
        repairPercent: REPAIR_PERCENT,
      },
    );
    const packetizeMs = performance.now() - packetizeStart;

    expect(packetized.packets).toHaveLength(TOTAL_QR_SYMBOLS);
    expect(packetized.symbolSize).toBe(profile.maxPayloadSize);
    expect(packetized.dataLength).toBe(payload.length);
    const { loopOrder } = createRaptorQPlaybackOrders(
      packetized.sourcePacketIndices,
      packetized.repairPacketIndices,
      'balanced',
    );

    const decoder = await RaptorQWasmDecoder.create(packetized.dataLength, profile.maxPayloadSize);
    const seenPayloadIds = new Set<string>();
    let decodedPayload: Uint8Array | null = null;
    let displayFramesConsumed = 0;
    let renderedQrSymbols = 0;
    let decodedQrSymbols = 0;
    let parsedPackets = 0;
    let renderMs = 0;
    let qrDecodeMs = 0;
    let raptorqDecodeMs = 0;

    for (let displayFrame = 0; displayFrame < DISPLAY_FRAMES; displayFrame++) {
      const composite = new Uint8ClampedArray(compositeWidth * compositeHeight * 4);
      composite.fill(255);

      const renderStart = performance.now();
      for (let tileIndex = 0; tileIndex < PARALLEL_QR_COUNT; tileIndex++) {
        const symbolIndex = displayFrame * PARALLEL_QR_COUNT + tileIndex;
        if (dropSet.has(symbolIndex)) continue;

        const packet = packetized.packets[loopOrder[symbolIndex]!]!;
        const qrImage = await renderQRCodeImageData(
          packet,
          QR_VERSION,
          ECC_LEVEL,
          SCALE,
          'fast-qr-wasm',
        );
        const { x, y } = tileOffset(tileIndex, tileSize);
        blitImageData(composite, compositeWidth, qrImage.data, qrImage.width, qrImage.height, x, y);
        renderedQrSymbols++;
      }
      renderMs += performance.now() - renderStart;

      const imageData = new ImageData(composite, compositeWidth, compositeHeight);
      const qrDecodeStart = performance.now();
      const decodedSymbols = await decodeQRCodesFromCanvas(imageData, PARALLEL_QR_COUNT);
      qrDecodeMs += performance.now() - qrDecodeStart;
      decodedQrSymbols += decodedSymbols.length;
      displayFramesConsumed = displayFrame + 1;

      const raptorqStart = performance.now();
      for (const decoded of decodedSymbols) {
        expect(decoded.version).toBe(QR_VERSION);

        const packet = parsePacket(decoded.bytes);
        expect(packetCodec(packet.header)).toBe('wasm-raptorq');
        expect(packet.header.symbolIndex).toBe(RAPTORQ_SYMBOL_INDEX);
        expect(packet.header.dataLength).toBe(packetized.dataLength);
        expect(packet.header.totalGenerations).toBe(TOTAL_QR_SYMBOLS);

        const payloadId = raptorQPayloadId(packet.payload);
        if (seenPayloadIds.has(payloadId)) continue;
        seenPayloadIds.add(payloadId);
        parsedPackets++;

        decodedPayload = decoder.push(packet.payload);
        if (decodedPayload) break;
      }
      raptorqDecodeMs += performance.now() - raptorqStart;

      if (decodedPayload) break;
    }

    expect(renderedQrSymbols).toBe(TOTAL_QR_SYMBOLS - DROPPED_QR_SYMBOLS);
    expect(decodedQrSymbols).toBe(renderedQrSymbols);
    expect(parsedPackets).toBe(sourceSymbols);
    expect(decodedPayload).not.toBeNull();
    expect(bytesEqual(payload, decodedPayload!.slice(0, payload.length))).toBe(true);

    const parseMs = qrDecodeMs + raptorqDecodeMs;
    const totalMeasuredMs = packetizeMs + renderMs + parseMs;
    const scheduledSecondsToRecover = displayFramesConsumed / FPS;
    const scheduledKbPerSecond = (payload.length / 1024) / scheduledSecondsToRecover;
    const parserKbPerSecond = (payload.length / 1024) / (parseMs / 1000);
    const parserDisplayFps = displayFramesConsumed / (parseMs / 1000);
    const parserQrSymbolsPerSecond = parsedPackets / (parseMs / 1000);

    console.info('[bench:final] scenario', {
      profile: profile.label,
      fps: FPS,
      durationSeconds: DURATION_SECONDS,
      displayFrames: DISPLAY_FRAMES,
      parallelQrCount: PARALLEL_QR_COUNT,
      totalQrSymbols: TOTAL_QR_SYMBOLS,
      repairPercent: REPAIR_PERCENT,
      droppedQrSymbols: DROPPED_QR_SYMBOLS,
      sourceSymbols,
      payloadBytes: payload.length,
      tileSize,
      composite: `${compositeWidth}x${compositeHeight}`,
    });
    console.table([
      {
        packetizeMs: round(packetizeMs),
        renderMs: round(renderMs),
        qrDecodeMs: round(qrDecodeMs),
        raptorqDecodeMs: round(raptorqDecodeMs),
        totalMeasuredMs: round(totalMeasuredMs),
        displayFramesConsumed,
        parsedPackets,
        scheduledKbPerSecond: round(scheduledKbPerSecond),
        parserKbPerSecond: round(parserKbPerSecond),
        parserDisplayFps: round(parserDisplayFps),
        parserQrSymbolsPerSecond: round(parserQrSymbolsPerSecond),
      },
    ]);

    expect(displayFramesConsumed).toBeLessThanOrEqual(DISPLAY_FRAMES);
    expect(scheduledKbPerSecond).toBeGreaterThan(100);
    expect(parserDisplayFps).toBeGreaterThan(30);
  }, FINAL_TIMEOUT_MS);
});
