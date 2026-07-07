/**
 * Production roundtrip test: mimics the production app flow.
 */
import { describe, it, expect } from 'vitest';
import { packetize } from '@/core/sender/packetizer';
import { scheduleFrames } from '@/core/sender/scheduler';
import { generateQRMatrix } from '@/core/qr/qr_encode';
import { rasterizeQR } from '@/core/qr/frame_raster';
import { createQRGif } from '@/core/gif/gif_render';
import { parseGif, renderGifFrame } from '@/core/gif/gif_parser';
import { decodeQRFromCanvas } from '@/core/qr/qr_decode';
import { parsePacket } from '@/core/protocol/packet';
import { GenerationDecoder } from '@/core/fec/rlnc_decoder';
import { assemblePayload } from '@/core/reconstruct/assemble';
import { inflateSync } from 'fflate';
import {
  K,
  MAX_PAYLOAD_SIZE,
  QR_VERSION,
  ECC_LEVEL,
  FRAME_DELAY_MS,
} from '@/core/protocol/constants';

describe('Production Roundtrip', () => {
  it('should transfer a binary payload via GIF with frame loss', async () => {
    const payload = new Uint8Array(500);
    crypto.getRandomValues(payload);

    const result = packetize(payload, false, true);

    const frames = scheduleFrames(result.packets, result.totalGenerations);

    // Build GIF (production path)
    const imageFrames: Uint8Array[] = [];
    let width = 0;
    let height = 0;
    for (const frame of frames) {
      const matrix = generateQRMatrix(frame, QR_VERSION, ECC_LEVEL);
      const imageData = rasterizeQR(matrix, 4);
      if (width === 0) {
        width = imageData.width;
        height = imageData.height;
      }
      imageFrames.push(new Uint8Array(imageData.data.buffer));
    }
    const gifBytes = createQRGif(imageFrames, FRAME_DELAY_MS, width, height);

    // Parse GIF (receiver file-upload path)
    const gifData = parseGif(gifBytes);

    // Decode with deterministic frame loss: drop every 5th frame (~20% loss)
    const keepIndices = new Set<number>();
    for (let i = 0; i < gifData.frames.length; i++) {
      if ((i + 1) % 5 !== 0) keepIndices.add(i);
    }

    const decoder = new GenerationDecoder(K, MAX_PAYLOAD_SIZE);
    const solvedGens = new Set<number>();

    for (let i = 0; i < gifData.frames.length; i++) {
      if (!keepIndices.has(i)) continue;

      const rgba = renderGifFrame(gifData, i);
      const imageData = new ImageData(rgba, gifData.width, gifData.height);
      const decodedQR = await decodeQRFromCanvas(imageData);
      if (!decodedQR) continue;

      const pkt = parsePacket(decodedQR.bytes);
      const isSystematic = pkt.header.symbolIndex < K;
      if (isSystematic) {
        decoder.addSystematicSymbol(pkt.header.generationIndex, pkt.payload, pkt.header.symbolIndex);
      } else {
        decoder.addCodedSymbol(pkt.header.generationIndex, pkt.payload, pkt.header.symbolIndex - K);
      }
      if (decoder.isSolved(pkt.header.generationIndex)) {
        solvedGens.add(pkt.header.generationIndex);
      }
    }

    expect(solvedGens.size).toBeGreaterThanOrEqual(result.sourceGenerations);

    const solvedMap = new Map<number, Uint8Array[]>();
    for (const genIdx of solvedGens) {
      solvedMap.set(genIdx, decoder.getSourceSymbols(genIdx)!);
    }

    const assembled = assemblePayload(solvedMap, result.totalGenerations, result.dataLength);
    const recovered = result.isCompressed ? inflateSync(assembled) : assembled;

    expect(recovered).toEqual(payload);
  });
});
