/**
 * GIF roundtrip: encode data into GIF frames, parse them back, decode.
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
import { K, MAX_PAYLOAD_SIZE, QR_VERSION, ECC_LEVEL, FRAME_DELAY_MS } from '@/core/protocol/constants';

describe('GIF Roundtrip', () => {
  it('should encode and decode a GIF', async () => {
    const data = new TextEncoder().encode('GIF roundtrip test data');
    const result = packetize(data, false, false);
    const frames = scheduleFrames(result.packets, result.totalGenerations);

    // Generate QR matrices and rasterize
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

    // Create GIF
    const gifBytes = createQRGif(imageFrames, FRAME_DELAY_MS, width, height);
    const gifData = parseGif(gifBytes);
    expect(gifData.frames.length).toBe(frames.length);

    // Decode frames from GIF
    const decoder = new GenerationDecoder(K, MAX_PAYLOAD_SIZE);
    const solvedGens = new Set<number>();

    for (let i = 0; i < gifData.frames.length; i++) {
      const rgba = renderGifFrame(gifData, i);
      const imageData = new ImageData(rgba, gifData.width, gifData.height);
      const decodedQR = await decodeQRFromCanvas(imageData);
      expect(decodedQR, `GIF frame ${i} failed QR decode`).not.toBeNull();

      const pkt = parsePacket(decodedQR!.bytes);
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
    const recovered = new TextDecoder().decode(assembled);
    expect(recovered).toBe('GIF roundtrip test data');
  });
});
