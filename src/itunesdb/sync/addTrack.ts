import type { ItdbTrack } from '../track/types.js';
import type { ITunesDB } from '../database/ITunesDB.js';
import { dateToMac } from '../../common/constants/index.js';
import type { ItdbAddTrackParams } from './types.js';
import { detectFiletype, generateTrackLocation } from './generateTrackLocation.js';

/**
 * Add a new track to an in-memory {@link ITunesDB}.
 *
 * This creates the track record and adds it to the master
 * playlist. It does **not** write any files to disk — call
 * {@link writeDatabase} and copy the audio file separately.
 *
 * Unless `params.ipodPath` is given, a unique destination location on
 * the iPod is generated automatically (see
 * {@link generateTrackLocation}); pass `params.fileName` to keep a
 * specific file name. `params.audioData` (when provided) supplies the
 * extension via magic-byte sniffing and sets the recorded file size.
 *
 * The caller should extract metadata (title, artist, album art)
 * from the audio file before calling this function.  If
 * `artworkOverride` is provided it will be used; otherwise the
 * caller should have already prepared artwork data through the
 * artwork module.
 *
 * @param db     - The database to mutate.
 * @param params - Track metadata and file paths.
 * @returns The newly created {@link ItdbTrack}.
 */
export function addTrack(db: ITunesDB, params: ItdbAddTrackParams): ItdbTrack {
  // trackId comes from a single library-wide id counter (see Itdb.allocId).
  // Apple's own DBs draw trackIds and albumIds from ONE shared ascending
  // sequence in catalog space (2343 track, 2347 album, 2349 track …).
  // Using the shared counter keeps our ids in that space and guarantees a
  // track can never collide with an album id. If the caller didn't supply
  // one (e.g. unit tests calling addTrack directly), continue the sequence.
  const maxId = params.trackId ?? db.tracks.reduce((max, t) => Math.max(max, t.trackId), 0) + 1;
  const trackId = params.trackId ?? maxId;

  const now = dateToMac(new Date());
  // dbid must be unique per track: iTunes uses it as the album-grouping
  // key (libgpod master/album records are keyed by it). Deriving it as
  // (seconds << 32) | trackId collides when two tracks are added in the
  // same second with the same trackId (e.g. a clear()+add() batch where
  // trackId restarts at 1). The random counter below guarantees no two
  // tracks in a process share a dbid, matching iTunes' u64 uniqueness.
  const uniqueCounter = (Math.random() * 0xffff) & 0xffff;
  const dbid = (BigInt(Math.floor(Date.now() / 1000)) << 32n) | (BigInt(uniqueCounter) << 16n) | BigInt(trackId & 0xffff);

  const location = params.ipodPath ?? generateTrackLocation(db.tracks, params.audioData, params.fileName);

  const track: ItdbTrack = {
    trackId,
    visible: 1,
    filetype: detectFiletype(location),
    type: 0x0100, // bytes [00 01] at +0x1c/+0x1d — Apple's audio-track marker (type1=0, type2=1)
    compilation: 0,
    rating: 0,
    dateAdded: now,
    size: params.audioData?.length ?? 0,
    length: 0,
    trackNumber: params.trackNumber ?? 0,
    trackTotal: params.trackTotal ?? 0,
    year: params.year ?? 0,
    bitrate: 0,
    sampleRate: 0,
    volume: 0,
    startTime: 0,
    stopTime: 0,
    soundCheck: 0,
    playCount: 0,
    lastPlayed: 0,
    discNumber: params.discNumber ?? 0,
    discTotal: params.discTotal ?? 0,
    lastModified: now,
    bookmarkTime: 0,
    dbid,
    bpm: 0,
    artworkCount: 0,
    artworkSize: 0,
    mediatype: 1,
    seasonNumber: 0,
    episodeNumber: 0,
    albumId: 0,
    mhiiLink: 0,
    artistId: 0,
    composerId: 0,
    title: params.title,
    path: location,
    artist: params.artist,
    album: params.album,
    genre: params.genre,
    composer: params.composer,
    albumArtist: params.albumArtist,
    dataObjects: [],
    rawHeader: new Uint8Array(0),
  };

  db.tracks.push(track);

  if (db.playlists.length > 0) {
    db.playlists[0].items.push({
      trackId,
      timestamp: now,
      rawHeader: new Uint8Array(0),
    });
  }

  return track;
}
