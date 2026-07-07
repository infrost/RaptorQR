/**
 * Shared QR transfer profiles.
 *
 * The protocol does not carry the profile on the wire. The sender chooses a
 * symbol size from a profile; the receiver infers the active size from decoded
 * packets.
 */

import { CRC32C_SIZE, ECC_LEVEL, HEADER_SIZE, QR_VERSION } from './constants';
import { getMaxByteCapacity, type EccLevel } from '@/core/qr/qr_encode';

export interface QRTransferProfile {
  id: string;
  label: string;
  version: number;
  eccLevel: EccLevel;
  maxPacketSize: number;
  maxPayloadSize: number;
}

const PROFILE_SPECS: Array<{ version: number; eccLevel: EccLevel }> = [
  { version: QR_VERSION, eccLevel: ECC_LEVEL },
  { version: 15, eccLevel: 'M' },
  { version: 20, eccLevel: 'M' },
  { version: 25, eccLevel: 'M' },
  { version: 30, eccLevel: 'M' },
  { version: 35, eccLevel: 'M' },
  { version: 40, eccLevel: 'M' },
];

const DEFAULT_PROFILE_VERSION = 20;
const DEFAULT_PROFILE_ECC_LEVEL: EccLevel = 'M';

export const DEFAULT_QR_PROFILE_ID = profileId(
  DEFAULT_PROFILE_VERSION,
  DEFAULT_PROFILE_ECC_LEVEL,
);

export const QR_TRANSFER_PROFILES: QRTransferProfile[] = PROFILE_SPECS.map((spec) => {
  const maxPacketSize = getMaxByteCapacity(spec.version, spec.eccLevel);
  const maxPayloadSize = maxPacketSize - HEADER_SIZE - CRC32C_SIZE;

  return {
    id: profileId(spec.version, spec.eccLevel),
    label: `V${spec.version}-${spec.eccLevel}`,
    version: spec.version,
    eccLevel: spec.eccLevel,
    maxPacketSize,
    maxPayloadSize,
  };
});

export function getQRTransferProfile(id: string): QRTransferProfile {
  return (
    QR_TRANSFER_PROFILES.find((profile) => profile.id === id) ??
    QR_TRANSFER_PROFILES[0]!
  );
}

function profileId(version: number, eccLevel: EccLevel): string {
  return `v${version}-${eccLevel.toLowerCase()}`;
}
