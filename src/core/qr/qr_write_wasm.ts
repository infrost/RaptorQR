/**
 * QR code writer backed by ZXing-C++ WebAssembly.
 *
 * The wasm file is loaded from the bundled local asset, mirroring the reader
 * wrapper. This path is intended for high-throughput sender rendering where
 * generating QR symbols on the UI thread is too expensive.
 */

import {
  prepareZXingModule,
  writeBarcode,
  type BarcodeSymbol,
  type WriterOptions,
} from 'zxing-wasm/writer';
import zxingWriterWasmUrl from 'zxing-wasm/writer/zxing_writer.wasm?url';
import {
  getMaxZXingWriterByteCapacity,
  type EccLevel,
} from '@/core/qr/qr_encode';

let preparePromise: Promise<unknown> | null = null;

export async function renderQRCodeImageDataWithZXing(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  scale: number,
): Promise<ImageData> {
  const symbol = await writeQRCodeSymbolWithZXing(data, version, eccLevel, scale);

  const moduleCount = version * 4 + 17;
  if (symbol.width === moduleCount && symbol.height === moduleCount) {
    return rasterizeSymbolModules(symbol, scale);
  }

  const expectedSize = expectedQRPixelSize(version, scale);
  if (symbol.width === expectedSize && symbol.height === expectedSize) {
    return symbolPixelsToImageData(symbol);
  }

  throw new Error(
    `ZXing QR writer returned ${symbol.width}x${symbol.height}, ` +
    `expected ${moduleCount}x${moduleCount} modules or ${expectedSize}x${expectedSize} pixels ` +
    `for V${version}-${eccLevel} at scale ${scale}.`,
  );
}

export async function generateQRMatrixWithZXing(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
): Promise<boolean[][]> {
  const symbol = await writeQRCodeSymbolWithZXing(data, version, eccLevel, 1);
  return symbolToMatrix(symbol, version, eccLevel);
}

export async function writeQRCodeSymbolWithZXing(
  data: Uint8Array,
  version: number,
  eccLevel: EccLevel,
  scale: number,
): Promise<BarcodeSymbol> {
  validateQRCodeRenderOptions(version, eccLevel, scale, data.length);
  await prepareWriter();

  const options: WriterOptions = {
    format: 'QRCode',
    options: `version=${version},ecLevel=${eccLevel}`,
    scale,
    addQuietZones: true,
    addHRT: false,
  };
  const result = await writeBarcode(data, options);

  if (result.error) {
    throw new Error(`ZXing QR writer failed: ${result.error}`);
  }

  return result.symbol;
}

function prepareWriter(): Promise<unknown> {
  if (!preparePromise) {
    preparePromise = Promise.resolve(
      prepareZXingModule({
        overrides: {
          locateFile: (path) => path.endsWith('.wasm') ? zxingWriterWasmUrl : path,
        },
        equalityFn: Object.is,
        fireImmediately: true,
      }),
    );
  }
  return preparePromise;
}

function symbolToMatrix(
  symbol: BarcodeSymbol,
  version: number,
  eccLevel: EccLevel,
): boolean[][] {
  if (symbol.data.length !== symbol.width * symbol.height) {
    throw new Error(
      `ZXing QR symbol buffer size mismatch: ${symbol.data.length} bytes for ` +
      `${symbol.width}x${symbol.height}.`,
    );
  }

  const moduleCount = version * 4 + 17;
  let offset = 0;
  if (symbol.width === moduleCount && symbol.height === moduleCount) {
    offset = 0;
  } else if (
    symbol.width === moduleCount + 8 &&
    symbol.height === moduleCount + 8
  ) {
    offset = 4;
  } else {
    throw new Error(
      `ZXing QR writer returned ${symbol.width}x${symbol.height}, ` +
      `expected ${moduleCount}x${moduleCount} modules for V${version}-${eccLevel}.`,
    );
  }

  const matrix: boolean[][] = [];
  for (let y = 0; y < moduleCount; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < moduleCount; x++) {
      row.push(symbol.data[(y + offset) * symbol.width + x + offset] === 0);
    }
    matrix.push(row);
  }
  return matrix;
}

function symbolPixelsToImageData(symbol: BarcodeSymbol): ImageData {
  if (symbol.data.length !== symbol.width * symbol.height) {
    throw new Error(
      `ZXing QR symbol buffer size mismatch: ${symbol.data.length} bytes for ` +
      `${symbol.width}x${symbol.height}.`,
    );
  }

  const rgba = new Uint8ClampedArray(symbol.width * symbol.height * 4);
  for (let i = 0; i < symbol.data.length; i++) {
    const value = symbol.data[i] === 0 ? 0 : 255;
    const offset = i * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }

  return new ImageData(rgba, symbol.width, symbol.height);
}

function rasterizeSymbolModules(symbol: BarcodeSymbol, scale: number): ImageData {
  if (symbol.data.length !== symbol.width * symbol.height) {
    throw new Error(
      `ZXing QR symbol buffer size mismatch: ${symbol.data.length} bytes for ` +
      `${symbol.width}x${symbol.height}.`,
    );
  }

  const quietZoneModules = 4;
  const pixelSize = (symbol.width + quietZoneModules * 2) * scale;
  const rgba = new Uint8ClampedArray(pixelSize * pixelSize * 4);
  rgba.fill(255);

  for (let moduleY = 0; moduleY < symbol.height; moduleY++) {
    for (let moduleX = 0; moduleX < symbol.width; moduleX++) {
      if (symbol.data[moduleY * symbol.width + moduleX] !== 0) continue;

      const pixelX = (moduleX + quietZoneModules) * scale;
      const pixelY = (moduleY + quietZoneModules) * scale;
      for (let y = 0; y < scale; y++) {
        const rowStart = ((pixelY + y) * pixelSize + pixelX) * 4;
        for (let x = 0; x < scale; x++) {
          const offset = rowStart + x * 4;
          rgba[offset] = 0;
          rgba[offset + 1] = 0;
          rgba[offset + 2] = 0;
          rgba[offset + 3] = 255;
        }
      }
    }
  }

  return new ImageData(rgba, pixelSize, pixelSize);
}

function validateQRCodeRenderOptions(
  version: number,
  eccLevel: EccLevel,
  scale: number,
  dataLength?: number,
): void {
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new RangeError(`Invalid QR version: ${version}. Must be 1-40.`);
  }
  if (eccLevel !== 'L' && eccLevel !== 'M' && eccLevel !== 'Q' && eccLevel !== 'H') {
    throw new RangeError(`Invalid QR ECC level: ${eccLevel}.`);
  }
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError(`Invalid QR render scale: ${scale}.`);
  }
  if (dataLength !== undefined) {
    const maxBytes = getMaxZXingWriterByteCapacity(version, eccLevel);
    if (dataLength > maxBytes) {
      throw new Error(
        `Data too large for ZXing QR writer V${version}-${eccLevel}. ` +
        `Maximum ${maxBytes} bytes for binary Uint8Array payload, got ${dataLength}.`,
      );
    }
  }
}

function expectedQRPixelSize(version: number, scale: number): number {
  const moduleCount = version * 4 + 17;
  const quietZoneModules = 8;
  return (moduleCount + quietZoneModules) * scale;
}
