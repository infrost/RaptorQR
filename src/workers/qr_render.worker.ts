/**
 * Live sender QR renderer.
 *
 * Renders packet QR tiles off the UI thread using the selected QR encoder.
 * The main thread keeps a bounded cache and only composites ready tiles onto
 * the visible canvas.
 */

import {
  normalizeQREncoder,
  renderQRCodeImageData,
  type QREncoder,
} from '@/core/qr/qr_encoder_browser';
import type { EccLevel } from '@/core/qr/qr_encode';

interface RenderTileTask {
  packetIndex: number;
  packet: Uint8Array;
}

interface RenderTilesInput {
  type: 'renderTiles';
  requestId: number;
  qrVersion: number;
  eccLevel: EccLevel;
  qrEncoder?: QREncoder;
  tiles: RenderTileTask[];
}

interface TileOutput {
  type: 'tile';
  requestId: number;
  packetIndex: number;
  imageData: ImageData;
}

interface DoneOutput {
  type: 'done';
  requestId: number;
}

interface ErrorOutput {
  type: 'error';
  requestId: number;
  packetIndex?: number;
  message: string;
}

self.onmessage = (e: MessageEvent<RenderTilesInput>) => {
  const msg = e.data;
  if (msg.type !== 'renderTiles') return;

  void renderTiles(msg);
};

async function renderTiles(input: RenderTilesInput): Promise<void> {
  const qrEncoder = normalizeQREncoder(input.qrEncoder);
  for (const tile of input.tiles) {
    try {
      const imageData = await renderQRCodeImageData(
        tile.packet,
        input.qrVersion,
        input.eccLevel,
        1,
        qrEncoder,
      );
      self.postMessage(
        {
          type: 'tile',
          requestId: input.requestId,
          packetIndex: tile.packetIndex,
          imageData,
        } satisfies TileOutput,
        { transfer: [imageData.data.buffer as ArrayBuffer] },
      );
    } catch (err: any) {
      self.postMessage({
        type: 'error',
        requestId: input.requestId,
        packetIndex: tile.packetIndex,
        message: err.message ?? String(err),
      } satisfies ErrorOutput);
    }
  }

  self.postMessage({ type: 'done', requestId: input.requestId } satisfies DoneOutput);
}
