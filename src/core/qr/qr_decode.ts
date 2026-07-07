/**
 * QR code decoding wrapper.
 *
 * Uses the `jsQR` library to extract QR payloads from raw pixel data.
 * Handles binary data (bytes 0-255) by reading from chunk.bytes
 * instead of result.data which does UTF-8 decoding.
 */
import jsQR from 'jsqr';

export interface QrDecodeResult {
  bytes: Uint8Array;
  version: number;
}

/**
 * Extract raw bytes from a jsQR result.
 * Uses chunk.bytes (available in Byte mode) to preserve binary data
 * instead of result.data which does UTF-8 decoding and corrupts
 * byte values > 127.
 */
function extractBytes(result: { chunks?: Array<{ bytes?: number[]; text?: string; type?: string }> }): Uint8Array | null {
  if (!result.chunks || result.chunks.length === 0) return null;

  const parts: Uint8Array[] = [];
  for (const chunk of result.chunks) {
    if (chunk.bytes && chunk.bytes.length > 0) {
      parts.push(new Uint8Array(chunk.bytes));
    } else if (chunk.text && chunk.text.length > 0) {
      // Fallback for non-byte modes (numeric, alphanumeric)
      const bytes = new Uint8Array(chunk.text.length);
      for (let i = 0; i < chunk.text.length; i++) {
        bytes[i] = chunk.text.charCodeAt(i) & 0xff;
      }
      parts.push(bytes);
    }
  }

  if (parts.length === 0) return null;

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

/**
 * Decode a QR code from an `ImageData` object (e.g. from a `<canvas>`).
 *
 * Returns raw bytes and QR version. Returns null if no QR code is found.
 *
 * @param imageData  RGBA pixel data from a canvas (width × height × 4 bytes)
 * @param opts       Optional jsQR options (e.g. inversionAttempts)
 * @returns The decoded QR payload and version, or `null` if no QR code could be found/decoded.
 */
export function decodeQRFromCanvas(
  imageData: ImageData,
  opts?: { inversionAttempts?: 'attemptBoth' | 'dontInvert' | 'onlyInvert' | 'invertFirst' },
): QrDecodeResult | null {
  const result = jsQR(
    imageData.data,
    imageData.width,
    imageData.height,
    { inversionAttempts: opts?.inversionAttempts ?? 'attemptBoth' },
  );
  if (!result) return null;
  const bytes = extractBytes(result);
  return bytes ? { bytes, version: result.version } : null;
}

/**
 * Decode a QR code from a grayscale byte buffer.
 *
 * jsQR expects RGBA data, so each grayscale byte is replicated into
 * an RGBA pixel (R = G = B = gray, A = 255).
 *
 * @param grayBuffer  Flat luma array, length = width × height
 * @param width       Image width in pixels
 * @param height      Image height in pixels
 * @returns The decoded QR payload and version, or `null` if no QR code could be found/decoded.
 */
export function decodeQRFromBuffer(
  grayBuffer: Uint8Array,
  width: number,
  height: number,
): QrDecodeResult | null {
  if (grayBuffer.length !== width * height) {
    throw new Error(
      `Buffer size mismatch: expected ${width}×${height} = ${width * height} ` +
      `grayscale pixels, got ${grayBuffer.length}`,
    );
  }

  // Build RGBA buffer where each grayscale value becomes an identical R/G/B
  // with full opacity.
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < grayBuffer.length; i++) {
    const g = grayBuffer[i]!;
    const off = i * 4;
    rgba[off]     = g;  // R
    rgba[off + 1] = g;  // G
    rgba[off + 2] = g;  // B
    rgba[off + 3] = 255; // A
  }

  const result = jsQR(rgba, width, height, {
    inversionAttempts: 'attemptBoth',
  });
  if (!result) return null;
  const bytes = extractBytes(result);
  return bytes ? { bytes, version: result.version } : null;
}
