import type { ItdbDataObject } from '../track/types.js';

/**
 * An album record parsed from `mhia`.
 */
export interface ItdbAlbum {
  albumId: number;
  dbid: bigint;
  albumName?: string;
  artistName?: string;
  dataObjects: ItdbDataObject[];
  rawHeader: Uint8Array;
}
