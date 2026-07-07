import { RAPTORQ_SYMBOL_INDEX } from '@/core/protocol/constants';
import { createPacket, type PacketHeader } from '@/core/protocol/packet';
import { encodeRaptorQPackets } from '@/core/fec/raptorq_wasm';
import {
  preprocessPayload,
  type PreprocessResult,
} from '@/core/sender/packetizer';

export interface RaptorQPacketizerResult {
  packets: Uint8Array[];
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
    totalGenerations: totalPackets,
    sourceGenerations,
    dataLength: preprocessed.dataLength,
    isText,
    isCompressed: preprocessed.isCompressed,
    symbolSize,
  };
}
