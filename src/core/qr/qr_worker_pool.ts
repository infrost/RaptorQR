import type { EccLevel } from '@/core/qr/qr_encode';
import type { QREncoder } from '@/core/qr/qr_encoder_browser';

type RenderWorkerMessage =
  | {
      type: 'rendered';
      buffer: ArrayBuffer;
      width: number;
      height: number;
      jobId: number;
    }
  | {
      type: 'error';
      message: string;
      jobId: number;
    };

interface PendingJob {
  resolve: (imageData: ImageData) => void;
  reject: (err: Error) => void;
}

export class QrWorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<number, PendingJob>();
  private nextWorkerIndex = 0;
  private nextJobId = 1;
  private terminated = false;

  constructor(size: number) {
    const workerCount = Math.max(1, Math.floor(size));

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        new URL('@/workers/qr_render.worker.ts', import.meta.url),
        { type: 'module' },
      );

      worker.onmessage = (e: MessageEvent<RenderWorkerMessage>) => {
        const msg = e.data;
        const job = this.pending.get(msg.jobId);
        if (!job) return;

        this.pending.delete(msg.jobId);

        if (msg.type === 'error') {
          job.reject(new Error(msg.message));
          return;
        }

        const data = new Uint8ClampedArray(msg.buffer);
        job.resolve(new ImageData(data, msg.width, msg.height));
      };

      worker.onerror = (err) => {
        const error = new Error(err.message || 'QR render worker failed.');
        for (const [, job] of this.pending) {
          job.reject(error);
        }
        this.pending.clear();
      };

      this.workers.push(worker);
    }
  }

  render(
    packet: Uint8Array,
    version: number,
    ecc: EccLevel,
    scale: number,
    qrEncoder?: QREncoder,
  ): Promise<ImageData> {
    if (this.terminated) {
      return Promise.reject(new Error('QR worker pool has been terminated.'));
    }

    const worker = this.workers[this.nextWorkerIndex];
    if (!worker) {
      return Promise.reject(new Error('No QR render worker is available.'));
    }

    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

    const jobId = this.nextJobId++;
    const packetBuffer = copyToTransferableBuffer(packet);

    return new Promise<ImageData>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });

      worker.postMessage(
        {
          type: 'render',
          packet: packetBuffer,
          version,
          ecc,
          scale,
          qrEncoder,
          jobId,
        },
        [packetBuffer],
      );
    });
  }

  terminate(): void {
    if (this.terminated) return;

    this.terminated = true;

    for (const worker of this.workers) {
      worker.terminate();
    }

    this.workers = [];

    for (const [, job] of this.pending) {
      job.reject(new Error('QR worker pool was terminated.'));
    }

    this.pending.clear();
  }
}

function copyToTransferableBuffer(packet: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(packet.byteLength);
  copy.set(packet);
  return copy.buffer as ArrayBuffer;
}