/* tslint:disable */
/* eslint-disable */

export class RaptorQDecoder {
    free(): void;
    [Symbol.dispose](): void;
    constructor(data_len: number, max_transport_payload_size: number);
    push(serialized_packet: Uint8Array): any;
}

export function encode_packets(data: Uint8Array, max_transport_payload_size: number, repair_percent: number): Array<any>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_raptorqdecoder_free: (a: number, b: number) => void;
    readonly encode_packets: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly raptorqdecoder_new: (a: number, b: number, c: number) => void;
    readonly raptorqdecoder_push: (a: number, b: number, c: number, d: number) => void;
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
