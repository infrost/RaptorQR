export type FecCodec = 'js-rlnc' | 'wasm-raptorq';
export type ReceiverFecCodec = 'auto' | FecCodec;

export const DEFAULT_FEC_CODEC: FecCodec = 'wasm-raptorq';
export const DEFAULT_RECEIVER_FEC_CODEC: ReceiverFecCodec = 'auto';
export const DEFAULT_RAPTORQ_REPAIR_PERCENT = 20;
export const MIN_RAPTORQ_REPAIR_PERCENT = 0;
export const MAX_RAPTORQ_REPAIR_PERCENT = 100;

export function normalizeFecCodec(value: unknown): FecCodec {
  return value === 'wasm-raptorq' ? 'wasm-raptorq' : DEFAULT_FEC_CODEC;
}

export function normalizeReceiverFecCodec(value: unknown): ReceiverFecCodec {
  if (value === 'auto' || value === 'js-rlnc' || value === 'wasm-raptorq') {
    return value;
  }
  return DEFAULT_RECEIVER_FEC_CODEC;
}

export function normalizeRaptorQRepairPercent(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RAPTORQ_REPAIR_PERCENT;
  return Math.min(
    MAX_RAPTORQ_REPAIR_PERCENT,
    Math.max(MIN_RAPTORQ_REPAIR_PERCENT, Math.round(parsed)),
  );
}

export function formatFecCodec(value: FecCodec | ReceiverFecCodec): string {
  if (value === 'auto') return 'Auto';
  return value === 'wasm-raptorq' ? 'RaptorQ WASM (exp)' : 'JS RLNC (compatible)';
}
