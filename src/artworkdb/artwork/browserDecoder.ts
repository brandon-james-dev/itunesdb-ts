import type { ItdbRawImage } from './types.js';
import type { ItdbImageDecoder } from './decodeImage.js';
import { detectImageMimeType } from './decodeImage.js';

/**
 * Create an image decoder that uses the browser's built-in
 * `createImageBitmap` and `OffscreenCanvas` APIs.
 *
 * Supports JPEG, PNG, WebP, GIF, BMP, and any other format
 * the browser natively supports.
 *
 * @returns An {@link ItdbImageDecoder} for browser environments.
 * @throws If `createImageBitmap` or `OffscreenCanvas` is not available.
 *
 * @example
 * ```ts
 * import { createBrowserImageDecoder } from 'itunesdb-ts';
 *
 * const decoder = createBrowserImageDecoder();
 * const imageBytes = new Uint8Array(await fetch(url).then(r => r.arrayBuffer()));
 * const rawImage = await decoder.decode(imageBytes);
 * ```
 */
export function createBrowserImageDecoder(): ItdbImageDecoder {
  return {
    async decode(data: Uint8Array, mimeType?: string): Promise<ItdbRawImage> {
      const detected = detectImageMimeType(data);
      const type = mimeType && mimeType !== 'application/octet-stream' ? mimeType : detected !== 'application/octet-stream' ? detected : 'image/png';
      const blob = new Blob([data as BlobPart], { type });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      // `imageData.data` is a Uint8ClampedArray; copying the exact byte range
      // avoids wrapping a larger-than-used ArrayBuffer (which would silently
      // read garbage past the image) and avoids an alloc error on huge images.
      const pixels = new Uint8Array(
        imageData.data.buffer,
        imageData.data.byteOffset,
        imageData.data.byteLength,
      );
      return {
        width: bitmap.width,
        height: bitmap.height,
        pixels,
      };
    },
  };
}
