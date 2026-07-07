import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import init, {
  RaptorQDecoder,
  encode_packets,
  initSync,
} from '../src/raptorq/wasm/qrstream_raptorq_wasm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const wasmPath = resolve(
  repoRoot,
  'src/raptorq/wasm/qrstream_raptorq_wasm_bg.wasm',
);

const transportPayloadSize = 256;
const repairPercent = 30;
const symbolSize = transportPayloadSize - 4;
const sourceSymbols = 32;
const payload = deterministicPayload(symbolSize * sourceSymbols - 37);

try {
  await verifyGeneratedExports();
  await initWasm();

  const packets = Array.from(
    encode_packets(payload, transportPayloadSize, repairPercent),
    (packet) => new Uint8Array(packet),
  );

  assert(packets.length > 0, 'encode_packets returned no packets');
  assert(
    packets.every((packet) => packet.length <= transportPayloadSize),
    'an encoded packet exceeds the configured transport payload size',
  );

  const uniquePayloadIds = new Set(packets.map(payloadIdHex));
  assert(
    uniquePayloadIds.size === packets.length,
    `encoded packets contain duplicate RaptorQ payload ids (${uniquePayloadIds.size}/${packets.length})`,
  );

  const decoder = new RaptorQDecoder(payload.length, transportPayloadSize);
  let decoded = null;

  for (const packet of packets) {
    decoded = decoder.push(packet);
    if (decoded) break;
  }

  assert(decoded instanceof Uint8Array, 'decoder did not complete after all encoded packets');
  assertBytesEqual(
    payload,
    decoded.slice(0, payload.length),
    'decoded payload does not match original input',
  );

  console.log('RaptorQ WASM verification passed');
  console.log(`wasm: ${wasmPath}`);
  console.log(`input bytes: ${payload.length}`);
  console.log(`packets: ${packets.length}`);
  console.log(`transport payload size: ${transportPayloadSize}`);
  console.log(`repair overhead: ${repairPercent}%`);
} catch (err) {
  console.error('RaptorQ WASM verification failed');
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

async function verifyGeneratedExports() {
  assert(existsSync(wasmPath), `missing wasm artifact: ${wasmPath}`);
  assert(typeof init === 'function', 'generated default init export is missing');
  assert(typeof initSync === 'function', 'generated initSync export is missing');
  assert(typeof encode_packets === 'function', 'generated encode_packets export is missing');
  assert(typeof RaptorQDecoder === 'function', 'generated RaptorQDecoder export is missing');
}

async function initWasm() {
  const wasmBytes = await readFile(wasmPath);
  try {
    initSync({ module: wasmBytes });
  } catch (syncErr) {
    try {
      await init({ module_or_path: wasmBytes });
    } catch (asyncErr) {
      throw new Error(
        'failed to initialize generated wasm artifact: ' +
          `${messageOf(syncErr)}; async fallback: ${messageOf(asyncErr)}`,
      );
    }
  }
}

function deterministicPayload(length) {
  const data = new Uint8Array(length);
  let state = 0x12345678;
  for (let i = 0; i < data.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    data[i] = (state >>> 16) & 0xff;
  }
  return data;
}

function payloadIdHex(packet) {
  assert(packet.length >= 4, 'encoded packet is shorter than the 4-byte payload id');
  return Array.from(packet.slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertBytesEqual(expected, actual, message) {
  assert(actual.length === expected.length, `${message}: length ${actual.length} !== ${expected.length}`);
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${message}: byte ${i} is ${actual[i]}, expected ${expected[i]}`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}
