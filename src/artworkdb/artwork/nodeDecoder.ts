import type { ItdbRawImage } from './types.js';
import type { ItdbImageDecoder } from './decodeImage.js';

/**
 * Create an image decoder for Node.js that uses the `sharp` library.
 *
 * The `sharp` package must be installed separately (`npm install sharp`).
 * It supports JPEG, PNG, WebP, GIF, TIFF, AVIF, and SVG.
 *
 * @returns An {@link ItdbImageDecoder} for Node.js environments.
 *
 * @example
 * ```ts
 * import { createNodeImageDecoder } from 'itunesdb-ts';
 *
 * const decoder = createNodeImageDecoder();
 * const imageBytes = fs.readFileSync('cover.jpg');
 * const rawImage = await decoder.decode(new Uint8Array(imageBytes));
 * ```
 */
export function createNodeImageDecoder(): ItdbImageDecoder {
  return {
    async decode(data: Uint8Array, _mimeType?: string): Promise<ItdbRawImage> {
      let sharpFn: (input: Buffer) => {
        metadata(): Promise<{ width?: number; height?: number }>;
        ensureAlpha(): ReturnType<typeof sharpFn>;
        raw(): ReturnType<typeof sharpFn>;
        toBuffer(opts: { resolveWithObject: true }): Promise<{
          data: Buffer;
          info: { width: number; height: number };
        }>;
      };
      try {
        const mod = await import('sharp');
        sharpFn = mod.default as unknown as typeof sharpFn;
      } catch {
        throw new Error(
          'The "sharp" package is required for Node.js image decoding.\n' +
          'Install it with: npm install sharp'
        );
      }

      const image = sharpFn(Buffer.from(data));
      const { data: pixels, info } = await image
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      return {
        width: info.width,
        height: info.height,
        pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      };
    },
  };
}
