import type { Binarizer } from 'zxing-wasm/reader';

export type DecodePresetId = 'fast' | 'balance' | 'robust' | 'custom';
export type MaxSymbolsMode = 'auto' | 1 | 2 | 4 | 6 | 8;
export type DownscaleFactor = 2 | 3 | 4;
export type QrBinarizer = Binarizer;

export interface QrDecodeSettings {
  maxSymbols: MaxSymbolsMode;
  binarizer: QrBinarizer;
  tryHarder: boolean;
  tryRotate: boolean;
  tryInvert: boolean;
  tryDownscale: boolean;
  downscaleFactor: DownscaleFactor;
}

export type DecodePresetSettings = Pick<
  QrDecodeSettings,
  'binarizer' | 'tryHarder' | 'tryRotate' | 'tryInvert'
>;

export const DECODE_PRESETS: Record<Exclude<DecodePresetId, 'custom'>, DecodePresetSettings> = {
  fast: {
    binarizer: 'GlobalHistogram',
    tryHarder: false,
    tryRotate: false,
    tryInvert: false,
  },
  balance: {
    binarizer: 'LocalAverage',
    tryHarder: false,
    tryRotate: false,
    tryInvert: false,
  },
  robust: {
    binarizer: 'LocalAverage',
    tryHarder: true,
    tryRotate: false,
    tryInvert: true,
  },
};

export const BINARIZER_OPTIONS: QrBinarizer[] = [
  'LocalAverage',
  'GlobalHistogram',
  'FixedThreshold',
  'BoolCast',
];

export const MAX_SYMBOL_OPTIONS: MaxSymbolsMode[] = ['auto', 1, 2, 4, 6, 8];
export const DOWNSCALE_FACTOR_OPTIONS: DownscaleFactor[] = [2, 3, 4];

export const DEFAULT_DECODE_PRESET: DecodePresetId = 'balance';

export const DEFAULT_DECODE_SETTINGS: QrDecodeSettings = {
  ...DECODE_PRESETS.balance,
  maxSymbols: 'auto',
  tryDownscale: true,
  downscaleFactor: 3,
};

export function normalizeDecodeSettings(input: Partial<QrDecodeSettings> | undefined): QrDecodeSettings {
  const next: QrDecodeSettings = {
    ...DEFAULT_DECODE_SETTINGS,
    ...input,
  };

  if (!BINARIZER_OPTIONS.includes(next.binarizer)) {
    next.binarizer = DEFAULT_DECODE_SETTINGS.binarizer;
  }
  if (!MAX_SYMBOL_OPTIONS.includes(next.maxSymbols)) {
    next.maxSymbols = DEFAULT_DECODE_SETTINGS.maxSymbols;
  }
  if (!DOWNSCALE_FACTOR_OPTIONS.includes(next.downscaleFactor)) {
    next.downscaleFactor = DEFAULT_DECODE_SETTINGS.downscaleFactor;
  }

  return next;
}
