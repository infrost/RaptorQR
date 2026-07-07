import init, {
  RaptorQDecoder,
  encode_packets,
} from '@/raptorq/wasm/qrstream_raptorq_wasm.js';

let initPromise: Promise<unknown> | null = null;

export function raptorQUnavailableMessage(): string {
  return 'RaptorQ WASM artifacts are not installed. Run src/raptorq/build_raptorq_wasm_colab.py in Google Colab, then copy the generated files into src/raptorq/wasm.';
}

export async function ensureRaptorQWasm(): Promise<void> {
  if (!initPromise) {
    initPromise = Promise.resolve(init()).catch((err) => {
      initPromise = null;
      throw normalizeRaptorQError(err);
    });
  }
  await initPromise;
}

export async function encodeRaptorQPackets(
  data: Uint8Array,
  maxTransportPayloadSize: number,
  repairPercent: number,
): Promise<Uint8Array[]> {
  await ensureRaptorQWasm();
  validateTransportPayloadSize(maxTransportPayloadSize);

  const packets = encode_packets(data, maxTransportPayloadSize, repairPercent);
  return Array.from(packets, (packet) => new Uint8Array(packet));
}

export class RaptorQWasmDecoder {
  private inner: RaptorQDecoder;

  private constructor(inner: RaptorQDecoder) {
    this.inner = inner;
  }

  static async create(
    dataLength: number,
    maxTransportPayloadSize: number,
  ): Promise<RaptorQWasmDecoder> {
    await ensureRaptorQWasm();
    validateTransportPayloadSize(maxTransportPayloadSize);
    return new RaptorQWasmDecoder(
      new RaptorQDecoder(dataLength, maxTransportPayloadSize),
    );
  }

  push(serializedPacket: Uint8Array): Uint8Array | null {
    const result = this.inner.push(serializedPacket);
    return result ? new Uint8Array(result) : null;
  }
}

function validateTransportPayloadSize(value: number): void {
  if (!Number.isInteger(value) || value <= 4) {
    throw new RangeError(
      `RaptorQ transport payload size must be an integer greater than 4 bytes, got ${value}`,
    );
  }
}

function normalizeRaptorQError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('RaptorQ WASM artifacts are not installed')) {
    return new Error(raptorQUnavailableMessage());
  }
  return err instanceof Error ? err : new Error(message);
}
