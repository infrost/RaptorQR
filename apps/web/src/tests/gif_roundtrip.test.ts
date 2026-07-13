/**
 * GIF roundtrip: encode data into GIF frames, parse them back, decode.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_RAPTORQ_REPAIR_PERCENT } from '@raptorqr/core/fec/codec';
import { RaptorQWasmDecoder } from '@raptorqr/core/fec/raptorq_wasm';
import { renderQRCodeImageData } from '@raptorqr/core/qr/qr_encoder_browser';
import { createQRGif } from '@raptorqr/core/gif/gif_render';
import { parseGif, renderGifFrame } from '@raptorqr/core/gif/gif_parser';
import { decodeQRFromCanvas } from '@raptorqr/core/qr/qr_decode';
import { parsePacket } from '@raptorqr/core/protocol/packet';
import { MAX_PAYLOAD_SIZE, QR_VERSION, ECC_LEVEL, FRAME_DELAY_MS } from '@raptorqr/core/protocol/constants';
import { packetizeRaptorQ } from '@raptorqr/core/sender/raptorq_packetizer';
import { createRaptorQPlaybackOrders } from '@raptorqr/core/sender/raptorq_playback';

describe('GIF Roundtrip', () => {
  it('should encode and decode a GIF', async () => {
    const data = new TextEncoder().encode('GIF roundtrip test data');
    const result = await packetizeRaptorQ(
      data,
      false,
      false,
      undefined,
      undefined,
      {
        maxTransportPayloadSize: MAX_PAYLOAD_SIZE,
        repairPercent: DEFAULT_RAPTORQ_REPAIR_PERCENT,
      },
    );
    const { loopOrder } = createRaptorQPlaybackOrders(
      result.sourcePacketIndices,
      result.repairPacketIndices,
      'balanced',
    );
    const frames = loopOrder.map((packetIndex) => result.packets[packetIndex]!);
    expect(loopOrder).toHaveLength(result.packets.length);

    // Generate QR image frames
    const imageFrames: Uint8Array[] = [];
    let width = 0;
    let height = 0;
    for (const frame of frames) {
      const imageData = await renderQRCodeImageData(frame, QR_VERSION, ECC_LEVEL, 4, 'fast-qr-wasm');
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

    const decoder = await RaptorQWasmDecoder.create(result.dataLength, MAX_PAYLOAD_SIZE);
    let decoded: Uint8Array | null = null;

    for (let i = 0; i < gifData.frames.length; i++) {
      const rgba = renderGifFrame(gifData, i);
      const imageData = new ImageData(rgba, gifData.width, gifData.height);
      const decodedQR = await decodeQRFromCanvas(imageData);
      expect(decodedQR, `GIF frame ${i} failed QR decode`).not.toBeNull();

      const pkt = parsePacket(decodedQR!.bytes);
      decoded = decoder.push(pkt.payload);
      if (decoded) break;
    }

    expect(decoded).not.toBeNull();
    const recovered = new TextDecoder().decode(decoded!.slice(0, result.dataLength));
    expect(recovered).toBe('GIF roundtrip test data');
  });
});
