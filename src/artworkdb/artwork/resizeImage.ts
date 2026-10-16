import type { ItdbRawImage } from './types.js';

/**
 * Resize an RGBA image to the target dimensions using nearest-neighbor
 * interpolation. This is a pure-JS implementation that works across
 * all runtimes (browser, Node, Tauri) without any native dependencies.
 *
 * When `crop` is true the image is scaled to cover the target area and
 * the excess is trimmed from the center. When false the image is scaled
 * to fit inside the target dimensions (aspect-ratio preserved) and
 * padded with black.
 *
 * @param source      - Source RGBA image.
 * @param targetWidth - Desired output width.
 * @param targetHeight - Desired output height.
 * @param crop        - Whether to crop-to-fill (true) or fit-and-pad (false).
 * @returns A new {@link ItdbRawImage} at the target dimensions.
 */
export function resizeImage(
  source: ItdbRawImage,
  targetWidth: number,
  targetHeight: number,
  crop: boolean,
): ItdbRawImage {
  const out = new Uint8Array(targetWidth * targetHeight * 4);

  if (crop) {
    const scale = Math.max(targetWidth / source.width, targetHeight / source.height);
    const srcW = Math.round(targetWidth / scale);
    const srcH = Math.round(targetHeight / scale);
    const srcX = Math.round((source.width - srcW) / 2);
    const srcY = Math.round((source.height - srcH) / 2);

    for (let dy = 0; dy < targetHeight; dy++) {
      for (let dx = 0; dx < targetWidth; dx++) {
        const sx = srcX + Math.round(dx * srcW / targetWidth);
        const sy = srcY + Math.round(dy * srcH / targetHeight);
        const si = (Math.min(sy, source.height - 1) * source.width + Math.min(sx, source.width - 1)) * 4;
        const di = (dy * targetWidth + dx) * 4;
        out[di] = source.pixels[si];
        out[di + 1] = source.pixels[si + 1];
        out[di + 2] = source.pixels[si + 2];
        out[di + 3] = source.pixels[si + 3];
      }
    }
  } else {
    const scale = Math.min(targetWidth / source.width, targetHeight / source.height);
    const fitW = Math.round(source.width * scale);
    const fitH = Math.round(source.height * scale);
    const offsetX = Math.round((targetWidth - fitW) / 2);
    const offsetY = Math.round((targetHeight - fitH) / 2);

    for (let dy = 0; dy < fitH; dy++) {
      for (let dx = 0; dx < fitW; dx++) {
        const sx = Math.round(dx * source.width / fitW);
        const sy = Math.round(dy * source.height / fitH);
        const si = (Math.min(sy, source.height - 1) * source.width + Math.min(sx, source.width - 1)) * 4;
        const di = ((dy + offsetY) * targetWidth + (dx + offsetX)) * 4;
        out[di] = source.pixels[si];
        out[di + 1] = source.pixels[si + 1];
        out[di + 2] = source.pixels[si + 2];
        out[di + 3] = source.pixels[si + 3];
      }
    }
  }

  return { width: targetWidth, height: targetHeight, pixels: out };
}

/**
 * Rotate an RGBA image clockwise by the specified number of degrees.
 * Only 0, 90, 180, and 270 are supported.
 *
 * @param source  - Source RGBA image.
 * @param degrees - Rotation angle (0, 90, 180, or 270).
 * @returns A new rotated {@link ItdbRawImage}.
 */
export function rotateImage(source: ItdbRawImage, degrees: number): ItdbRawImage {
  const norm = ((degrees % 360) + 360) % 360;
  if (norm === 0) return source;

  let outW: number, outH: number;
  if (norm === 90 || norm === 270) {
    outW = source.height;
    outH = source.width;
  } else {
    outW = source.width;
    outH = source.height;
  }

  const out = new Uint8Array(outW * outH * 4);

  for (let sy = 0; sy < source.height; sy++) {
    for (let sx = 0; sx < source.width; sx++) {
      let dx: number, dy: number;
      if (norm === 90) { dx = source.height - 1 - sy; dy = sx; }
      else if (norm === 180) { dx = source.width - 1 - sx; dy = source.height - 1 - sy; }
      else { dx = sy; dy = source.width - 1 - sx; }

      const si = (sy * source.width + sx) * 4;
      const di = (dy * outW + dx) * 4;
      out[di] = source.pixels[si];
      out[di + 1] = source.pixels[si + 1];
      out[di + 2] = source.pixels[si + 2];
      out[di + 3] = source.pixels[si + 3];
    }
  }

  return { width: outW, height: outH, pixels: out };
}
