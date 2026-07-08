/* @ts-self-types="./qrstream_fast_qr_wasm.d.ts" */

export class QrRenderer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        QrRendererFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_qrrenderer_free(ptr, 0);
    }
    /**
     * Total capacity of the buffer in bytes (not the valid region — use
     * `sidePx * sidePx * 4` after `render()` to get the valid byte count).
     * @returns {number}
     */
    buf_len() {
        const ret = wasm.qrrenderer_buf_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Raw pointer to the start of the RGBA buffer inside WASM linear memory.
     * Valid for the lifetime of this `QrRenderer` instance.
     * @returns {number}
     */
    buf_ptr() {
        const ret = wasm.qrrenderer_buf_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Side module count from the latest `render_matrix()` call.
     * @returns {number}
     */
    last_matrix_size() {
        const ret = wasm.qrrenderer_last_matrix_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Total capacity of the matrix buffer in bytes.
     * @returns {number}
     */
    matrix_len() {
        const ret = wasm.qrrenderer_matrix_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Raw pointer to the start of the 0/1 module matrix buffer.
     * @returns {number}
     */
    matrix_ptr() {
        const ret = wasm.qrrenderer_matrix_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Allocate the renderer and its fixed buffers once.
     */
    constructor() {
        const ret = wasm.qrrenderer_new();
        this.__wbg_ptr = ret;
        QrRendererFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Backward-compatible alias for the previous wrapper API.
     * This is exactly `render_rgba()`: it outputs RGBA pixels into the fixed
     * RGBA buffer and returns the side pixel count.
     * @param {Uint8Array} data
     * @param {number} version
     * @param {number} ecc
     * @param {number} scale
     * @returns {number}
     */
    render(data, version, ecc, scale) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.qrrenderer_render(retptr, this.__wbg_ptr, ptr0, len0, version, ecc, scale);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Generate a QR code in-place and write its raw module matrix to the
     * fixed matrix buffer.
     *
     * Matrix values are one byte per module: 0 = light, 1 = dark.  The matrix
     * does not include quiet-zone modules.  The valid byte region is
     * `[matrix_ptr .. matrix_ptr + sideMods*sideMods)`.
     * @param {Uint8Array} data
     * @param {number} version
     * @param {number} ecc
     * @returns {number}
     */
    render_matrix(data, version, ecc) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.qrrenderer_render_matrix(retptr, this.__wbg_ptr, ptr0, len0, version, ecc);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
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
     * @param {Uint8Array} data
     * @param {number} version
     * @param {number} ecc
     * @param {number} scale
     * @returns {number}
     */
    render_rgba(data, version, ecc, scale) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.qrrenderer_render_rgba(retptr, this.__wbg_ptr, ptr0, len0, version, ecc, scale);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Total capacity of the RGBA buffer in bytes.
     * @returns {number}
     */
    rgba_len() {
        const ret = wasm.qrrenderer_rgba_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Explicit raw pointer to the start of the RGBA buffer.
     * @returns {number}
     */
    rgba_ptr() {
        const ret = wasm.qrrenderer_rgba_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) QrRenderer.prototype[Symbol.dispose] = QrRenderer.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
    };
    return {
        __proto__: null,
        "./qrstream_fast_qr_wasm_bg.js": import0,
    };
}

const QrRendererFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_qrrenderer_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('qrstream_fast_qr_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
