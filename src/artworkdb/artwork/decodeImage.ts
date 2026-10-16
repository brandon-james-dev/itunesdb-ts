import type { ItdbRawImage } from './types.js';

/**
 * A pluggable image decoder that converts encoded image data
 * (JPEG, PNG, WebP, etc.) into raw RGBA pixels.
 *
 * Implementations vary by runtime:
 * - **Browser**: use `createImageBitmap` + `OffscreenCanvas`
 * - **Node**: use `sharp`, `@napi-rs/canvas`, or the built-in `decodeImageNode`
 * - **Tauri**: use the `image` crate via a Tauri command
 *
 * The library ships a Node implementation and a browser implementation
 * that can be imported separately.
 */
export interface ItdbImageDecoder {
  /**
   * Decode an image buffer (JPEG, PNG, WebP, BMP, GIF, TIFF, etc.)
   * into raw RGBA pixel data.
   *
   * @param data     - The encoded image bytes.
   * @param mimeType - Optional MIME type hint (e.g. `"image/jpeg"`).
   * @returns An {@link ItdbRawImage} with RGBA pixel data.
   */
  decode(data: Uint8Array, mimeType?: string): Promise<ItdbRawImage>;
}

/**
 * Detect the MIME type of an image from its magic bytes.
 *
 * @param data - The first few bytes of the image file.
 * @returns The detected MIME type, or `"application/octet-stream"` if unknown.
 */
export function detectImageMimeType(data: Uint8Array): string {
  if (data[0] === 0xFF && data[1] === 0xD8) return 'image/jpeg';
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return 'image/png';
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp';
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif';
  if (data[0] === 0x42 && data[1] === 0x4D) return 'image/bmp';
  return 'application/octet-stream';
}

/**
 * A minimal pure-JS JPEG decoder for cross-runtime use.
 *
 * This is intentionally not included — JPEG decoding is complex.
 * Instead, use one of the runtime-specific decoders below.
 * This function throws with guidance on which decoder to use.
 */
export function requireDecoder(): never {
  throw new Error(
    'No image decoder available. Supply an ItdbImageDecoder implementation:\n' +
    '  - Browser: import { createBrowserImageDecoder } from "itunesdb-ts/artwork/browserDecoder"\n' +
    '  - Node:    import { createNodeImageDecoder } from "itunesdb-ts/artwork/nodeDecoder"\n' +
    '  - Tauri:   implement ItdbImageDecoder using the image crate'
  );
}
