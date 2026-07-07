/**
 * Decode worker — receives camera/GIF frames, decodes QR codes, parses
 * packets, routes to GenerationDecoder, and signals completion.
 *
 * @module
 */

import { inflateSync } from 'fflate';
import {
  decodeQRCodesFromCanvas,
  type QrDecodeResult,
} from '@/core/qr/qr_decode';
import {
  DEFAULT_DECODE_SETTINGS,
  normalizeDecodeSettings,
  type QrDecodeSettings,
} from '@/core/qr/decode_settings';
import { packetCodec, parsePacket, type TransportCodec } from '@/core/protocol/packet';
import type { Packet } from '@/core/protocol/packet';
import { K, sourceGenerationsFromDataLength } from '@/core/protocol/constants';
import {
  DEFAULT_RECEIVER_FEC_CODEC,
  normalizeReceiverFecCodec,
  type ReceiverFecCodec,
} from '@/core/fec/codec';
import { RaptorQWasmDecoder } from '@/core/fec/raptorq_wasm';
import { GenerationDecoder } from '@/core/fec/rlnc_decoder';
import { assemblePayload } from '@/core/reconstruct/assemble';

// ─── State ───────────────────────────────────────────────────────────────────

interface BaseDecodeState {
  codec: TransportCodec;
  dedup: Set<string>;
  receivedPackets: number;
  totalGenerations: number;
  sourceGenerations: number;
  dataLength: number;
  symbolSize: number;
  qrVersion: number;
  isText: boolean;
  isCompressed: boolean;
  completed: boolean;
  stats: {
    totalFrames: number;
    framesWithQR: number;
    acceptedPackets: number;
  };
}

interface RlncDecodeState extends BaseDecodeState {
  codec: 'js-rlnc';
  decoder: GenerationDecoder;
  solvedGenerations: Set<number>;
}

interface RaptorQDecodeState extends BaseDecodeState {
  codec: 'wasm-raptorq';
  decoder: RaptorQWasmDecoder | null;
}

type DecodeState = RlncDecodeState | RaptorQDecodeState;

interface QueuedFrame {
  imageData: ImageData;
  realtime: boolean;
}

const MAX_REALTIME_FRAME_QUEUE = 60;
const MAX_QR_SYMBOLS_PER_FRAME = 4;

let current: DecodeState | null = null;
let frameQueue: QueuedFrame[] = [];
let processingQueue = false;
let decodeSettings: QrDecodeSettings = DEFAULT_DECODE_SETTINGS;
let receiverFecCodec: ReceiverFecCodec = DEFAULT_RECEIVER_FEC_CODEC;
let codecMismatchReported = false;
let raptorqUnavailableReported = false;

// ─── Worker handler ───────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'reset') {
    current = null;
    frameQueue = [];
    codecMismatchReported = false;
    raptorqUnavailableReported = false;
    return;
  }

  if (msg.type === 'settings') {
    decodeSettings = normalizeDecodeSettings(msg.settings);
    receiverFecCodec = normalizeReceiverFecCodec(msg.fecCodec);
    return;
  }

  if (msg.type === 'frame') {
    let imageData: ImageData | null = msg.imageData ?? msg.frameData ?? null;
    if (!imageData && msg.pixels && msg.width && msg.height) {
      try {
        imageData = new ImageData(
          new Uint8ClampedArray(msg.pixels),
          msg.width,
          msg.height,
        );
      } catch (e: any) {
        self.postMessage({ type: 'error', message: 'ImageData failed: ' + e.message });
        return;
      }
    }
    if (!imageData) return;
    queueFrame(imageData, msg.realtime === true);
    return;
  }
};

// ─── Frame handling ───────────────────────────────────────────────────────────

function queueFrame(imageData: ImageData, realtime: boolean): void {
  if (realtime) {
    const realtimeQueueLength = frameQueue.reduce(
      (count, frame) => count + (frame.realtime ? 1 : 0),
      0,
    );
    if (realtimeQueueLength >= MAX_REALTIME_FRAME_QUEUE) {
      const oldestRealtimeIndex = frameQueue.findIndex((frame) => frame.realtime);
      if (oldestRealtimeIndex >= 0) {
        frameQueue.splice(oldestRealtimeIndex, 1);
      }
    }
  }
  frameQueue.push({ imageData, realtime });
  void processFrameQueue();
}

async function processFrameQueue(): Promise<void> {
  if (processingQueue) return;
  processingQueue = true;

  try {
    while (frameQueue.length > 0) {
      const queued = frameQueue.shift()!;
      try {
        await handleFrame(queued.imageData);
        if (current?.completed) {
          frameQueue = [];
        }
      } catch (err: any) {
        self.postMessage({ type: 'error', message: `Frame error: ${err.message ?? String(err)}` });
      }
    }
  } finally {
    processingQueue = false;
  }
}

async function handleFrame(imageData: ImageData): Promise<void> {
  const decodedSymbols = await decodeQRCodesFromCanvas(imageData, {
    ...decodeSettings,
    maxSymbols: maxSymbolsForNextScan(),
  });
  if (decodedSymbols.length === 0) return;

  let processedPackets = 0;
  for (const decoded of decodedSymbols) {
    let packet: Packet;
    try {
      packet = parsePacket(decoded.bytes);
    } catch {
      continue;
    }

    const processed = await processDecodedPacket(decoded, packet, processedPackets === 0);
    if (!processed) continue;
    processedPackets++;

    if (current?.completed) {
      reportProgress(current);
      return;
    }
  }

  if (current && processedPackets > 0) {
    reportProgress(current);
  }
}

function maxSymbolsForNextScan(): number {
  if (decodeSettings.maxSymbols !== 'auto') {
    return decodeSettings.maxSymbols;
  }
  return MAX_QR_SYMBOLS_PER_FRAME;
}

async function processDecodedPacket(
  decoded: QrDecodeResult,
  packet: Packet,
  countFrame: boolean,
): Promise<boolean> {
  const codec = packetCodec(packet.header);
  if (!codecAllowed(codec)) {
    reportCodecMismatch(codec);
    return false;
  }

  if (codec === 'wasm-raptorq') {
    return processRaptorQPacket(decoded, packet, countFrame);
  }

  return processRlncPacket(decoded, packet, countFrame);
}

function processRlncPacket(
  decoded: QrDecodeResult,
  packet: Packet,
  countFrame: boolean,
): boolean {
  const h = packet.header;

  // Start fresh on first valid packet
  if (!current) {
    const symbolSize = packet.payload.length;
    const sourceGens = sourceGenerationsFromDataLength(h.dataLength, symbolSize);
    current = {
      codec: 'js-rlnc',
      decoder: new GenerationDecoder(K, symbolSize),
      dedup: new Set(),
      receivedPackets: 0,
      solvedGenerations: new Set(),
      totalGenerations: h.totalGenerations,
      sourceGenerations: sourceGens,
      dataLength: h.dataLength,
      symbolSize,
      qrVersion: decoded.version,
      isText: h.isText,
      isCompressed: h.compressed,
      completed: false,
      stats: { totalFrames: 0, framesWithQR: 0, acceptedPackets: 0 },
    };
  }

  if (current.codec !== 'js-rlnc') {
    reportCodecMismatch('js-rlnc');
    return false;
  }

  if (current.completed) return true;

  if (countFrame) {
    current.stats.totalFrames++;
  }

  if (packet.payload.length !== current.symbolSize) {
    throw new Error(
      `QR payload size changed from ${current.symbolSize} to ${packet.payload.length} bytes. ` +
      'Restart the scan before switching QR size.',
    );
  }

  // Update metadata from header
  current.totalGenerations = h.totalGenerations;
  current.dataLength = h.dataLength;
  current.sourceGenerations = sourceGenerationsFromDataLength(h.dataLength, current.symbolSize);
  current.qrVersion = decoded.version;
  current.isText = h.isText;
  current.isCompressed = h.compressed;

  current.stats.framesWithQR++;

  // Dedup: generationIndex:symbolIndex
  const dedupKey = `${h.generationIndex}:${h.symbolIndex}`;
  if (current.dedup.has(dedupKey)) return true;
  current.dedup.add(dedupKey);

  // Feed to decoder
  const gen = h.generationIndex;
  let accepted = false;
  const isSystematic = h.symbolIndex < K;

  if (isSystematic) {
    accepted = current.decoder.addSystematicSymbol(gen, packet.payload, h.symbolIndex);
  } else {
    accepted = current.decoder.addCodedSymbol(gen, packet.payload, h.symbolIndex - K);
  }

  if (accepted) {
    current.stats.acceptedPackets++;
    current.receivedPackets++;

    if (current.decoder.isSolved(gen)) {
      current.solvedGenerations.add(gen);

      // We only need sourceGenerations generations solved (any mix of source + parity)
      if (current.solvedGenerations.size >= current.sourceGenerations) {
        reconstructData(current);
        if (current.completed) return true;
      }
    }
  }

  return true;
}

async function processRaptorQPacket(
  decoded: QrDecodeResult,
  packet: Packet,
  countFrame: boolean,
): Promise<boolean> {
  const h = packet.header;

  if (!current) {
    const symbolSize = packet.payload.length;
    const sourceSymbols = Math.max(1, Math.ceil(h.dataLength / Math.max(1, symbolSize - 4)));
    current = {
      codec: 'wasm-raptorq',
      decoder: null,
      dedup: new Set(),
      receivedPackets: 0,
      totalGenerations: h.totalGenerations,
      sourceGenerations: sourceSymbols,
      dataLength: h.dataLength,
      symbolSize,
      qrVersion: decoded.version,
      isText: h.isText,
      isCompressed: h.compressed,
      completed: false,
      stats: { totalFrames: 0, framesWithQR: 0, acceptedPackets: 0 },
    };
  }

  if (current.codec !== 'wasm-raptorq') {
    reportCodecMismatch('wasm-raptorq');
    return false;
  }

  if (current.completed) return true;

  if (countFrame) {
    current.stats.totalFrames++;
  }

  if (packet.payload.length !== current.symbolSize) {
    throw new Error(
      `RaptorQ payload size changed from ${current.symbolSize} to ${packet.payload.length} bytes. ` +
      'Restart the scan before switching QR size.',
    );
  }

  current.totalGenerations = h.totalGenerations;
  current.dataLength = h.dataLength;
  current.sourceGenerations = Math.max(
    1,
    Math.ceil(h.dataLength / Math.max(1, current.symbolSize - 4)),
  );
  current.qrVersion = decoded.version;
  current.isText = h.isText;
  current.isCompressed = h.compressed;
  current.stats.framesWithQR++;

  const dedupKey = raptorQPayloadId(packet.payload);
  if (current.dedup.has(dedupKey)) return true;
  current.dedup.add(dedupKey);
  current.stats.acceptedPackets++;
  current.receivedPackets++;

  try {
    if (!current.decoder) {
      current.decoder = await RaptorQWasmDecoder.create(current.dataLength, current.symbolSize);
    }
    const preprocessed = current.decoder.push(packet.payload);
    if (preprocessed) {
      completeDecodedPayload(current, preprocessed);
    }
  } catch (err: any) {
    if (!raptorqUnavailableReported) {
      raptorqUnavailableReported = true;
      self.postMessage({
        type: 'error',
        message: `RaptorQ WASM unavailable: ${err.message ?? String(err)}`,
      });
    }
  }

  return true;
}

// ─── Reconstruct original data from all source symbols ────────────────────────

function reconstructData(state: RlncDecodeState): void {
  const decoder = state.decoder;

  // Build solved generations map for assemblePayload
  const solvedMap = new Map<number, Uint8Array[]>();
  for (const genIdx of Array.from(state.solvedGenerations)) {
    const symbols = decoder.getSourceSymbols(genIdx);
    if (!symbols) {
      self.postMessage({
        type: 'error',
        message: `Generation ${genIdx} reported solved but has no source symbols`,
      });
      return;
    }
    solvedMap.set(genIdx, symbols.map((s) => new Uint8Array(s)));
  }

  // Use assemblePayload which handles outer RS recovery
  let preprocessed: Uint8Array;
  try {
    preprocessed = assemblePayload(
      solvedMap,
      state.totalGenerations,
      state.dataLength,
      state.symbolSize,
    );
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      message: `Reassembly failed: ${err.message ?? String(err)}`,
    });
    return;
  }

  completeDecodedPayload(state, preprocessed);
}

function completeDecodedPayload(
  state: Pick<DecodeState, 'isText' | 'isCompressed' | 'completed'>,
  preprocessed: Uint8Array,
): void {
  // Decompress if needed
  let finalData: Uint8Array;
  if (state.isCompressed) {
    try {
      finalData = inflateSync(preprocessed);
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: 'Decompression failed — data may be corrupted',
      });
      return;
    }
  } else {
    finalData = preprocessed;
  }

  // Parse optional filename/mime metadata for file mode
  let filename = '';
  let mime = 'application/octet-stream';

  if (!state.isText) {
    try {
      if (finalData.length >= 2) {
        const filenameLen = finalData[0]!;
        if (finalData.length >= 2 + filenameLen) {
          const mimeLen = finalData[1 + filenameLen]!;
          const metaEnd = 2 + filenameLen + mimeLen;
          if (finalData.length >= metaEnd) {
            filename = new TextDecoder().decode(finalData.slice(1, 1 + filenameLen));
            mime = new TextDecoder().decode(finalData.slice(2 + filenameLen, metaEnd));
            finalData = finalData.slice(metaEnd);
          }
        }
      }
    } catch {
      // If metadata parsing fails, treat everything as raw data
    }
  }

  if (state.isText) {
    const text = new TextDecoder().decode(finalData);
    self.postMessage({
      type: 'complete',
      isText: true,
      text,
      autoStop: true,
    });
  } else {
    self.postMessage(
      {
        type: 'complete',
        isText: false,
        data: finalData.buffer,
        filename: filename || `recovered-${Date.now().toString(36)}`,
        mime: mime || 'application/octet-stream',
        autoStop: true,
      },
      { transfer: [finalData.buffer as ArrayBuffer] },
    );
  }

  state.completed = true;
}

// ─── Progress reporting ──────────────────────────────────────────────────────────

function reportProgress(state: DecodeState): void {
  const totalGens = state.totalGenerations;
  const solvedGens = state.codec === 'js-rlnc'
    ? state.solvedGenerations.size
    : state.completed ? 1 : 0;
  const decodedPackets = state.stats.framesWithQR;
  const uniquePackets = state.dedup.size;
  const needed = state.codec === 'js-rlnc'
    ? state.sourceGenerations > 0 ? K * state.sourceGenerations : 0
    : state.sourceGenerations;

  self.postMessage({
    type: 'progress',
    totalFrames: state.stats.totalFrames,
    framesWithQR: decodedPackets,
    uniquePackets,
    duplicatePackets: Math.max(0, decodedPackets - uniquePackets),
    acceptedPackets: state.stats.acceptedPackets,
    neededPackets: needed,
    receivedPackets: state.receivedPackets,
    solvedGenerations: solvedGens,
    totalGenerations: totalGens,
    sourceGenerations: state.sourceGenerations,
    dataLength: state.dataLength,
    symbolSize: state.symbolSize,
    qrVersion: state.qrVersion,
    fecCodec: state.codec,
    status: state.codec === 'wasm-raptorq'
      ? `Receiving RaptorQ (${uniquePackets}/${needed} packets)`
      : totalGens > 0
      ? `Receiving (${solvedGens}/${state.sourceGenerations} gens)`
      : 'Receiving…',
  });
}

function codecAllowed(codec: TransportCodec): boolean {
  return receiverFecCodec === 'auto' || receiverFecCodec === codec;
}

function reportCodecMismatch(codec: TransportCodec): void {
  if (codecMismatchReported) return;
  codecMismatchReported = true;
  self.postMessage({
    type: 'error',
    message: `Received ${codec} packet while FEC codec is set to ${receiverFecCodec}.`,
  });
}

function raptorQPayloadId(payload: Uint8Array): string {
  if (payload.length < 4) {
    throw new Error('RaptorQ packet payload is too short for a payload id.');
  }
  return `${payload[0]}:${payload[1]}:${payload[2]}:${payload[3]}`;
}
