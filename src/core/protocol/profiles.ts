/**
 * Shared QR transfer profiles.
 *
 * The protocol does not carry the profile on the wire. The sender chooses a
 * symbol size from a profile; the receiver infers the active size from decoded
 * packets.
 */

import { CRC32C_SIZE, HEADER_SIZE } from './constants';
import {
  getMaxByteCapacity,
  getMaxZXingWriterByteCapacity,
  type EccLevel,
} from '@/core/qr/qr_encode';
import { DEFAULT_QR_ENCODER, type QREncoder } from '@/core/qr/qr_encoder';

export interface QRTransferProfile {
  id: string;
  label: string;
  version: number;
  eccLevel: EccLevel;
  qrEncoder: QREncoder;
  maxPacketSize: number;
  maxPayloadSize: number;
}

export const QR_VERSION_OPTIONS = [10, 15, 20, 25, 30, 35, 40] as const;
export type QRVersionOption = typeof QR_VERSION_OPTIONS[number];

export const ECC_LEVEL_OPTIONS: EccLevel[] = ['L', 'M', 'Q', 'H'];

const PROFILE_SPECS: Array<{ version: number; eccLevel: EccLevel }> =
  QR_VERSION_OPTIONS.flatMap((version) =>
    ECC_LEVEL_OPTIONS.map((eccLevel) => ({ version, eccLevel })),
  );

export const DEFAULT_QR_VERSION: QRVersionOption = 20;
export const DEFAULT_QR_ECC_LEVEL: EccLevel = 'L';

export const DEFAULT_QR_PROFILE_ID = profileId(
  DEFAULT_QR_VERSION,
  DEFAULT_QR_ECC_LEVEL,
);

export const QR_TRANSFER_PROFILES: QRTransferProfile[] = PROFILE_SPECS.map((spec) =>
  createQRTransferProfile(spec.version, spec.eccLevel),
);

export function createQRTransferProfile(
  version: number,
  eccLevel: EccLevel,
  qrEncoder: QREncoder = DEFAULT_QR_ENCODER,
): QRTransferProfile {
  const normalizedVersion = normalizeQRVersion(version);
  const normalizedEccLevel = normalizeEccLevel(eccLevel);
  const maxPacketSize = qrEncoder === 'zxing-wasm'
    ? getMaxZXingWriterByteCapacity(normalizedVersion, normalizedEccLevel)
    : getMaxByteCapacity(normalizedVersion, normalizedEccLevel);
  const maxPayloadSize = maxPacketSize - HEADER_SIZE - CRC32C_SIZE;
  return {
    id: profileId(normalizedVersion, normalizedEccLevel),
    label: `V${normalizedVersion}-${normalizedEccLevel}`,
    version: normalizedVersion,
    eccLevel: normalizedEccLevel,
    qrEncoder,
    maxPacketSize,
    maxPayloadSize,
  };
}

export function getQRTransferProfile(id: string): QRTransferProfile {
  return (
    QR_TRANSFER_PROFILES.find((profile) => profile.id === id) ??
    QR_TRANSFER_PROFILES[0]!
  );
}

function profileId(version: number, eccLevel: EccLevel): string {
  return `v${version}-${eccLevel.toLowerCase()}`;
}

function normalizeQRVersion(value: number): QRVersionOption {
  return QR_VERSION_OPTIONS.includes(value as QRVersionOption)
    ? value as QRVersionOption
    : DEFAULT_QR_VERSION;
}

function normalizeEccLevel(value: EccLevel): EccLevel {
  return ECC_LEVEL_OPTIONS.includes(value) ? value : DEFAULT_QR_ECC_LEVEL;
}
