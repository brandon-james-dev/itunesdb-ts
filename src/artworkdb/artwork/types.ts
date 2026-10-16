/**
 * Raw RGBA pixel data for an artwork image.
 * This is the cross-runtime interchange format: all pixel
 * manipulation operates on RGBA before encoding to the device's
 * native pixel format.
 */
export interface ItdbRawImage {
  width: number;
  height: number;
  /** RGBA pixel data, 4 bytes per pixel, row-major. */
  pixels: Uint8Array;
}

/**
 * Options for preparing artwork for sync to an iPod.
 */
export interface ItdbArtworkOptions {
  /**
   * Override artwork image data (RGBA pixels).
   * When omitted, the sync engine will attempt to extract
   * album art from the audio file's metadata.
   */
  artworkImage?: ItdbRawImage;
}
