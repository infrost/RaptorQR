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
     * Side module count from the latest `render_matrix()` call.
     */
    last_matrix_size(): number;
    /**
     * Total capacity of the matrix buffer in bytes.
     */
    matrix_len(): number;
    /**
     * Raw pointer to the start of the 0/1 module matrix buffer.
     */
    matrix_ptr(): number;
    /**
     * Allocate the renderer and its fixed buffers once.
     */
    constructor();
    /**
     * Backward-compatible alias for the previous wrapper API.
     * This is exactly `render_rgba()`: it outputs RGBA pixels into the fixed
     * RGBA buffer and returns the side pixel count.
     */
    render(data: Uint8Array, version: number, ecc: number, scale: number): number;
    /**
     * Generate a QR code in-place and write its raw module matrix to the
     * fixed matrix buffer.
     *
     * Matrix values are one byte per module: 0 = light, 1 = dark.  The matrix
     * does not include quiet-zone modules.  The valid byte region is
     * `[matrix_ptr .. matrix_ptr + sideMods*sideMods)`.
     */
    render_matrix(data: Uint8Array, version: number, ecc: number): number;
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
    render_rgba(data: Uint8Array, version: number, ecc: number, scale: number): number;
    /**
     * Total capacity of the RGBA buffer in bytes.
     */
    rgba_len(): number;
    /**
     * Explicit raw pointer to the start of the RGBA buffer.
     */
    rgba_ptr(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_qrrenderer_free: (a: number, b: number) => void;
    readonly qrrenderer_buf_len: (a: number) => number;
    readonly qrrenderer_buf_ptr: (a: number) => number;
    readonly qrrenderer_last_matrix_size: (a: number) => number;
    readonly qrrenderer_matrix_len: (a: number) => number;
    readonly qrrenderer_matrix_ptr: (a: number) => number;
    readonly qrrenderer_new: () => number;
    readonly qrrenderer_render: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly qrrenderer_render_matrix: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly qrrenderer_render_rgba: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly qrrenderer_rgba_len: (a: number) => number;
    readonly qrrenderer_rgba_ptr: (a: number) => number;
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
