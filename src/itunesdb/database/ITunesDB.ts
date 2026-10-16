import type { ItdbTrackUpdate, ItdbDbSection } from './types.js';
import { parseDatabase } from './parseDatabase.js';
import { writeDatabase } from './writeDatabase.js';
import { addTrack } from '../sync/addTrack.js';
import { removeTrack } from '../sync/removeTrack.js';
import type { ItdbAddTrackParams } from '../sync/types.js';
import { extractEmbeddedArtwork } from '../metadata/extractEmbeddedArtwork.js';
import { dateToMac } from '../../common/constants/index.js';
import { resolveRoot, joinRootPath } from '../../common/fs/root.js';
import type { ItdbRootHandle, ItdbResolvedRoot } from '../../common/fs/root.js';
import { createDefaultFs, createDefaultImageDecoder } from '../../common/env.js';
import { ITUNESDB_FILE_RELATIVE_PATH } from '../constants/index.js';
import type { ItdbTrack } from '../track/types.js';
import type { ItdbPlaylist, ItdbPlaylistItem } from '../playlist/types.js';
import type { ItdbAlbum } from '../album/types.js';
import type { ItdbImageDecoder } from '../../artworkdb/artwork/decodeImage.js';

/**
 * Data fields of a parsed iTunesDB (the `mhbd` record and all children).
 *
 * This interface is merged with the `ITunesDB` class: a parsed database
 * is a single object that carries these fields directly on the instance
 * (e.g. `db.tracks`) while also offering the class methods. It is also
 * the structural shape the `write()`/`writeDatabase()` serializers read.
 */
export interface ITunesDB {
  version: number;
  numChildren: number;
  dbId: bigint;
  platform: number;
  languageId: number;
  persistentId: bigint;
  /**
   * +0x24: the library id. Apple writes the SAME 64-bit value here and
   * mirrored into every track at +0x124. Apple's parser validates the
   * track mirror against this header value; required for Apple's tools.
   */
  libraryId?: bigint;
  /**
   * mhbd header words at +0x50 / +0x54. Apple writes 1 and 13 on this
   * device; libgpod reads and preserves both ("unknown: seen 0x05 / 0x4d
   * for nano 3G"). Early versions of this writer dropped them (0/0), which
   * is a structural delta Apple's parser can reject.
   */
  unk_0x50?: number;
  unk_0x54?: number;
  tracks: ItdbTrack[];
  playlists: ItdbPlaylist[];
  albums: ItdbAlbum[];
  /**
   * Top-level `mhsd` section layout of the parsed file, in file order.
   * Known kinds are re-generated on write; unknown sections are preserved
   * verbatim. `writeDatabase` uses this to reproduce the original layout
   * instead of inventing empty placeholder sections.
   */
  sections: ItdbDbSection[];
  /** Raw header bytes preserved for round-trip fidelity. */
  rawHeader: Uint8Array;
}

export interface ITunesDBOptions {
  root?: ItdbRootHandle;
  imageDecoder?: ItdbImageDecoder;
}

export interface ItdbResolvedRootWithPath extends ItdbResolvedRoot {
  databasePath: string;
}

/**
 * A parsed iTunesDB.
 *
 * Two ways to create one:
 * - `await ITunesDB.open(root, opts)` — resolves the root
 *   handle ({@link ItdbRootHandle}), reads `iPod_Control/iTunes/iTunesDB`
 *   from it, and throws if the file is missing.
 * - `ITunesDB.parse(buffer)` or the standalone `parseDatabase(buffer)` —
 *   for in-memory buffers.
 *
 * The parsed data fields (see the merged `ITunesDB` interface) live
 * directly on the instance. Entity methods cover tracks, playlists and
 * albums; `addTrack` pulls embedded album art from audio metadata
 * automatically; `save()` writes the database back to the root it was
 * opened from. Implements the `Disposable` protocol (`using` releases
 * the in-memory records).
 */
export class ITunesDB implements Disposable {
  readonly root: ItdbResolvedRootWithPath | null;
  private readonly imageDecoder?: ItdbImageDecoder;

  constructor(data: ITunesDB, options: ITunesDBOptions = {}) {
    Object.assign(this, data);
    if (options.root) {
      const resolved = resolveRoot(options.root);
      this.root = {
        fs: resolved.fs,
        rootPath: resolved.rootPath,
        databasePath: joinRootPath(resolved.rootPath, ITUNESDB_FILE_RELATIVE_PATH),
      };
    } else {
      this.root = null;
    }
    this.imageDecoder = options.imageDecoder ?? createDefaultImageDecoder();
  }

  /**
   * Open an iTunesDB from a root handle, reading the database file
   * from the device root directory. Throws if the file is not found.
   *
   * `root` is optional — when omitted the runtime is inferred
   * automatically (Node: auto-detected iPod mount or the working
   * directory; browser: a `showDirectoryPicker()` prompt). The
   * `imageDecoder` is also inferred, so `await ITunesDB.open()` works
   * with zero configuration.
   */
  static async open(root: ItdbRootHandle | undefined = undefined, options: Pick<ITunesDBOptions, 'imageDecoder'> = {}): Promise<ITunesDB> {
    const resolved = root ? resolveRoot(root) : { fs: await createDefaultFs(), rootPath: '' };
    const databasePath = joinRootPath(resolved.rootPath, ITUNESDB_FILE_RELATIVE_PATH);
    if (!(await resolved.fs.exists(databasePath))) {
      throw new Error(`iTunesDB not found at: ${databasePath}`);
    }
    const buffer = await resolved.fs.readFile(databasePath);
    return new ITunesDB(parseDatabase(buffer), { root: resolved, imageDecoder: options.imageDecoder });
  }

  /** Parse an iTunesDB binary buffer into a new managed instance. */
  static parse(buffer: ArrayBuffer): ITunesDB {
    return parseDatabase(buffer);
  }

  // ---- Tracks ----

  getTracks(): ItdbTrack[] {
    return this.tracks;
  }

  getTrack(trackId: number): ItdbTrack | undefined {
    return this.tracks.find(t => t.trackId === trackId);
  }

  /**
   * Add a track. When `params.audioData` is provided (and no
   * `artworkOverride` is set), embedded album art is extracted from
   * the audio metadata and decoded automatically using the
   * `imageDecoder` supplied at creation time.
   */
  async addTrack(params: ItdbAddTrackParams): Promise<ItdbTrack> {
    let artworkOverride = params.artworkOverride;
    if (!artworkOverride && params.audioData && this.imageDecoder) {
      const embedded = extractEmbeddedArtwork(params.audioData);
      if (embedded) artworkOverride = await this.imageDecoder.decode(embedded.data);
    }
    return addTrack(this, { ...params, artworkOverride });
  }

  removeTrack(trackId: number): boolean {
    return removeTrack(this, trackId);
  }

  updateTrack(trackId: number, updates: ItdbTrackUpdate): boolean {
    const track = this.getTrack(trackId);
    if (!track) return false;
    for (const key of Object.keys(updates) as Array<keyof ItdbTrackUpdate>) {
      const value = updates[key];
      if (value !== undefined) (track as unknown as Record<string, unknown>)[key] = value;
    }
    return true;
  }

  // ---- Playlists ----

  getPlaylists(): ItdbPlaylist[] {
    return this.playlists;
  }

  getPlaylist(playlistId: bigint): ItdbPlaylist | undefined {
    return this.playlists.find(p => p.playlistId === playlistId);
  }

  addPlaylist(name: string, trackIds: number[] = []): ItdbPlaylist {
    const maxId = this.playlists.reduce((max, p) => (p.playlistId > max ? p.playlistId : max), BigInt(0));
    const now = dateToMac(new Date());
    const playlist: ItdbPlaylist = {
      playlistId: maxId + BigInt(1),
      hidden: 0,
      timestamp: now,
      sortOrder: this.playlists.length,
      name,
      items: trackIds.map(trackId => ({ trackId, timestamp: now, rawHeader: new Uint8Array(0) })),
      dataObjects: [],
      rawHeader: new Uint8Array(0),
    };
    this.playlists.push(playlist);
    return playlist;
  }

  removePlaylist(playlistId: bigint): boolean {
    const idx = this.playlists.findIndex(p => p.playlistId === playlistId);
    if (idx === -1) return false;
    this.playlists.splice(idx, 1);
    return true;
  }

  addTrackToPlaylist(playlistId: bigint, trackId: number): boolean {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist || playlist.items.some(i => i.trackId === trackId)) return false;
    playlist.items.push(this.newPlaylistItem(trackId));
    return true;
  }

  removeTrackFromPlaylist(playlistId: bigint, trackId: number): boolean {
    const playlist = this.getPlaylist(playlistId);
    if (!playlist) return false;
    const before = playlist.items.length;
    playlist.items = playlist.items.filter(i => i.trackId !== trackId);
    return playlist.items.length !== before;
  }

  // ---- Albums ----

  getAlbums(): ItdbAlbum[] {
    return this.albums;
  }

  getAlbum(albumId: number): ItdbAlbum | undefined {
    return this.albums.find(a => a.albumId === albumId);
  }

  // ---- I/O ----

  /** Serialize the current state back into an iTunesDB binary buffer. */
  write(): ArrayBuffer {
    return writeDatabase(this);
  }

  /** Write the database back to the root it was opened from. */
  async save(): Promise<void> {
    if (!this.root) throw new Error('This database has no root handle; use write() instead of save().');
    await this.root.fs.writeFile(this.root.databasePath, this.write());
  }

  /** Releases in-memory references held by this instance. */
  [Symbol.dispose](): void {
    this.tracks.length = 0;
    this.playlists.length = 0;
    this.albums.length = 0;
  }

  private newPlaylistItem(trackId: number): ItdbPlaylistItem {
    return { trackId, timestamp: dateToMac(new Date()), rawHeader: new Uint8Array(0) };
  }
}
