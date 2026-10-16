import type { ItdbArtworkFormat } from '../../device/types.js';
import type { ItdbRawImage } from '../artwork/types.js';
import type { ItdbImageItem, ItdbThumbnail } from '../database/types.js';
import type { ArtworkDB } from '../database/ArtworkDB.js';
import { resizeImage, rotateImage } from '../artwork/resizeImage.js';
import { encodePixels } from '../artwork/encodePixels.js';

/**
 * Encoded thumbnail data ready to append to an `.ithmb` file.
 */
export interface ItdbEncodedThumbnail {
  formatId: number;
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Prepare artwork thumbnails for a single image across all device formats.
 *
 * Takes the source RGBA image and the device's supported artwork
 * formats, and produces encoded pixel data for each format. The
 * caller is responsible for appending the data to the correct
 * `.ithmb` files and updating the ArtworkDB records.
 *
 * @param source  - Source RGBA image (e.g. album art extracted from metadata, or a user override).
 * @param formats - The device's artwork formats from {@link ItdbDeviceInfo.artworkFormats}.
 * @returns An array of encoded thumbnails, one per format.
 */
export function prepareThumbnails(source: ItdbRawImage, formats: ItdbArtworkFormat[]): ItdbEncodedThumbnail[] {
  // Defensive guard: never run resize/encode on a source bigger than we can
  // safely allocate. Both `resizeImage` and `encodePixels` allocate
  // width*height*4 bytes; any oversize here would throw a RangeError and abort
  // the whole sync. (A 4096*4096 source is 67 MB RGBA — far above any real
  // album art.)
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width * source.height > MAX_SOURCE_PIXELS
  ) {
    throw new RangeError(
      `refusing to resize ${source.width}x${source.height} image (over ${MAX_SOURCE_PIXELS} pixels)`,
    );
  }
  return formats.map(fmt => {
    let resized = resizeImage(source, fmt.width, fmt.height, fmt.crop);
    if (fmt.rotation !== 0) {
      resized = rotateImage(resized, fmt.rotation);
    }
    const data = encodePixels(resized.pixels, resized.width, resized.height, fmt.pixelFormat);
    return { formatId: fmt.formatId, data, width: fmt.width, height: fmt.height };
  });
}

/** Maximum pixels we will ever allocate for a decoded source image. */
export const MAX_SOURCE_PIXELS = 4096 * 4096;


/**
 * Add an image entry to the ArtworkDB for a given track.
 *
 * Creates or updates the `mhii` record and its `mhni` children.
 * The caller must have already written the raw pixel data to the
 * `.ithmb` files and have the offset/size information.
 *
 * @param artworkDb  - The ArtworkDB to mutate.
 * @param songDbid   - The track's `dbid` field (links mhii to mhit).
 * @param thumbnails - Thumbnail entries with offset/size data.
 */
export function addArtworkEntry(
  artworkDb: ArtworkDB,
  songDbid: bigint,
  thumbnails: Array<{ formatId: number; itmbOffset: number; imageSize: number; width: number; height: number; filename: string }>,
): void {
  const imageId = artworkDb.nextId;
  artworkDb.nextId++;

  const thumbRecords: ItdbThumbnail[] = thumbnails.map(t => ({
    formatId: t.formatId,
    itmbOffset: t.itmbOffset,
    imageSize: t.imageSize,
    verticalPadding: 0,
    horizontalPadding: 0,
    imageHeight: t.height,
    imageWidth: t.width,
    filename: t.filename,
    rawHeader: new Uint8Array(0),
  }));

  const imageItem: ItdbImageItem = {
    imageId,
    songId: songDbid,
    rating: 0,
    originalDate: 0,
    digitizedDate: 0,
    originalImageSize: 0,
    thumbnails: thumbRecords,
    rawHeader: new Uint8Array(0),
  };

  artworkDb.images.push(imageItem);

  for (const t of thumbnails) {
    const existing = artworkDb.fileInfos.find(fi => fi.formatId === t.formatId);
    if (!existing) {
      artworkDb.fileInfos.push({
        formatId: t.formatId,
        imageSize: t.imageSize,
        rawHeader: new Uint8Array(0),
      });
    }
  }
}
