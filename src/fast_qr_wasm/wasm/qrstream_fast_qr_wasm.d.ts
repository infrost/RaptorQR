/* tslint:disable */
/* eslint-disable */

export class QrRenderer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Total capacity of the buffer in bytes (not the valid region — use
     * `sidePx * sidePx * 4` after `render()` to get the valid byte count).
     */
    buf_len(): number;
    /**
     * Raw pointer to the start of the RGBA buffer inside WASM linear memory.
     * Valid for the lifetime of this `QrRenderer` instance.
     */
    buf_ptr(): number;
    /**
     * Allocate the renderer and its fixed buffer once.
     * No further heap allocation occurs inside `render()`.
     */
    constructor();
    /**
     * Generate a QR code in-place and write RGBA pixels to the fixed buffer.
     *
     * # Parameters
     * - `data`    – raw packet bytes to encode
     * - `version` – QR version 1-40
     * - `ecc`     – error correction level (0=L, 1=M, 2=Q, 3=H)
     * - `scale`   – pixels per module (1-8)
     *
     * # Returns
     * Side pixel count (`sidePx`).  The valid pixel region is
     * `[buf_ptr .. buf_ptr + sidePx*sidePx*4)`.
     *
     * Throws a `JsValue` error string on failure.
     */
    render(data: Uint8Array, version: number, ecc: number, scale: number): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_qrrenderer_free: (a: number, b: number) => void;
    readonly qrrenderer_buf_len: (a: number) => number;
    readonly qrrenderer_buf_ptr: (a: number) => number;
    readonly qrrenderer_new: () => number;
    readonly qrrenderer_render: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
