/**
 * QR matrix → pixel raster conversion.
 *
 * Takes a boolean QR code matrix and renders it to a flat pixel buffer
 * with a configurable scale factor and 4-module quiet zone.
 * No anti-aliasing — pure black-and-white output.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getQuietZone(): number {
  return 4; // modules of quiet zone on each side
}

function calcPixelSize(moduleCount: number, scale: number): number {
  return (moduleCount + getQuietZone() * 2) * scale;
}

// ---------------------------------------------------------------------------
// RGBA raster
// ---------------------------------------------------------------------------

/**
 * Rasterize a QR code matrix to RGBA pixel data.
 *
 * Each boolean module is rendered as `scale × scale` pixels.
 * A 4-module quiet zone (white) is added on all four sides.
 * Output is pure black (0,0,0,255) and white (255,255,255,255).
 *
 * @param matrix  QR module matrix where `true` is a dark module
 * @param scale   Pixels per module (default 3)
 * @returns       RGBA `ImageData` (non-premultiplied, 4 bytes per pixel)
 */
export function rasterizeQR(
  matrix: boolean[][],
  scale: number = 3,
): ImageData {
  if (!matrix.length || !matrix[0]!.length) {
    throw new Error('Empty QR matrix');
  }

  if (scale < 1) {
    throw new Error(`Scale must be ≥ 1, got ${scale}`);
  }

  const moduleCount = matrix.length;
  const qz = getQuietZone();
  const pxSize = calcPixelSize(moduleCount, scale);
  const totalPixels = pxSize * pxSize;
  const data = new Uint8ClampedArray(totalPixels * 4);

  for (let py = 0; py < pxSize; py++) {
    // Determine which module row this pixel falls into
    const rawRow = Math.floor(py / scale) - qz;
    const rowInBounds = rawRow >= 0 && rawRow < moduleCount;

    for (let px = 0; px < pxSize; px++) {
      const rawCol = Math.floor(px / scale) - qz;
      const colInBounds = rawCol >= 0 && rawCol < moduleCount;

      // Pixel is black only if it falls within the QR matrix and
      // the corresponding module is dark.
      const isBlack = rowInBounds && colInBounds && matrix[rawRow]![rawCol]!;

      const idx = (py * pxSize + px) * 4;
      if (isBlack) {
        data[idx]     = 0;   // R
        data[idx + 1] = 0;   // G
        data[idx + 2] = 0;   // B
        data[idx + 3] = 255; // A
      } else {
        data[idx]     = 255; // R
        data[idx + 1] = 255; // G
        data[idx + 2] = 255; // B
        data[idx + 3] = 255; // A
      }
    }
  }

  return new ImageData(data, pxSize, pxSize);
}

// ---------------------------------------------------------------------------
// Grayscale raster
// ---------------------------------------------------------------------------

/**
 * Rasterize a QR code matrix to a grayscale pixel buffer (single-channel).
 *
 * Same geometry and quiet-zone rules as `rasterizeQR`, but each pixel is
 * a single byte: 255 for white, 0 for black.
 *
 * @param matrix  QR module matrix
 * @param scale   Pixels per module (default 3)
 * @returns       `{ data, width, height }` — flat luma array
 */
export function rasterizeToGrayscale(
  matrix: boolean[][],
  scale: number = 3,
): { data: Uint8Array; width: number; height: number } {
  if (!matrix.length || !matrix[0]!.length) {
    throw new Error('Empty QR matrix');
  }

  if (scale < 1) {
    throw new Error(`Scale must be ≥ 1, got ${scale}`);
  }

  const moduleCount = matrix.length;
  const qz = getQuietZone();
  const pxSize = calcPixelSize(moduleCount, scale);
  const data = new Uint8Array(pxSize * pxSize);

  for (let py = 0; py < pxSize; py++) {
    const rawRow = Math.floor(py / scale) - qz;
    const rowInBounds = rawRow >= 0 && rawRow < moduleCount;

    for (let px = 0; px < pxSize; px++) {
      const rawCol = Math.floor(px / scale) - qz;
      const colInBounds = rawCol >= 0 && rawCol < moduleCount;

      const isBlack = rowInBounds && colInBounds && matrix[rawRow]![rawCol]!;
      data[py * pxSize + px] = isBlack ? 0 : 255;
    }
  }

  return { data, width: pxSize, height: pxSize };
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/**
 * Return the expected pixel dimensions for a QR matrix at a given scale.
 * Useful for pre-allocating buffers or setting canvas size.
 */
export function getRasterDimensions(
  moduleCount: number,
  scale: number,
): { width: number; height: number } {
  const pxSize = calcPixelSize(moduleCount, scale);
  return { width: pxSize, height: pxSize };
}
