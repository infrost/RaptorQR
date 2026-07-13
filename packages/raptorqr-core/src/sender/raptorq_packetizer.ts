import { RAPTORQ_SYMBOL_INDEX } from '@raptorqr/core/protocol/constants';
import { createPacket, type PacketHeader } from '@raptorqr/core/protocol/packet';
import { encodeRaptorQPackets } from '@raptorqr/core/fec/raptorq_wasm';
import {
  preprocessPayload,
  type PreprocessResult,
} from '@raptorqr/core/sender/preprocess_payload';

const RAPTORQ_PAYLOAD_ID_BYTES = 4;
const RAPTORQ_MAX_SOURCE_SYMBOLS_PER_BLOCK = 56_403;

export interface RaptorQPacketIndexMetadata {
  sourcePacketIndices: number[];
  repairPacketIndices: number[];
}

export interface RaptorQPacketizerResult {
  packets: Uint8Array[];
  sourcePacketIndices: number[];
  repairPacketIndices: number[];
  totalGenerations: number;
  sourceGenerations: number;
  dataLength: number;
  isText: boolean;
  isCompressed: boolean;
  symbolSize: number;
}

export interface RaptorQPacketizerOptions {
  maxTransportPayloadSize: number;
  repairPercent: number;
}

export async function packetizeRaptorQ(
  data: Uint8Array,
  isText: boolean,
  compress: boolean,
  filename: string | undefined,
  mimeType: string | undefined,
  options: RaptorQPacketizerOptions,
): Promise<RaptorQPacketizerResult> {
  const preprocessed = preprocessPayload(data, isText, compress, filename, mimeType);
  const serializedPackets = await encodeRaptorQPackets(
    preprocessed.data,
    options.maxTransportPayloadSize,
    options.repairPercent,
  );

  return buildRaptorQTransportPackets(
    serializedPackets,
    preprocessed,
    isText,
    options.maxTransportPayloadSize,
  );
}

export function buildRaptorQTransportPackets(
  serializedPackets: Uint8Array[],
  preprocessed: PreprocessResult,
  isText: boolean,
  symbolSize: number,
): RaptorQPacketizerResult {
  const totalPackets = serializedPackets.length;
  const packetIndexMetadata = classifyRaptorQPackets(
    serializedPackets,
    preprocessed.dataLength,
    symbolSize,
  );
  const packets = serializedPackets.map((payload, index) => {
    const header: PacketHeader = {
      generationIndex: 0,
      totalGenerations: Math.min(totalPackets, 0xfff),
      symbolIndex: RAPTORQ_SYMBOL_INDEX,
      isText,
      isLastGeneration: index === totalPackets - 1,
      compressed: preprocessed.isCompressed,
      dataLength: preprocessed.dataLength,
    };
    return createPacket(header, payload);
  });

  const sourceGenerations = Math.max(
    1,
    Math.ceil(preprocessed.dataLength / Math.max(1, symbolSize - 4)),
  );

  return {
    packets,
    ...packetIndexMetadata,
    totalGenerations: totalPackets,
    sourceGenerations,
    dataLength: preprocessed.dataLength,
    isText,
    isCompressed: preprocessed.isCompressed,
    symbolSize,
  };
}

/**
 * Classify raw RaptorQ codec packets from their Payload IDs.
 *
 * Payload ID is four bytes: one source block number followed by a 24-bit ESI.
 * The source symbol count for each block is derived from the same RFC 6330
 * source-block geometry used by the WASM wrapper. This intentionally does not
 * assume that the packet array has one source prefix or copy packet payloads.
 */
export function classifyRaptorQPackets(
  serializedPackets: readonly Uint8Array[],
  dataLength: number,
  maxTransportPayloadSize: number,
): RaptorQPacketIndexMetadata {
  const sourceSymbolSize = maxTransportPayloadSize - RAPTORQ_PAYLOAD_ID_BYTES;
  if (!Number.isInteger(sourceSymbolSize) || sourceSymbolSize <= 0) {
    throw new RangeError(`Invalid RaptorQ transport payload size: ${maxTransportPayloadSize}`);
  }
  if (!Number.isInteger(dataLength) || dataLength < 0) {
    throw new RangeError(`Invalid RaptorQ data length: ${dataLength}`);
  }

  const totalSourceSymbols = Math.max(1, Math.ceil(dataLength / sourceSymbolSize));
  const sourceBlockCount = Math.max(
    1,
    Math.ceil(totalSourceSymbols / RAPTORQ_MAX_SOURCE_SYMBOLS_PER_BLOCK),
  );
  const largestBlockSourceCount = Math.ceil(totalSourceSymbols / sourceBlockCount);
  const smallestBlockSourceCount = largestBlockSourceCount - 1;
  const largerBlockCount = totalSourceSymbols - smallestBlockSourceCount * sourceBlockCount;

  const sourcePacketIndices: number[] = [];
  const repairPacketIndices: number[] = [];

  serializedPackets.forEach((payload, packetIndex) => {
    if (payload.length < RAPTORQ_PAYLOAD_ID_BYTES) {
      throw new Error(
        `RaptorQ packet ${packetIndex} is too short for a ${RAPTORQ_PAYLOAD_ID_BYTES}-byte Payload ID`,
      );
    }

    const sourceBlockNumber = payload[0]!;
    if (sourceBlockNumber >= sourceBlockCount) {
      throw new Error(
        `RaptorQ packet ${packetIndex} references source block ${sourceBlockNumber}, ` +
        `but the transfer has ${sourceBlockCount} source blocks`,
      );
    }

    const encodingSymbolId = (
      (payload[1]! << 16) |
      (payload[2]! << 8) |
      payload[3]!
    ) >>> 0;
    const sourceCountForBlock = sourceBlockNumber < largerBlockCount
      ? largestBlockSourceCount
      : smallestBlockSourceCount;

    if (encodingSymbolId < sourceCountForBlock) {
      sourcePacketIndices.push(packetIndex);
    } else {
      repairPacketIndices.push(packetIndex);
    }
  });

  return { sourcePacketIndices, repairPacketIndices };
}
