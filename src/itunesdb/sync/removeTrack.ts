import type { ITunesDB } from '../database/ITunesDB.js';

/**
 * Remove a track from an in-memory {@link ITunesDB} by track ID.
 *
 * Removes the track from the track list and from all playlists
 * that reference it. Does **not** delete files from disk.
 *
 * @param db      - The database to mutate.
 * @param trackId - The ID of the track to remove.
 * @returns `true` if the track was found and removed, `false` otherwise.
 */
export function removeTrack(db: ITunesDB, trackId: number): boolean {
  const idx = db.tracks.findIndex(t => t.trackId === trackId);
  if (idx === -1) return false;

  db.tracks.splice(idx, 1);

  for (const playlist of db.playlists) {
    playlist.items = playlist.items.filter(item => item.trackId !== trackId);
  }

  return true;
}
