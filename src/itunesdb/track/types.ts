/**
 * A parsed MHOD (data object) from an iTunesDB.
 */
export interface ItdbDataObject {
  type: number;
  /** For string types: the decoded string value. */
  stringValue?: string;
  /** For non-string types: raw body bytes. */
  rawBody?: Uint8Array;
}

/**
 * A single track (song) parsed from an `mhit` + its `mhod` children.
 */
export interface ItdbTrack {
  trackId: number;
  visible: number;
  filetype: number;
  type: number;
  /** Byte at mhit+0x1c — Apple writes 0 for regular audio. */
  type1?: number;
  /** Byte at mhit+0x1d — Apple writes 1 for regular audio (2 for video). */
  type2?: number;
  compilation: number;
  rating: number;
  dateAdded: number;
  size: number;
  length: number;
  trackNumber: number;
  trackTotal: number;
  year: number;
  bitrate: number;
  sampleRate: number;
  volume: number;
  startTime: number;
  stopTime: number;
  soundCheck: number;
  playCount: number;
  lastPlayed: number;
  discNumber: number;
  discTotal: number;
  lastModified: number;
  bookmarkTime: number;
  dbid: bigint;
  bpm: number;
  artworkCount: number;
  artworkSize: number;
  /** +0x90 — libgpod writes 0x000c for audio tracks (unk144). */
  unk144?: number;
  /** +0xa8 — libgpod sets dbid2 = dbid (the track's second database id). */
  dbid2?: bigint;
  /** Apple/libgpod set this to 0x01 when the track has artwork (0xA4 byte). */
  hasArtwork?: number;
  mediatype: number;
  seasonNumber: number;
  episodeNumber: number;
  albumId: number;
  /**
   * The 64-bit library id (mirror of mhbd+0x24). Apple writes the same value
   * here as in the header for every track; libgpod reads and re-writes it.
   * Needed for Apple's tools to accept the database.
   */
  libraryId?: bigint;
  mhiiLink: number;
  artistId: number;
  composerId: number;
  title?: string;
  path?: string;
  album?: string;
  artist?: string;
  genre?: string;
  fileTypeString?: string;
  comment?: string;
  composer?: string;
  grouping?: string;
  description?: string;
  albumArtist?: string;
  sortTitle?: string;
  sortAlbum?: string;
  sortArtist?: string;
  sortAlbumArtist?: string;
  sortComposer?: string;
  /** All parsed MHOD data objects keyed by type. */
  dataObjects: ItdbDataObject[];
  /** Raw header bytes preserved for round-trip fidelity. */
  rawHeader: Uint8Array;
}
