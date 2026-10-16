import type { ItdbPixelFormat } from '../../device/types.js';

/**
 * Encode RGBA pixel data into the iPod's native pixel format for an `.ithmb` file.
 *
 * The iPod stores thumbnails as raw pixel data in device-specific formats
 * (RGB565, RGB555, etc.). This function converts standard RGBA pixels
 * into the target format.
 *
 * @param rgba   - Source RGBA pixel data (4 bytes per pixel).
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @param format - Target pixel format (e.g. `'RGB565_LE'`).
 * @returns Encoded pixel data ready to write to an `.ithmb` file.
 */
export function encodePixels(rgba: Uint8Array, width: number, height: number, format: ItdbPixelFormat): Uint8Array {
  const pixelCount = width * height;

  switch (format) {
    case 'RGB565_LE':
    case 'RGB565_BE': {
      const out = new Uint8Array(pixelCount * 2);
      const le = format === 'RGB565_LE';
      for (let i = 0; i < pixelCount; i++) {
        const ri = i * 4;
        const r5 = (rgba[ri] >> 3) & 0x1F;
        const g6 = (rgba[ri + 1] >> 2) & 0x3F;
        const b5 = (rgba[ri + 2] >> 3) & 0x1F;
        const pixel = (r5 << 11) | (g6 << 5) | b5;
        const oi = i * 2;
        if (le) {
          out[oi] = pixel & 0xFF;
          out[oi + 1] = (pixel >> 8) & 0xFF;
        } else {
          out[oi] = (pixel >> 8) & 0xFF;
          out[oi + 1] = pixel & 0xFF;
        }
      }
      return out;
    }

    case 'RGB555_LE':
    case 'RGB555_BE':
    case 'REC_RGB555_LE': {
      const out = new Uint8Array(pixelCount * 2);
      const le = format !== 'RGB555_BE';
      for (let i = 0; i < pixelCount; i++) {
        const ri = i * 4;
        const r5 = (rgba[ri] >> 3) & 0x1F;
        const g5 = (rgba[ri + 1] >> 3) & 0x1F;
        const b5 = (rgba[ri + 2] >> 3) & 0x1F;
        const pixel = (r5 << 10) | (g5 << 5) | b5;
        const oi = i * 2;
        if (le) {
          out[oi] = pixel & 0xFF;
          out[oi + 1] = (pixel >> 8) & 0xFF;
        } else {
          out[oi] = (pixel >> 8) & 0xFF;
          out[oi + 1] = pixel & 0xFF;
        }
      }
      return out;
    }

    case 'RGB888_LE': {
      const out = new Uint8Array(pixelCount * 3);
      for (let i = 0; i < pixelCount; i++) {
        const ri = i * 4;
        const oi = i * 3;
        out[oi] = rgba[ri + 2];
        out[oi + 1] = rgba[ri + 1];
        out[oi + 2] = rgba[ri];
      }
      return out;
    }

    case 'UYVY_LE':
    case 'UYVY_BE': {
      const out = new Uint8Array(pixelCount * 2);
      const le = format === 'UYVY_LE';
      for (let i = 0; i < pixelCount; i += 2) {
        const ri1 = i * 4;
        const ri2 = Math.min(i + 1, pixelCount - 1) * 4;
        const y0 = Math.round(0.299 * rgba[ri1] + 0.587 * rgba[ri1 + 1] + 0.114 * rgba[ri1 + 2]);
        const y1 = Math.round(0.299 * rgba[ri2] + 0.587 * rgba[ri2 + 1] + 0.114 * rgba[ri2 + 2]);
        const u = Math.round(-0.169 * rgba[ri1] - 0.331 * rgba[ri1 + 1] + 0.500 * rgba[ri1 + 2] + 128);
        const v = Math.round(0.500 * rgba[ri1] - 0.419 * rgba[ri1 + 1] - 0.081 * rgba[ri1 + 2] + 128);
        const oi = i * 2;
        if (le) {
          out[oi] = clamp(u); out[oi + 1] = clamp(y0); out[oi + 2] = clamp(v); out[oi + 3] = clamp(y1);
        } else {
          out[oi] = clamp(y0); out[oi + 1] = clamp(u); out[oi + 2] = clamp(y1); out[oi + 3] = clamp(v);
        }
      }
      return out;
    }

    case 'I420_LE': {
      const yPlane = new Uint8Array(pixelCount);
      const uPlane = new Uint8Array(pixelCount / 4);
      const vPlane = new Uint8Array(pixelCount / 4);
      for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
          const ri = (j * width + i) * 4;
          const y = Math.round(0.299 * rgba[ri] + 0.587 * rgba[ri + 1] + 0.114 * rgba[ri + 2]);
          yPlane[j * width + i] = clamp(y);
          if (j % 2 === 0 && i % 2 === 0) {
            const ci = (j / 2) * (width / 2) + (i / 2);
            uPlane[ci] = clamp(Math.round(-0.169 * rgba[ri] - 0.331 * rgba[ri + 1] + 0.500 * rgba[ri + 2] + 128));
            vPlane[ci] = clamp(Math.round(0.500 * rgba[ri] - 0.419 * rgba[ri + 1] - 0.081 * rgba[ri + 2] + 128));
          }
        }
      }
      const out = new Uint8Array(pixelCount + pixelCount / 2);
      out.set(yPlane, 0);
      out.set(uPlane, pixelCount);
      out.set(vPlane, pixelCount + pixelCount / 4);
      return out;
    }

    default:
      throw new Error(`Unsupported pixel format: ${format as string}`);
  }
}

/**
 * Decode raw iPod pixel data back into RGBA.
 *
 * @param data   - Raw pixel data from an `.ithmb` file.
 * @param width  - Image width in pixels.
 * @param height - Image height in pixels.
 * @param format - Source pixel format.
 * @returns RGBA pixel data (4 bytes per pixel).
 */
export function decodePixels(data: Uint8Array, width: number, height: number, format: ItdbPixelFormat): Uint8Array {
  const pixelCount = width * height;
  const rgba = new Uint8Array(pixelCount * 4);

  switch (format) {
    case 'RGB565_LE':
    case 'RGB565_BE': {
      const le = format === 'RGB565_LE';
      for (let i = 0; i < pixelCount; i++) {
        const di = i * 2;
        const pixel = le
          ? (data[di] | (data[di + 1] << 8))
          : ((data[di] << 8) | data[di + 1]);
        const r = ((pixel >> 11) & 0x1F) << 3;
        const g = ((pixel >> 5) & 0x3F) << 2;
        const b = (pixel & 0x1F) << 3;
        const oi = i * 4;
        rgba[oi] = r; rgba[oi + 1] = g; rgba[oi + 2] = b; rgba[oi + 3] = 255;
      }
      return rgba;
    }

    case 'RGB555_LE':
    case 'RGB555_BE':
    case 'REC_RGB555_LE': {
      const le = format !== 'RGB555_BE';
      for (let i = 0; i < pixelCount; i++) {
        const di = i * 2;
        const pixel = le
          ? (data[di] | (data[di + 1] << 8))
          : ((data[di] << 8) | data[di + 1]);
        const r = ((pixel >> 10) & 0x1F) << 3;
        const g = ((pixel >> 5) & 0x1F) << 3;
        const b = (pixel & 0x1F) << 3;
        const oi = i * 4;
        rgba[oi] = r; rgba[oi + 1] = g; rgba[oi + 2] = b; rgba[oi + 3] = 255;
      }
      return rgba;
    }

    case 'RGB888_LE': {
      for (let i = 0; i < pixelCount; i++) {
        const di = i * 3;
        const oi = i * 4;
        rgba[oi] = data[di + 2]; rgba[oi + 1] = data[di + 1]; rgba[oi + 2] = data[di]; rgba[oi + 3] = 255;
      }
      return rgba;
    }

    default:
      throw new Error(`Unsupported pixel format for decode: ${format as string}`);
  }
}

const clamp = (v: number): number => Math.max(0, Math.min(255, v));
