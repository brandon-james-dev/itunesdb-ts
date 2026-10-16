import type { ItdbDataObject } from '../track/types.js';

/**
 * A playlist parsed from `mhyp` + children.
 */
export interface ItdbPlaylist {
  playlistId: bigint;
  hidden: number;
  timestamp: number;
  sortOrder: number;
  name?: string;
  /**
   * The iTunesDB section (mhsd) index this playlist came from — 2 for the
   * standard playlist section, 3 and 5 for the optional special-playlist
   * sections. Set by the parser; new playlists default to 2. The writer
   * emits each section's playlists back into their own section.
   */
  mhsdIndex?: number;
  /**
   * Runtime flag (not part of the binary format) marking the master
   * playlist. Set by the high-level `Itdb` API on the first playlist.
   */
  isMaster?: boolean;
  items: ItdbPlaylistItem[];
  dataObjects: ItdbDataObject[];
  rawHeader: Uint8Array;
}

/**
 * A playlist item parsed from `mhip`.
 */
export interface ItdbPlaylistItem {
  trackId: number;
  timestamp: number;
  rawHeader: Uint8Array;
  /**
   * Child MHODs of the mhip. iTunes writes a type-100 MHOD holding the
   * track's position in the playlist; the writer regenerates it when the
   * item has no preserved children.
   */
  objects?: ItdbDataObject[];
}
