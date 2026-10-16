/**
 * Mutable metadata fields accepted by `ITunesDB.updateTrack`.
 * Passed through verbatim to the track record; binary fields such as
 * `rawHeader`, `dbid`, `trackId` and `dataObjects` cannot be patched.
 */
export interface ItdbTrackUpdate {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  composer?: string;
  albumArtist?: string;
  grouping?: string;
  comment?: string;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  year?: number;
  rating?: number;
  sortTitle?: string;
  sortAlbum?: string;
  sortArtist?: string;
  sortAlbumArtist?: string;
  sortComposer?: string;
}

/**
 * One top-level `mhsd` section of the database, capturing the section's
 * role in the original file so the writer can reproduce the exact layout.
 *
 * Known kinds (`tracks`, `playlists`, `albums`) are re-generated from the
 * model on write; `raw` sections (unknown section types, e.g. the
 * string/container sections some iTunes versions write) are preserved
 * byte-for-byte so parsers never see an empty stub where content should be.
 */
export interface ItdbDbSection {
  /** The `mhsd` section index written at header offset +0x0C. */
  index: number;
  kind: 'tracks' | 'playlists' | 'albums' | 'raw';
  /** Full section bytes (including the mhsd header) — only for `raw`. */
  bytes?: Uint8Array;
}
