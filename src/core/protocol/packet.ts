/**
 * Transport packet serialization and deserialization.
 *
 * Fixed 8-byte header (all multi-byte fields are little-endian):
 *
 * | Offset | Size | Field              | Description                          |
 * |--------|------|--------------------|--------------------------------------|
 * | 0      | 1    | magic              | 0x51 ('Q')                           |
 * | 1      | 4    | packed_word        | see packWord / unpackWord below      |
 * | 5      | 3    | data_length        | 24-bit unsigned (0–16,777,215)       |
 * | 8      | N    | payload            | selected profile symbol bytes        |
 * | 8+N    | 4    | packet_crc32c      | CRC32C over bytes 0–7 + payload      |
 *
 * packed_word layout (32 bits, little-endian):
 *   bits 0–11:   generationIndex   (12 bits, 0–4095)
 *   bits 12–23:  totalGenerations  (12 bits, 0–4095)
 *   bits 24–28:  symbolIndex       (5 bits, 0–31)
 *   bit 29:      isText            (1 = text, 0 = file)
 *   bit 30:      isLastGeneration  (1 = last generation in transfer)
 *   bit 31:      compressed        (1 = deflate-raw compressed)
 *
 * Symbol index convention:
 *   0–15   = systematic symbol (sourceIndex = symbolIndex)
 *   16–23  = coded symbol (codedSymbolIndex = symbolIndex - 16)
 *   31     = RaptorQ WASM packet sentinel
 *   other values are reserved
 *
 * @module
 */

import { MAGIC_BYTE, HEADER_SIZE, CRC32C_SIZE, RAPTORQ_SYMBOL_INDEX } from './constants';
import { crc32c } from './crc32c';

export type TransportCodec = 'js-rlnc' | 'wasm-raptorq';

// ─── Little-endian helpers ───────────────────────────────────────────────────

function writeUint24LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
}

function readUint24LE(data: Uint8Array, offset: number): number {
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16)) >>> 0;
}

function writeUint32LE(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    ((data[offset + 3]! << 24) >>> 0)
  ) >>> 0;
}

// ─── Packed word helpers ─────────────────────────────────────────────────────

function packWord(
  generationIndex: number,
  totalGenerations: number,
  symbolIndex: number,
  isText: boolean,
  isLastGeneration: boolean,
  compressed: boolean,
): number {
  let word = 0;
  word |= (generationIndex & 0xfff);
  word |= (totalGenerations & 0xfff) << 12;
  word |= (symbolIndex & 0x1f) << 24;
  word |= (isText ? 1 : 0) << 29;
  word |= (isLastGeneration ? 1 : 0) << 30;
  word |= (compressed ? 1 : 0) << 31;
  return word >>> 0;
}

function unpackWord(word: number): {
  generationIndex: number;
  totalGenerations: number;
  symbolIndex: number;
  isText: boolean;
  isLastGeneration: boolean;
  compressed: boolean;
} {
  const w = word >>> 0;
  return {
    generationIndex: w & 0xfff,
    totalGenerations: (w >>> 12) & 0xfff,
    symbolIndex: (w >>> 24) & 0x1f,
    isText: ((w >>> 29) & 1) !== 0,
    isLastGeneration: ((w >>> 30) & 1) !== 0,
    compressed: ((w >>> 31) & 1) !== 0,
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Decoded packet header fields. */
export interface PacketHeader {
  generationIndex: number;
  totalGenerations: number;
  symbolIndex: number;
  isText: boolean;
  isLastGeneration: boolean;
  compressed: boolean;
  dataLength: number;
}

/** A fully parsed packet with header and payload. */
export interface Packet {
  header: PacketHeader;
  payload: Uint8Array;
}

// ─── Serialization ───────────────────────────────────────────────────────────

/** Serialize a PacketHeader into an 8-byte fixed header buffer. */
export function serializeHeader(header: PacketHeader): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE);
  buf[0] = MAGIC_BYTE;
  const word = packWord(
    header.generationIndex,
    header.totalGenerations,
    header.symbolIndex,
    header.isText,
    header.isLastGeneration,
    header.compressed,
  );
  writeUint32LE(buf, 1, word);
  writeUint24LE(buf, 5, header.dataLength);
  return buf;
}

/** Deserialize an 8-byte header buffer into a PacketHeader. */
export function parseHeader(data: Uint8Array): PacketHeader {
  if (data.length < HEADER_SIZE) {
    throw new Error(
      `Packet too short for header: ${data.length} bytes, need ${HEADER_SIZE}`,
    );
  }
  if (data[0] !== MAGIC_BYTE) {
    throw new Error(
      `Invalid magic byte: expected 0x51, got 0x${data[0]!.toString(16)}`,
    );
  }
  const unpacked = unpackWord(readUint32LE(data, 1));
  return {
    ...unpacked,
    dataLength: readUint24LE(data, 5),
  };
}

/** Serialize a complete transport packet (header + payload + CRC32C trailer). */
export function createPacket(header: PacketHeader, payload: Uint8Array): Uint8Array {
  const headerBytes = serializeHeader(header);
  const totalLen = HEADER_SIZE + payload.length + CRC32C_SIZE;
  const packet = new Uint8Array(totalLen);
  packet.set(headerBytes, 0);
  packet.set(payload, HEADER_SIZE);

  const crcInput = new Uint8Array(HEADER_SIZE + payload.length);
  crcInput.set(headerBytes, 0);
  crcInput.set(payload, HEADER_SIZE);
  writeUint32LE(packet, HEADER_SIZE + payload.length, crc32c(crcInput));

  return packet;
}

/** Deserialize and validate a complete transport packet. */
export function parsePacket(data: Uint8Array): Packet {
  if (data.length < HEADER_SIZE + CRC32C_SIZE) {
    throw new Error(
      `Packet too short: ${data.length} bytes, need at least ${HEADER_SIZE + CRC32C_SIZE}`,
    );
  }

  const header = parseHeader(data);
  const payloadLen = data.length - HEADER_SIZE - CRC32C_SIZE;
  const payload = data.slice(HEADER_SIZE, HEADER_SIZE + payloadLen);

  const storedCrc = readUint32LE(data, HEADER_SIZE + payloadLen);
  const crcInput = new Uint8Array(HEADER_SIZE + payloadLen);
  crcInput.set(data.slice(0, HEADER_SIZE), 0);
  crcInput.set(payload, HEADER_SIZE);
  const computedCrc = crc32c(crcInput);

  if (storedCrc !== computedCrc) {
    throw new Error(
      `CRC32C mismatch: stored 0x${storedCrc.toString(16)}, computed 0x${computedCrc.toString(16)}`,
    );
  }

  return { header, payload };
}

export function packetCodec(header: PacketHeader): TransportCodec {
  return header.symbolIndex === RAPTORQ_SYMBOL_INDEX ? 'wasm-raptorq' : 'js-rlnc';
}
