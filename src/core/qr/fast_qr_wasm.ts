/**
 * TypeScript wrapper for the fast_qr WASM module.
 *
 * Each Worker that needs a `QrRenderer` should call `ensureFastQrWasm()` once,
 * then instantiate `new QrRenderer()` from this module.  The WASM linear memory
 * is exposed via `getFastQrWasmMemory()` so callers can build a zero-copy
 * view after each `render_rgba()` or `render_matrix()` call.
 *
 * If the WASM artifacts have not been built yet (stub JS throws on init),
 * callers surface a controlled unavailable error.
 *
 * @module
 */

import init, { QrRenderer } from '@/fast_qr_wasm/wasm/qrstream_fast_qr_wasm.js';
import type { InitOutput } from '@/fast_qr_wasm/wasm/qrstream_fast_qr_wasm.js';

// ─── Module-level singleton ───────────────────────────────────────────────────

let initPromise: Promise<void> | null = null;
let wasmOutput: InitOutput | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function fastQrUnavailableMessage(): string {
  return (
    'fast_qr WASM artifacts are not installed. ' +
    'Run src/fast_qr_wasm/build_fast_qr_wasm_colab.py in Google Colab, ' +
    'then copy the generated files into src/fast_qr_wasm/wasm.'
  );
}

/**
 * Initialise the WASM module exactly once per Worker context.
 * Resolves immediately on subsequent calls.  Rejects if the artifacts are
 * missing (stub build) — callers should handle the rejection gracefully.
 */
export async function ensureFastQrWasm(): Promise<void> {
  if (!initPromise) {
    initPromise = Promise.resolve(init()).then((output: InitOutput) => {
      wasmOutput = output;
    }).catch((err: unknown) => {
      // Allow retry on next call
      initPromise = null;
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  await initPromise;
}

/**
 * Returns true after `ensureFastQrWasm()` has resolved successfully.
 * Use this for diagnostics and tests.
 */
export function isFastQrAvailable(): boolean {
  return wasmOutput !== null;
}

/**
 * Returns the WASM linear memory object.
 * Must only be called after `ensureFastQrWasm()` has resolved.
 *
 * The buffer view (`memory.buffer`) may change if the WASM heap grows, so
 * always re-read it after each `render()` call rather than caching the reference.
 */
export function getFastQrWasmMemory(): WebAssembly.Memory {
  if (!wasmOutput) {
    throw new Error('fast_qr WASM not initialized — call ensureFastQrWasm() first.');
  }
  return wasmOutput.memory;
}

// Re-export the class so workers only need one import.
export { QrRenderer };
