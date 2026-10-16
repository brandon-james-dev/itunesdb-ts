/**
 * An image item parsed from `mhii`.
 * Links to the iTunesDB via `songId` (matches ItdbTrack.dbid)
 * or `imageId` (matches ItdbTrack.mhiiLink).
 */
export interface ItdbImageItem {
  imageId: number;
  songId: bigint;
  rating: number;
  originalDate: number;
  digitizedDate: number;
  originalImageSize: number;
  thumbnails: ItdbThumbnail[];
  rawHeader: Uint8Array;
}

/**
 * Thumbnail info parsed from `mhni`.
 * Points to raw pixel data inside an `.ithmb` file.
 */
export interface ItdbThumbnail {
  formatId: number;
  itmbOffset: number;
  imageSize: number;
  verticalPadding: number;
  horizontalPadding: number;
  imageHeight: number;
  imageWidth: number;
  filename: string;
  rawHeader: Uint8Array;
}

/**
 * File info parsed from `mhif`.
 * Describes the artwork format and image size for an `.ithmb` file.
 */
export interface ItdbFileInfo {
  formatId: number;
  imageSize: number;
  rawHeader: Uint8Array;
}
