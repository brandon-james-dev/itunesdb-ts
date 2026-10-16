import type { ItdbFileSystem } from '../common/fs/types.js';
import { normalizePath, commitTmp } from '../common/fs/atomic.js';
import { createDefaultFs, createDefaultImageDecoder } from '../common/env.js';
import { dateToMac } from '../common/constants/index.js';
import { ITUNESDB_HEADER_SIZES } from '../itunesdb/constants/index.js';
import type { ItdbDeviceInfo, ItdbArtworkFormat, ItdbPixelFormat, ItdbGeneration } from '../device/types.js';
import { readSysInfo, SYSTEM_DIR } from '../device/sysInfo.js';
import { checksumTypeForDevice, applyHash58, applyHash72, buildHashInfo, extractHash72IvRandom } from '../common/checksum/index.js';
import type { ItdbImageDecoder, ItdbRawImage } from '../artworkdb/artwork/index.js';
import { decodePixels } from '../artworkdb/artwork/encodePixels.js';
import { prepareThumbnails } from '../artworkdb/sync/prepareArtwork.js';
import { ITunesDB } from '../itunesdb/database/ITunesDB.js';
import { writeDatabase } from '../itunesdb/database/writeDatabase.js';
import { addTrack as addTrackRecord } from '../itunesdb/sync/addTrack.js';
import type { ItdbTrack } from '../itunesdb/track/types.js';
import type { ItdbPlaylist } from '../itunesdb/playlist/types.js';
import type { ItdbAlbum } from '../itunesdb/album/types.js';
import type { ItdbDataObject } from '../itunesdb/track/types.js';
import { ArtworkDB } from '../artworkdb/database/ArtworkDB.js';
import type { ItdbImageItem, ItdbThumbnail, ItdbFileInfo } from '../artworkdb/database/types.js';
import { writeArtworkDatabase } from '../artworkdb/database/writeArtworkDatabase.js';
import { extractEmbeddedArtwork } from '../itunesdb/metadata/extractEmbeddedArtwork.js';
import { sniffAudio } from '../itunesdb/sync/generateTrackLocation.js';
import { inferTrackMeta } from '../itunesdb/sync/inferTrackMeta.js';

/** Standard file locations on the iPod. */
export const IpodPaths = {
  ITUNESDB: '/iPod_Control/iTunes/iTunesDB',
  /** Canonical artwork database location (libgpod `itdb_get_artworkdb_path`). */
  ARTWORKDB: '/iPod_Control/Artwork/ArtworkDB',
  ARTWORK_DIR: '/iPod_Control/Artwork',
  MUSIC_DIR: '/iPod_Control/Music',
  SYSPATH: SYSTEM_DIR,
  /** Device signing-key store used by HASH72 (libgpod `get_hash_info_path`). */
  HASHINFO: '/iPod_Control/iTunes/HashInfo',
} as const;

/** Options for {@link Itdb.open} / {@link Itdb.create}. */
export interface ItdbOptions {
  /**
   * File system adapter. Optional — when omitted the runtime is
   * inferred automatically (Node: auto-detected iPod mount or the
   * working directory; browser: a `showDirectoryPicker()` prompt).
   */
  fs?: ItdbFileSystem;
  /** Device family, used to pick cover-art formats. */
  device?: ItdbDeviceInfo;
  /** Explicit cover-art formats (overrides `device`). */
  artworkFormats?: readonly ItdbArtworkFormat[];
  /** Number of `F00`...`Fnn` music folders to spread files over (default 20). */
  musicDirCount?: number;
  /** Name of the master playlist when creating a new database (default `"iPod"`). */
  masterName?: string;
  /**
   * Image decoder used to turn encoded artwork bytes (JPEG/PNG/...) into RGBA.
   * Optional — inferred from the runtime when omitted.
   */
  imageDecoder?: ItdbImageDecoder;
}

/** Optional per-call settings for {@link Itdb.addTrack}. */
export interface AddTrackOptions {
  /** File extension including the dot (e.g. `.mp3`). Detected from the data when omitted. */
  extension?: string;
  /**
   * When no `artwork` argument is given, try to extract and decode cover art
   * embedded in the audio file (ID3 `APIC` / MP4 `covr` / FLAC `PICTURE`).
   * Default `true`. Failures are ignored silently.
   */
  extractArtwork?: boolean;
}

/** Cover art input: encoded image bytes (JPEG/PNG/...) or decoded RGBA pixels. */
export type ArtworkInput = Uint8Array | ItdbRawImage;

/** Track metadata for {@link Itdb.addTrack}: any track field except the unique ids. */
export type TrackMeta = Partial<Omit<ItdbTrack, 'trackId' | 'dbid' | 'path' | 'rawHeader' | 'dataObjects'>> & {
  title: string;
};

/** Thrown for invalid high-level operations (unknown ids, etc.). */
export class ItdbError extends Error {
  /** @param message Error description. */
  constructor(message: string) {
    super(message);
    this.name = 'ItdbError';
  }
}

function randomU32(): number {
  const c = (globalThis as { crypto?: { getRandomValues<T extends ArrayBufferView>(a: T): T } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0]!;
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

function randomU64(): bigint {
  let v = 0n;
  while (v === 0n) v = (BigInt(randomU32()) << 32n) | BigInt(randomU32());
  return v;
}

/** Convert an iPod-style location (`:iPod_Control:Music:F00:X.mp3`) to a `/` path. */
export function locationToPath(location: string): string {
  return '/' + location.split(':').filter(Boolean).join('/');
}

/** Convert a `/` path to an iPod-style location. */
export function pathToLocation(path: string): string {
  return ':' + path.split('/').filter(Boolean).join(':');
}

/** Normalise to a filesystem call path (no leading `/`). */
function fsPath(path: string): string {
  return normalizePath(path).slice(1);
}

/** Bytes-per-pixel per artwork pixel format, used to size `mhif` records. */
const BPP: Record<ItdbPixelFormat, number> = {
  RGB565_LE: 2, RGB565_BE: 2, RGB555_LE: 2, RGB555_BE: 2,
  REC_RGB555_LE: 2, RGB888_LE: 3, UYVY_LE: 2, UYVY_BE: 2, I420_LE: 1.5,
};

function imageByteSize(f: ItdbArtworkFormat): number {
  return Math.floor(f.width * f.height * BPP[f.pixelFormat]);
}

/**
 * ArtworkDB thumbnail filename for a format id — libgpod/iTunes style:
 * `:F{formatId}_{fileIndex}.ithmb`, stored in the ArtworkDB thumbnail
 * entries and resolved by the device relative to the Artwork directory
 * (`F{formatId}_{fileIndex}.ithmb` physically). Matches libgpod's
 * `get_ithmb_filename()` for DB_TYPE_ITUNES and the file layout iTunes
 * writes on classic/nano devices.
 *
 * @param formatId Artwork format id (e.g. 1055, 1071, 1074).
 * @param fileIndex 1-based ithmb file index for this format (stays 1
 *   until a file exceeds the ~256 MB limit and a new one is opened).
 * @returns The thumbnail filename stored in the ArtworkDB.
 */
function ithmbName(formatId: number, fileIndex = 1): string {
  return `:F${formatId}_${fileIndex}.ithmb`;
}

/**
 * Map a thumbnail filename (as stored in the ArtworkDB) to the physical
 * path relative to the Artwork directory: a leading `:` is stripped per
 * the iTunes path convention, `F…` names resolve flat in Artwork, and any
 * legacy `F00/artwork…` sub-directory names are passed through unchanged.
 *
 * @param filename Thumbnail filename from an ArtworkDB entry.
 * @returns The physical file name relative to `IpodPaths.ARTWORK_DIR`.
 */
function ithmbPhys(filename: string): string {
  return filename.replace(/^:/, '');
}

/** Build a fresh, empty iTunesDB with a master playlist. */
function newDatabase(masterName: string, generation?: ItdbGeneration): ITunesDB {
  const ts = dateToMac(new Date());
  const mkPlaylist = (name: string, mhsdIndex = 2, isMaster = false, pid?: bigint): ItdbPlaylist => ({
    playlistId: pid ?? randomU64(),
    hidden: 0,
    timestamp: ts,
    sortOrder: 0,
    name,
    isMaster,
    items: [],
    dataObjects: [],
    mhsdIndex,
    rawHeader: new Uint8Array(0),
  } as ItdbPlaylist);
  // Modern generations (nano 3G/4G+, classic, touch) use the full multi-
  // section, multi-playlist seed Apple writes on those devices: TWO master
  // copies (idx2 + idx3) plus the standard category playlists. Vintage
  // devices (nano 1G/2G) use the simpler single-master layout.
  const modern =
    generation === 'NANO_3' ||
    generation === 'NANO_4' ||
    generation === 'NANO_5' ||
    generation === 'CLASSIC_1' ||
    generation === 'CLASSIC_2' ||
    generation === 'CLASSIC_3' ||
    generation === 'TOUCH_1' ||
    generation === 'TOUCH_2';
  return new ITunesDB({
    version: 0x19,
    numChildren: 0,
    dbId: randomU64(),
    platform: 0,
    languageId: 0,
    persistentId: randomU64(),
    tracks: [] as ItdbTrack[],
    playlists: modern
      ? [
          mkPlaylist(masterName, 2, true),
          mkPlaylist(masterName, 3, false),
          mkPlaylist('Music'),
          mkPlaylist('Videos'),
          mkPlaylist('Movies'),
          mkPlaylist('TV Shows'),
          mkPlaylist('Audiobooks'),
          mkPlaylist('Rentals'),
        ]
      : [mkPlaylist(masterName, 2, true)],
    albums: [] as ItdbAlbum[],
    sections: modern
      ? [
          { index: 4, kind: 'albums' },
          { index: 1, kind: 'tracks' },
          { index: 3, kind: 'playlists' },
          { index: 2, kind: 'playlists' },
          { index: 5, kind: 'events' },
        ]
      : [],
    rawHeader: new Uint8Array(0),
  } as ITunesDB);
}

/** A file written to `<path>.tmp` that still has to be moved into place. */
interface TmpFile {
  tmp: string;
  path: string;
  data: Uint8Array;
}

async function writeTmp(fs: ItdbFileSystem, path: string, data: Uint8Array): Promise<TmpFile> {
  const tmp = path + '.tmp';
  await fs.writeFile(fsPath(tmp), toArrayBuffer(data));
  return { tmp, path, data };
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/**
 * An open iPod database.
 *
 * Mirrors the libgpod-ts `Itdb` API: a single object that owns the
 * iTunesDB, the ArtworkDB, and the iPod filesystem, and applies all
 * mutations as a pending, in-memory unit of work that is committed
 * atomically by {@link save}.
 *
 * ```ts
 * const itdb = await Itdb.open(fs, { device: detectDevice('MB598') });
 * const t = await itdb.addTrack({ title: 'Song', artist: 'Me' }, mp3Bytes);
 * await itdb.save(); // writes everything atomically (.tmp + rename)
 * ```
 */
export class Itdb implements Disposable {
  /** Filesystem the database was opened from. */
  readonly fs: ItdbFileSystem;
  /** The iTunesDB model (fields on the instance; mutations are reflected on save). */
  readonly db: ITunesDB;
  /** The ArtworkDB model, or `null` if the iPod has none yet. */
  artwork: ArtworkDB | null;
  /** Cover-art formats that will be generated for new artwork. */
  readonly artworkFormats: readonly ItdbArtworkFormat[];
  /**
   * The resolved device after {@link open}: the caller's `device`
   * enriched with the on-device SysInfo (FireWire GUID / serial), or the
   * device auto-detected from SysInfo when none was provided.
   */
  readonly resolvedDevice: ItdbDeviceInfo | undefined;
  private readonly options: ItdbOptions;
  private readonly pendingPixels = new Map<number, Map<number, Uint8Array>>();
  private readonly pendingDeletes = new Set<string>();
  private artworkDirty = false;
  /** ithmb contents read during the current save/getArtwork call; cleared on every save. */
  private ithmbCache = new Map<string, Uint8Array>();

  /** Original iTunesDB bytes as read at {@link open}; written to `iTunesDB.bak` on the first save. */
  private readonly originalItunesDb: Uint8Array | null;

  /** Device (IV, random) for HASH72 signing, cached after first resolution. */
  private hash72IvRandom: { iv: Uint8Array; random: Uint8Array } | null = null;

  private constructor(fs: ItdbFileSystem, db: ITunesDB, artwork: ArtworkDB | null, options: ItdbOptions, originalItunesDb: Uint8Array | null = null, bakMaxId = 0) {
    this.fs = fs;
    this.db = db;
    this.artwork = artwork;
    this.originalItunesDb = originalItunesDb;
    options.imageDecoder ??= createDefaultImageDecoder();
    this.options = options;
    this.resolvedDevice = options.device;
    this.artworkFormats =
      options.artworkFormats ??
      (options.device ? options.device.artworkFormats : undefined) ??
      [];
    // Library-wide id counter — Apple draws trackIds AND albumIds from ONE
    // shared ascending sequence in catalog space. It must CONTINUE the
    // device's existing sequence: Apple's own DBs leave ids in the
    // thousands (2664..2729 on the 4G), while libgpod-written DBs (the 1G
    // via tunesreloaded) use tiny consecutive ids (52..56). In BOTH cases
    // the ids are internally consistent, and new tracks must strictly
    // continue the parsed DB's existing max — a mixed id space (big new
    // ids mixed with preserved small ones) is what Apple's parser rejects.
    // No floor here: the parsed max IS the next id, on every device.
    this.nextLibraryId =
      Math.max(
        bakMaxId,
        ...db.tracks.map((t) => t.trackId),
        ...(db.albums ?? []).map((a) => a.albumId),
      ) + 1;
  }

  private nextLibraryId: number;

  private allocId(): number {
    return this.nextLibraryId++;
  }

  /**
   * Open the database on an iPod. If no iTunesDB exists yet an empty database
   * (with a master playlist) is created in memory; call {@link save} to write it.
   *
   * The file system and image decoder are inferred from the runtime when
   * omitted, so `await Itdb.open()` works with zero configuration:
   * - `Itdb.open(fs, options)` — the classic explicit form.
   * - `Itdb.open({ fs, device })` — file system in the options object.
   * - `Itdb.open()` / `Itdb.open({ device })` — auto-inferred fs.
   */
  static async open(fsOrOptions: ItdbFileSystem | ItdbOptions = {}, options: ItdbOptions = {}): Promise<Itdb> {
    const { fs, opts } = await Itdb.resolveFsOptions(fsOrOptions, options);
    const itunesPath = fsPath(IpodPaths.ITUNESDB);
    let originalItunesDb: Uint8Array | null = null;
    let db: ITunesDB;
    if (await fs.exists(itunesPath)) {
      const raw = new Uint8Array(await fs.readFile(itunesPath));
      originalItunesDb = raw;
      db = ITunesDB.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    } else {
      db = newDatabase(opts.masterName ?? 'iPod', opts.device?.generation);
    }
    // Seed the library-wide id counter from the BACKUP too: Apple's delete
    // empties the live DB (0 tracks/albums) but leaves `iTunesDB.bak` as
    // the pre-delete library holding Apple's real id sequence (2664..2729
    // on this device). Our sync then must CONTINUE that sequence — writing
    // 2344 after Apple reached 2729 goes backwards into Apple's used range
    // and trips the "needs restore" check. Parse the .bak best-effort and
    // carry its max id (plus the live max) into the counter seed.
    let bakMaxId = 0;
    const bakPath = itunesPath + '.bak';
    if (await fs.exists(bakPath)) {
      try {
        const raw = new Uint8Array(await fs.readFile(bakPath));
        const bakDb = ITunesDB.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
        bakMaxId = Math.max(
          ...bakDb.tracks.map((t) => t.trackId),
          ...(bakDb.albums ?? []).map((a) => a.albumId),
        );
      } catch {
        bakMaxId = 0; // unreadable/absent backup — live DB still seeds.
      }
    }
    if (!db.playlists.some(p => p.isMaster)) {
      // The master playlist carries the library items (the "music list").
      // Apple writes it in the special-playlist section (idx3) on this
      // device, with an optional duplicate in the standard section (idx2).
      // If the parsed DB already carries BOTH copies (Apple's norm), no
      // master flag is needed — the writer emits each parsed copy as-is.
      // Only when the idx2 copy is MISSING do we mark isMaster so the
      // writer adds the second copy (idx2) alongside the idx3 original.
      const inBoth =
        db.playlists.some(p => (p.mhsdIndex ?? 2) === 3 && p.items.length > 0) &&
        db.playlists.some(p => (p.mhsdIndex ?? 2) === 2 && p.items.length > 0);
      if (!inBoth) {
        const master =
          db.playlists.find(p => (p.mhsdIndex ?? 2) === 3 && p.items.length > 0) ??
          db.playlists.find(p => (p.mhsdIndex ?? 2) === 2 && p.items.length > 0) ??
          db.playlists.find(p => (p.mhsdIndex ?? 2) === 3) ??
          db.playlists[0];
        if (master) master.isMaster = true;
      }
    }
    let artwork: ArtworkDB | null = null;
    const artworkPath = fsPath(IpodPaths.ARTWORKDB);
    if (await fs.exists(artworkPath)) {
      const raw = new Uint8Array(await fs.readFile(artworkPath));
      artwork = ArtworkDB.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    } else {
      // Legacy fallback: early builds of this library wrote the ArtworkDB to
      // iPod_Control/iTunes/ArtworkDB. Open it there when the canonical
      // file is absent so existing devices stay readable, but always write the
      // canonical location on the next save.
      const legacyPath = 'iPod_Control/iTunes/ArtworkDB';
      if (await fs.exists(legacyPath)) {
        const raw = new Uint8Array(await fs.readFile(legacyPath));
        artwork = ArtworkDB.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      }
    }
    // Enrich the caller's device with the on-device SysInfo (FireWire GUID /
    // serial), or auto-detect the model from SysInfo when none was provided —
    // exactly what libgpod does when opening an iPod.
    const sys = await readSysInfo(fs);
    if (sys && opts.device) {
      const d = opts.device;
      opts.device = {
        ...d,
        firewireGuid: d.firewireGuid ?? sys.firewireGuid,
        serialNumber: d.serialNumber ?? sys.serialNumber,
      };
    }
    return new Itdb(fs, db, artwork, opts, originalItunesDb, bakMaxId);
  }

  /**
   * Create a fresh, empty database without reading anything from `fs`.
   * The file system is inferred from the runtime when omitted (see
   * {@link Itdb.open}); {@link save} writes the new database there.
   */
  static async create(fsOrOptions: ItdbFileSystem | ItdbOptions = {}, options: ItdbOptions = {}): Promise<Itdb> {
    const { fs, opts } = await Itdb.resolveFsOptions(fsOrOptions, options);
    return new Itdb(fs, newDatabase(opts.masterName ?? 'iPod', opts.device?.generation), null, opts);
  }

  private static async resolveFsOptions(fsOrOptions: ItdbFileSystem | ItdbOptions, options: ItdbOptions): Promise<{ fs: ItdbFileSystem; opts: ItdbOptions }> {
    const candidate = fsOrOptions as ItdbFileSystem | undefined;
    if (candidate && typeof candidate.readFile === 'function' && typeof candidate.writeFile === 'function') {
      return { fs: candidate, opts: options };
    }
    const opts = (fsOrOptions as ItdbOptions | undefined) ?? options;
    return { fs: opts.fs ?? (await createDefaultFs()), opts };
  }

  /** All tracks (live array; prefer the mutation methods to keep playlists consistent). */
  get tracks(): ItdbTrack[] {
    return this.db.tracks;
  }

  /** All playlists, including the master playlist. */
  get playlists(): ItdbPlaylist[] {
    return this.db.playlists;
  }

  /** The master (library) playlist, created if missing. */
  get masterPlaylist(): ItdbPlaylist {
    let m = this.db.playlists.find(p => p.isMaster === true);
    if (!m) {
      m = {
        playlistId: randomU64(),
        hidden: 0,
        timestamp: dateToMac(new Date()),
        sortOrder: 0,
        name: this.options.masterName ?? 'iPod',
        isMaster: true,
        items: this.db.tracks.map(t => ({ trackId: t.trackId, timestamp: dateToMac(new Date()), rawHeader: new Uint8Array(0) })),
        dataObjects: [],
        rawHeader: new Uint8Array(0),
      };
      this.db.playlists.unshift(m);
    }
    return m;
  }

  /** Find a track by id. */
  getTrack(id: number): ItdbTrack | undefined {
    return this.db.tracks.find(t => t.trackId === id);
  }

  /** Find a track by its 64-bit database id (dbid). */
  getTrackByDbid(dbid: bigint): ItdbTrack | undefined {
    return this.db.tracks.find(t => t.dbid === dbid);
  }

  /** Find a playlist by persistent id. */
  getPlaylist(id: number | bigint): ItdbPlaylist | undefined {
    const b = BigInt(id);
    return this.db.playlists.find(p => p.playlistId === b);
  }

  private async uniqueMusicPath(ext: string): Promise<string> {
    const dirs = Math.max(1, this.options.musicDirCount ?? 20);
    const used = new Set(this.db.tracks.map(t => (t.path ?? '').toUpperCase()));
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let attempt = 0; attempt < 1000; attempt++) {
      const dir = `F${String(randomU32() % dirs).padStart(2, '0')}`;
      let name = '';
      for (let i = 0; i < 4; i++) name += alphabet[randomU32() % alphabet.length];
      const path = `${IpodPaths.MUSIC_DIR}/${dir}/${name}${ext}`;
      if (used.has(pathToLocation(path).toUpperCase())) continue;
      if (await this.fs.exists(fsPath(path))) continue;
      return path;
    }
    throw new ItdbError('could not allocate a unique music filename');
  }

  /**
   * Copy an audio file to the iPod and add a track for it to the database
   * (and to the master playlist).
   *
   * @param meta Track metadata (title, artist, length, ...). `size` and file type are filled in automatically.
   * @param audioData The audio file contents.
   * @param artwork Optional cover art: encoded image bytes (decoded with the
   *   configured `imageDecoder`) or an {@link ItdbRawImage}. When omitted, art
   *   embedded in `audioData` is extracted automatically (see
   *   {@link AddTrackOptions.extractArtwork}); extraction problems, or having
   *   no artwork formats configured, are skipped silently.
   * @param options Extra options (file extension override, auto-extraction).
   * @returns The new track.
   * @throws {ItdbError} If explicit `artwork` is given but no artwork formats are configured.
   * @throws Error If explicit encoded `artwork` cannot be decoded in this runtime.
   */
  async addTrack(
    meta: TrackMeta,
    audioData: Uint8Array,
    artwork?: ArtworkInput,
    options: AddTrackOptions = {},
  ): Promise<ItdbTrack> {
    // Decode explicit artwork up front so a bad image fails before anything is
    // written. A single bad/oversized image must never abort the whole sync:
    // treat any decode failure as "no artwork" and keep going (iTunes skips
    // broken cover art the same way).
    let rgba: ItdbRawImage | undefined;
    if (artwork) {
      try {
        rgba = await this.toRgba(artwork);
      } catch (err) {
        console.warn(
          `[Itdb] skipping artwork for "${meta.title}": ${err instanceof Error ? err.message : String(err)}`,
        );
        rgba = undefined;
      }
    }
    let encodedArtSize: number | undefined;
    if (!artwork && (options.extractArtwork ?? true) && this.artworkFormats.length > 0) {
      try {
        const embedded = extractEmbeddedArtwork(audioData);
        if (embedded && this.options.imageDecoder) {
          encodedArtSize = embedded.data.byteLength;
          rgba = await this.options.imageDecoder.decode(embedded.data, embedded.mimeType);
        }
      } catch {
        rgba = undefined; // Auto-extraction is best effort.
      }
    }
    const ext = (options.extension?.toLowerCase()) ?? sniffAudio(audioData) ?? '.mp3';
    const path = await this.uniqueMusicPath(ext);
    await this.fs.writeFile(fsPath(path), toArrayBuffer(audioData));

    const track = addTrackRecord(this.db, { ipodPath: pathToLocation(path), title: meta.title, trackId: this.allocId() });
    const trackId = track.trackId;
    const dbid = track.dbid;
    Object.assign(track, meta); // meta never contains trackId/dbid/path/rawHeader/dataObjects (see TrackMeta)
    // Fill the audio-derived fields Apple's parser expects populated
    // (duration, bitrate, sample rate) from the file bytes — but ONLY where
    // the caller didn't supply a value (a provided bitrate/year must win).
    if (!track.length || track.bitrate <= 0 || track.sampleRate <= 0) {
      const inferred = inferTrackMeta(audioData);
      if (!track.length && inferred.length) track.length = inferred.length;
      if (track.bitrate <= 0 && inferred.bitrate) track.bitrate = inferred.bitrate;
      if (track.sampleRate <= 0 && inferred.sampleRate) track.sampleRate = inferred.sampleRate;
      if (inferred.fileTypeString && !track.fileTypeString) {
        track.fileTypeString = inferred.fileTypeString;
      }
    }
    track.trackId = trackId;
    track.dbid = dbid;
    track.path = pathToLocation(path);
    track.rawHeader = new Uint8Array(0);
    track.dataObjects = [];
    track.size = audioData.length; // meta cannot override the real file size
    if (rgba) await this.setArtwork(trackId, rgba, encodedArtSize);
    // Add the new track to EVERY master copy. On dual-section devices there
    // are two master playlists (idx2 + idx3) and Apple keeps both item lists
    // identical; the isMaster flag is only set on open when one section is
    // missing, so a dual-master device may not flag EITHER copy. Pushing only
    // to a single flagged master makes the other copy fall behind — Apple
    // reads idx3 as authoritative and then "sees" tracks missing from that
    // list. Update all masters so both copies carry every new track.
    const item = { trackId, timestamp: dateToMac(new Date()), rawHeader: new Uint8Array(0) };
    const masters = this.db.playlists.filter(p => p.isMaster);
    // If neither copy is flagged (common on dual-section opens), fall back to
    // adding to whichever playlists have the most items (= the library list).
    if (masters.length === 0 && this.db.playlists.length > 0) {
      const max = Math.max(...this.db.playlists.map(p => p.items.length));
      this.db.playlists.forEach(p => { if (p.items.length === max && max > 0) masters.push(p); });
    }
    for (const master of masters) {
      if (master.items.length < this.db.tracks.length) {
        master.items.push(item);
      }
    }
    return track;
  }

  /**
   * Remove a track from the database and all playlists. Its audio file and
   * artwork are deleted on the next {@link save} (audio deletion requires `fs.remove`).
   * @throws {ItdbError} If the id is unknown.
   */
  removeTrack(id: number): void {
    const i = this.db.tracks.findIndex(t => t.trackId === id);
    if (i < 0) throw new ItdbError(`unknown track id ${id}`);
    const [track] = this.db.tracks.splice(i, 1) as [ItdbTrack];
    for (const pl of this.db.playlists) pl.items = pl.items.filter(it => it.trackId !== id);
    if (track.path) this.pendingDeletes.add(locationToPath(track.path));
    this.dropArtworkFor(track);
  }

  /** Create a regular playlist. @returns The new playlist. */
  addPlaylist(name: string): ItdbPlaylist {
    const pl: ItdbPlaylist = {
      playlistId: randomU64(),
      hidden: 0,
      timestamp: dateToMac(new Date()),
      sortOrder: 0,
      name,
      isMaster: false,
      items: [],
      dataObjects: [],
      rawHeader: new Uint8Array(0),
    };
    this.db.playlists.push(pl);
    return pl;
  }

  /**
   * Delete a playlist (tracks are kept).
   * @throws {ItdbError} If the id is unknown or refers to the master playlist.
   */
  removePlaylist(id: number | bigint): void {
    const b = BigInt(id);
    const i = this.db.playlists.findIndex(p => p.playlistId === b);
    if (i < 0) throw new ItdbError(`unknown playlist id ${b}`);
    if (this.db.playlists[i]!.isMaster) throw new ItdbError('cannot remove the master playlist');
    this.db.playlists.splice(i, 1);
  }

  /**
   * Append a track to a playlist.
   * @throws {ItdbError} If either id is unknown.
   */
  addTrackToPlaylist(trackId: number, playlistId: number | bigint): void {
    if (!this.getTrack(trackId)) throw new ItdbError(`unknown track id ${trackId}`);
    const pl = this.getPlaylist(playlistId);
    if (!pl) throw new ItdbError(`unknown playlist id ${BigInt(playlistId)}`);
    pl.items.push({ trackId, timestamp: dateToMac(new Date()), rawHeader: new Uint8Array(0) });
  }

  /**
   * Remove every occurrence of a track from a (non-master) playlist.
   * @throws {ItdbError} If the playlist is unknown or is the master playlist.
   */
  removeTrackFromPlaylist(trackId: number, playlistId: number | bigint): void {
    const pl = this.getPlaylist(playlistId);
    if (!pl) throw new ItdbError(`unknown playlist id ${BigInt(playlistId)}`);
    if (pl.isMaster) throw new ItdbError('use removeTrack() to remove tracks from the master playlist');
    pl.items = pl.items.filter(it => it.trackId !== trackId);
  }

  /**
   * Set (or replace) a track's cover art.
   *
   * @param trackId Track id.
   * @param artwork Encoded image bytes (JPEG/PNG/..., see the configured imageDecoder)
   *   or an {@link ItdbRawImage}.
   * @param originalSize Optional byte length of the original encoded artwork.
   *   When the caller has the encoded source bytes (e.g. extracted from audio
   *   metadata) this should be passed so `artworkSize` in the track record
   *   matches what iTunes/Apple Music write (the source image file size) —
   *   used by the device firmware when it pre-loads artwork on track skip.
   *   Defaults to the encoded byte length, or `width*height*4` for RGBA input.
   * @returns The new ArtworkDB image record.
   * @throws {ItdbError} If the track is unknown or no artwork formats are configured.
   */
  async setArtwork(trackId: number, artwork: ArtworkInput, originalSize?: number): Promise<ItdbImageItem> {
    const track = this.getTrack(trackId);
    if (!track) throw new ItdbError(`unknown track id ${trackId}`);
    if (this.artworkFormats.length === 0) {
      throw new ItdbError('no artwork formats configured; pass `device` or `artworkFormats` to Itdb.open()');
    }
    const artSize = originalSize ?? (artwork instanceof Uint8Array ? artwork.byteLength : artwork.width * artwork.height * 4);
    // A single bad/oversized image must never abort the whole sync: skip it
    // (and leave the track without art) instead of throwing up the stack.
    let rgba: ItdbRawImage;
    try {
      rgba = await this.toRgba(artwork);
    } catch (err) {
      console.warn(
        `[Itdb] skipping artwork for track ${trackId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.noArtworkItem(track);
    }
    // Guard against absurdly large decoded images (e.g. a 6000x6000 cover is
    // 144 MB of RGBA). The browser decoder allocates width*height*4 bytes,
    // which can throw `RangeError: Array buffer allocation failed` and abort
    // the whole sync. Skipping a huge cover keeps the sync alive.
    const MAX_PIXELS = 4096 * 4096; // 67 MB RGBA — far above any real album art
    if (!Number.isFinite(rgba.width) || !Number.isFinite(rgba.height) || rgba.width * rgba.height > MAX_PIXELS) {
      console.warn(
        `[Itdb] skipping artwork for track ${trackId}: decoded image ${rgba.width}x${rgba.height} exceeds the ${MAX_PIXELS}-pixel safety cap`,
      );
      return this.noArtworkItem(track);
    }
    if (!this.artwork) {
      this.artwork = new ArtworkDB({
        version: 6, numChildren: 3, nextId: 100,
        images: [] as ItdbImageItem[],
        fileInfos: [] as ItdbFileInfo[],
        rawHeader: new Uint8Array(0),
      } as ArtworkDB);
    }
    this.dropArtworkFor(track);

    const art = this.artwork;
    // iTunes writes one ArtworkDB image PER TRACK that has art (mhiiLink is
    // unique per track, 100, 101, 102…, `songId` = that track's dbid). The
    // device's root grid dedupes by album on its own — sharing one image per
    // album is NOT how iTunes does it and breaks the root art.
    const id = art.nextId;
    art.nextId = id + 1;
    const pixels = new Map<number, Uint8Array>();
    const thumbnails: ItdbThumbnail[] = this.artworkFormats.map(f => {
      const data = prepareThumbnails(rgba, [f])[0]!.data;
      pixels.set(f.formatId, data);
      return {
        formatId: f.formatId,
        filename: ithmbName(f.formatId),
        itmbOffset: 0,
        imageSize: data.length,
        imageWidth: f.width,
        imageHeight: f.height,
        verticalPadding: 0,
        horizontalPadding: 0,
        rawHeader: new Uint8Array(0),
      };
    });
    const now = dateToMac(new Date());
    const image: ItdbImageItem = {
      imageId: id,
      songId: track.dbid,
      rating: 0,
      originalDate: now,
      digitizedDate: now,
      originalImageSize: rgba.pixels.length,
      thumbnails,
      rawHeader: new Uint8Array(0),
    };
    art.images.push(image);
    // Link the track to its artwork the way iTunes does on fat-nano/classic
    // devices: mhiiLink points at the ArtworkDB imageId, artworkCount is the
    // number of artwork images, artworkSize the original image byte size.
    track.artworkCount = 1;
    track.artworkSize = artSize;
    track.mhiiLink = id;
    this.pendingPixels.set(id, pixels);
    this.artworkDirty = true;
    return image;
  }

  /** Remove a track's cover art. @throws {ItdbError} If the track is unknown. */
  removeArtwork(trackId: number): void {
    const track = this.getTrack(trackId);
    if (!track) throw new ItdbError(`unknown track id ${trackId}`);
    this.dropArtworkFor(track);
    track.artworkCount = 0;
    track.artworkSize = 0;
    track.mhiiLink = 0;
  }

  /**
   * Decode a track's cover art.
   * @param trackId Track id.
   * @param formatId Specific format to decode; defaults to the largest available.
   * @returns The decoded RGBA image, or `null` if the track has no artwork.
   */
  async getArtwork(trackId: number, formatId?: number): Promise<ItdbRawImage | null> {
    const track = this.getTrack(trackId);
    if (!track || !this.artwork) return null;
    const image = this.artwork.images.find(im => im.songId === track.dbid);
    if (!image || image.thumbnails.length === 0) return null;
    const thumb =
      formatId !== undefined
        ? image.thumbnails.find(t => t.formatId === formatId)
        : image.thumbnails.reduce((a, b) => (b.imageWidth * b.imageHeight > a.imageWidth * a.imageHeight ? b : a));
    if (!thumb) return null;
    const fmt = this.artworkFormats.find(f => f.formatId === thumb.formatId);
    const pixelFormat = fmt?.pixelFormat ?? 'RGB565_LE';
    const data = await this.thumbnailBytes(image, thumb, this.ithmbCache);
    return {
      width: thumb.imageWidth,
      height: thumb.imageHeight,
      pixels: decodePixels(data, thumb.imageWidth, thumb.imageHeight, pixelFormat),
    };
  }

  private async thumbnailBytes(image: ItdbImageItem, thumb: ItdbThumbnail, cache: Map<string, Uint8Array>): Promise<Uint8Array> {
    const pending = this.pendingPixels.get(image.imageId)?.get(thumb.formatId);
    if (pending) return pending;
    if (thumb.imageSize === 0) {
      throw new ItdbError(
        `thumbnail for image ${image.imageId} (format ${thumb.formatId}) in ${thumb.filename} has size 0; ` +
          'the ArtworkDB entry is corrupt — call removeArtwork()/setArtwork() for the affected track',
      );
    }
    const fullPath = `${IpodPaths.ARTWORK_DIR}/${ithmbPhys(thumb.filename)}`;
    let file = cache.get(fullPath);
    if (!file) {
      file = new Uint8Array(await this.fs.readFile(fsPath(fullPath)));
      cache.set(fullPath, file);
    }
    if (thumb.itmbOffset + thumb.imageSize > file.length) {
      throw new ItdbError(`thumbnail for image ${image.imageId} lies outside ${thumb.filename}`);
    }
    return file.subarray(thumb.itmbOffset, thumb.itmbOffset + thumb.imageSize);
  }

  private async toRgba(artwork: ArtworkInput): Promise<ItdbRawImage> {
    if (artwork instanceof Uint8Array) {
      if (!this.options.imageDecoder) {
        throw new ItdbError('cannot decode image bytes: no imageDecoder configured; pass `imageDecoder` to Itdb.open()/Itdb.create()');
      }
      return this.options.imageDecoder.decode(artwork);
    }
    return artwork;
  }

  /** Return a minimal placeholder image item used when artwork is skipped. */
  private noArtworkItem(track: ItdbTrack): ItdbImageItem {
    return {
      imageId: 0,
      songId: track.dbid,
      rating: 0,
      originalDate: 0,
      digitizedDate: 0,
      originalImageSize: 0,
      thumbnails: [],
      rawHeader: new Uint8Array(0),
    };
  }

  private dropArtworkFor(track: ItdbTrack): void {
    if (!this.artwork) return;
    const before = this.artwork.images.length;
    this.artwork.images = this.artwork.images.filter(im => {
      const match = im.songId === track.dbid;
      if (match) this.pendingPixels.delete(im.imageId);
      return !match;
    });
    if (this.artwork.images.length !== before) this.artworkDirty = true;
  }

  /**
   * Remove all tracks and their artwork from the in-memory database but keep
   * the full playlist skeleton Apple writes (master + special playlists: Music,
   * Videos, Movies, TV Shows, Audiobooks, Rentals) and the parsed section
   * layout. iTunes rejects files where these are dropped, while the device
   * tolerates it. Every playlist's items are reset (the master gets the new
   * library when tracks are added again).
   * Audio files on the iPod are queued for deletion and will be removed the
   * next time {@link save} is called (requires `fs.remove`).
   */
  clear(): void {
    for (const track of this.db.tracks) {
      if (track.path) this.pendingDeletes.add(locationToPath(track.path));
    }
    this.db.tracks = [];
    if (this.artwork) {
      this.artwork.images = [];
      this.artwork.nextId = 100;
      this.artworkDirty = true;
    }
    this.pendingPixels.clear();
    for (const playlist of this.db.playlists) playlist.items = [];
    this.db.albums = [];
    // Keep `db.sections` exactly as parsed so the written file preserves
    // Apple's section skeleton (types 4,1,3,2,5 incl. empty stubs).
  }

  /** Remove all tracks and their artwork; non-master playlists are also removed. */
  clearTracks(): void {
    for (const track of this.db.tracks) {
      if (track.path) this.pendingDeletes.add(locationToPath(track.path));
    }
    this.db.tracks = [];
    if (this.artwork) {
      this.artwork.images = [];
      this.artwork.nextId = 100;
      this.artworkDirty = true;
    }
    this.pendingPixels.clear();
    const master = this.db.playlists.find(p => p.isMaster);
    if (master) {
      master.items = [];
      this.db.playlists = [master];
    } else {
      this.db.playlists = [];
    }
    this.db.albums = [];
    // Sections are re-derived from the model on write; the stale section list
    // would otherwise skip the (now populated) track section.
    this.db.sections = [];
  }

  /**
   * Rebuild the album records (mhia) from the current track list, grouping
   * by album + artist. Each album's dbid is the first track's dbid so the
   * device can resolve album → track. Called at the start of {@link save};
   * the parsed album section is never trusted across a replace-library sync
   * because its dbids reference the previous library's tracks.
   */
  private preserveOriginalTracks(): void {
    if (!this.originalItunesDb) return;
    let orig: ITunesDB;
    try {
      orig = ITunesDB.parse((this.originalItunesDb.buffer.slice(this.originalItunesDb.byteOffset, this.originalItunesDb.byteOffset + this.originalItunesDb.byteLength)) as ArrayBuffer);
    } catch {
      return;
    }
    if (!orig.tracks.length) return;
    const byKey = new Map<string, ItdbTrack>();
    for (const t of orig.tracks) {
      byKey.set((t.title ?? '') + '\u0000' + (t.album ?? '') + '\u0000' + (t.artist ?? ''), t);
    }
    for (const t of this.db.tracks) {
      const o = byKey.get((t.title ?? '') + '\u0000' + (t.album ?? '') + '\u0000' + (t.artist ?? ''));
      if (!o) continue;
      // Byte-preservation: reuse the original record's raw header and mhod
      // children (Apple's exact accepted bytes) for songs the device already
      // knows, and keep their original ids — so Apple's validator sees the
      // same library it last synced, not a foreign one. Only genuinely new
      // tracks get synthesized records (via writeTrack's fresh path).
      if (o.rawHeader?.length) t.rawHeader = o.rawHeader;
      if (o.dataObjects?.length) t.dataObjects = o.dataObjects;
      t.trackId = o.trackId;
      if (o.dbid) t.dbid = o.dbid;
      // NOTE: albumId is intentionally NOT restored here. rebuildAlbums()
      // runs first in save() and reassigns album ids from the shared
      // counter (renumbering them if the original DB's ids were tiny);
      // restoring the ORIGINAL albumId here would point tracks at an
      // album id that no longer exists after the renumbering (the
      // phantom-album bug: tracks referenced album 4411 while the rebuilt
      // albums were 4417/4421 — the missing second album on the device).
      if (o.composerId) t.composerId = o.composerId;
      if ((o as unknown as { artistId?: number }).artistId !== undefined) {
        (t as unknown as { artistId?: number }).artistId = (o as unknown as { artistId?: number }).artistId;
      }
    }
  }

  private rebuildAlbums(): void {
    const groups = new Map<string, ItdbAlbum>();
    // Keep existing album ids stable across re-saves (Apple's albumIds are
    // stable: 2347, 2352, 2361 persist across syncs). Key by album+artist;
    // re-use the existing record's albumId/dbid when the album already
    // exists, and only allocate fresh ones for genuinely new albums.
    const existingByKey = new Map<string, ItdbAlbum>();
    for (const a of this.db.albums ?? []) {
      const k = (a.albumName ?? '') + '\u0000' + (a.artistName ?? '');
      existingByKey.set(k, a);
    }
    // Apple's catalog assigns FOUR distinct id kinds from ONE shared counter:
    // tracks, composers (one per track), albums (one per unique album) and
    // artists (one per unique artist). The reference DB shows them
    // interleaved: T2754 C2755 T2758 C2759 ... A2815 A2816 ... Ar2825
    // Ar2826. Keep per-track composer ids and per-artist ids stable across
    // re-saves (keyed by trackId / artist name), like Apple's.
    const composerByTrack = new Map<number, number>();
    for (const t of this.db.tracks) composerByTrack.set(t.trackId, t.composerId);
    const existingArtistId = new Map<string, number>();
    for (const t of this.db.tracks) {
      const k = t.artist ?? '';
      if (k && t.artistId > 0) existingArtistId.set(k, t.artistId);
    }
    for (const track of this.db.tracks) {
      const album = track.album ?? '';
      const artist = track.artist ?? '';
      const key = album + '\u0000' + artist;
      let albumEntry = groups.get(key);
      if (!albumEntry) {
        const dataObjects: ItdbDataObject[] = [];
        if (album) dataObjects.push({ type: 200, stringValue: album });
        if (artist) dataObjects.push({ type: 201, stringValue: artist });
        const existing = existingByKey.get(key);
        albumEntry = {
          // Apple draws albumIds from the SAME shared sequence as trackIds
          // (2343 track, 2347 album, 2349 track ...). Reuse the existing
          // album's id when present (stable across syncs); allocate from
          // the shared counter otherwise so albums sit in catalog space
          // and can never collide with a track id.
          albumId: existing?.albumId ?? this.allocId(),
          // Apple's own accepted DBs give every album record a DISTINCT
          // dbid — never the first track's dbid (verified: Apple's albums
          // have ids that collide with no track). A 64-bit id shared between
          // an album and a track makes Apple's parser flag the database
          // corrupt — the collision we have hit in every app sync. The
          // firmware never read album.dbid for the root grid; it resolves
          // album → track via album.albumId == track.albumId (Apple writes
          // T2343.albumId=2347 == Album 2347's albumId). So: unique album
          // dbids, and the track→album linkage via albumId (kept below).
          dbid: existing?.dbid ?? randomU64(),
          albumName: album || undefined,
          artistName: artist || undefined,
          dataObjects,
          rawHeader: new Uint8Array(0),
        };
        // Byte-preservation for albums (mirrors preserveOriginalTracks for
        // tracks): when the album already exists in the parsed database and
        // carries Apple's original bytes, reuse them verbatim — album records
        // carry per-album artwork/id fields our synthesis does not reproduce,
        // and re-writing them from scratch changed 27 bytes per saved DB
        // (measured vs Apple's own accepted DB).
        if (existing && existing.rawHeader.length > 0) {
          albumEntry.dataObjects = existing.dataObjects;
          albumEntry.rawHeader = existing.rawHeader;
        }
        groups.set(key, albumEntry);
      }
      // album_id (+0x120) is read by the firmware for album browsing.
      // Apple assigns FOUR distinct id kinds from the shared counter:
      // albumId (per unique album), composerId (per track), artistId
      // (per unique artist). The reference DB interleaves them
      // (T2754 C2755 ... A2815 ... Ar2825). Keep each id in its own
      // kind-space so no two kinds collide, and reuse existing ids for
     // stability across re-saves.
      track.albumId = albumEntry.albumId;
      track.composerId = composerByTrack.get(track.trackId) ?? this.allocId();
      const artistKey = track.artist ?? '';
      if (artistKey) track.artistId = existingArtistId.get(artistKey) ?? this.allocId();
    }
    this.db.albums = [...groups.values()];
  }

  /** Remove all non-master playlists. Tracks and artwork are left untouched. */
  clearPlaylists(): void {
    this.db.playlists = this.db.playlists.filter(p => p.isMaster);
  }

  /** Remove all cover art from every track. */
  clearArtwork(): void {
    for (const track of this.db.tracks) {
      track.artworkCount = 0;
      track.artworkSize = 0;
      track.mhiiLink = 0;
    }
    if (this.artwork) {
      this.artwork.images = [];
      this.artwork.nextId = 100;
      this.artworkDirty = true;
    }
    this.pendingPixels.clear();
  }

  /**
   * Rebuild the ithmb files so they contain exactly the referenced thumbnails.
   * Everything is written to `*.tmp` files; the returned list must be passed
   * to {@link commitTmp} to move them into place. Thumbnail offsets in the
   * model are only updated once all bytes have been gathered.
   *
   * ithmb files are shared per format across all artworks (matching iTunes):
   * every artwork's thumbnail for a given format is appended into a single
   * `F{format}_{fileIndex}.ithmb` file, and each thumbnail entry's
   * `itmbOffset`/`imageSize` point at its byte range inside that file.
   */
  private async writeArtwork(): Promise<TmpFile[]> {
    const art = this.artwork;
    if (!art) return [];
    this.ithmbCache = new Map();
    const cache = this.ithmbCache;
    const placements: Array<[ItdbThumbnail, number, number]> = [];
    const chunks = new Map<string, Uint8Array[]>();
    const sizes = new Map<string, number>();
    const formatSizes = new Map<number, number>();
    for (const image of art.images) {
      for (const thumb of image.thumbnails) {
        const bytes = await this.thumbnailBytes(image, thumb, cache);
        const name = ithmbPhys(thumb.filename);
        const list = chunks.get(name) ?? [];
        const offset = sizes.get(name) ?? 0;
        list.push(bytes);
        chunks.set(name, list);
        sizes.set(name, offset + bytes.length);
        placements.push([thumb, offset, bytes.length]);
        if (!formatSizes.has(thumb.formatId)) formatSizes.set(thumb.formatId, bytes.length);
      }
    }
    await this.fs.mkdir(fsPath(IpodPaths.ARTWORK_DIR));
    const tmps: TmpFile[] = [];
    for (const [name, list] of chunks) {
      const out = new Uint8Array(sizes.get(name)!);
      let p = 0;
      for (const c of list) {
        out.set(c, p);
        p += c.length;
      }
      tmps.push(await writeTmp(this.fs, `${IpodPaths.ARTWORK_DIR}/${name}`, out));
    }
    for (const [thumb, offset, size] of placements) {
      thumb.itmbOffset = offset;
      thumb.imageSize = size;
    }
    // Keep declared formats for configured devices even when no image uses them yet.
    for (const f of this.artworkFormats) {
      if (!formatSizes.has(f.formatId)) formatSizes.set(f.formatId, imageByteSize(f));
    }
    const existing = new Map(art.fileInfos.map(f => [f.formatId, f]));
    art.fileInfos = [...formatSizes].map(([formatId, imageSize]) => {
      const prev = existing.get(formatId);
      return prev ? { ...prev, formatId, imageSize } : { formatId, imageSize, rawHeader: new Uint8Array(0) };
    });
    const artBytes = writeArtworkDatabase(art);
    const artValidated = ArtworkDB.parse(artBytes);
    if (artValidated.images.length !== art.images.length) {
      throw new ItdbError(`save aborted: serialized ArtworkDB failed validation (images ${artValidated.images.length}/${art.images.length})`);
    }
    tmps.push(await writeTmp(this.fs, IpodPaths.ARTWORKDB, new Uint8Array(artBytes)));
    return tmps;
  }

  /**
   * Scan the device's music folders (`iPod_Control/Music/F00…Fnn`) and
   * delete any audio file that is not referenced by a track in the current
   * database. Runs before every write so repeated syncs don't accumulate
   * orphaned MP3s (from crashed syncs, cleared albums, etc.).
   */
  private async cleanMediaFiles(): Promise<void> {
    const fs = this.fs;
    // listing and removal are optional in ItdbFileSystem — if unsupported,
    // skip cleanup silently (fall back to the existing pendingDeletes path).
    if (!fs.list || !fs.remove) return;
    const dirs = Math.max(1, this.options.musicDirCount ?? 20);
    const inLibrary = new Set(
      this.db.tracks.map((t) => (t.path ?? '').toUpperCase()),
    );
    for (let d = 0; d < dirs; d++) {
      const dir = `F${String(d).padStart(2, '0')}`;
      const dirFs = fsPath(`${IpodPaths.MUSIC_DIR}/${dir}`);
      if (!(await fs.exists(dirFs))) continue;
      let entries: string[];
      try {
        entries = await fs.list(dirFs);
      } catch {
        continue; // folder unreadable — skip it
      }
      for (const name of entries) {
        if (typeof name !== 'string') continue;
        if (!/\.(mp3|m4a|aac|wav|m4p)$/i.test(name)) continue;
        const full = `${IpodPaths.MUSIC_DIR}/${dir}/${name}`;
        const loc = pathToLocation(full).toUpperCase();
        if (inLibrary.has(loc)) continue;
        try {
          await fs.remove(full);
        } catch {
          // best-effort — ignore files that can't be removed
        }
      }
    }
    // Thumbnails: remove any `.ithmb` file in the Artwork dir that no image
    // in the in-memory artwork refers to. (Files are named
    // `F{formatId}_{fileIndex}.ithmb`.) This keeps the artwork tree clean
    // across syncs so stale thumbnails don't accumulate on device.
    const artDirFs = fsPath(IpodPaths.ARTWORK_DIR);
    if (await fs.exists(artDirFs)) {
      let entries: string[];
      try {
        entries = await fs.list(artDirFs);
      } catch {
        entries = [];
      }
      const inUse = new Set(
        (this.artwork?.images ?? [])
          .flatMap((im) => im.thumbnails)
          .map((th) => `${IpodPaths.ARTWORK_DIR}/${ithmbPhys(th.filename)}`),
      );
      for (const name of entries) {
        if (typeof name !== 'string') continue;
        if (!/\.ithmb$/i.test(name)) continue;
        const full = `${IpodPaths.ARTWORK_DIR}/${name}`;
        if (inUse.has(full)) continue;
        try {
          await fs.remove(full);
        } catch {
          // best-effort
        }
      }
    }
  }

  /**
   * Write all changes to the iPod as a single unit of work: the iTunesDB,
   * and (if cover art changed) the ithmb files and ArtworkDB. Audio files of
   * removed tracks are deleted when the filesystem supports `remove`.
   *
   * Write safety: both databases are serialised in memory first, so any
   * error leaves the iPod untouched. Every file is then written as
   * `<name>.tmp` and moved into place with `fs.rename` (an atomic replace on
   * Node/Deno). Filesystems without `rename` fall back to overwriting the
   * target and deleting the `.tmp` file. The iTunesDB is committed last.
   */
  async save(options?: { skipArtwork?: boolean }): Promise<void> {
    this.rebuildAlbums();
    this.preserveOriginalTracks();
    // MP3 cleanup: before any write, scan the device's music folders and
    // delete any audio file that is NOT part of the current library. This
    // makes repeated syncs idempotent — a same-library sync cleans up
    // orphaned files (from earlier crashed syncs, cleared albums, or files
    // that were ever copied but never referenced), and a cleared device
    // starts from a truly-empty music tree instead of accumulating stale
    // MP3s on disk. Files that ARE in the library are left untouched
    // (including ones preserved via rawHeader).
    await this.cleanMediaFiles();
    // On-The-Go playlists are ephemeral: Apple regenerates them from the
    // device's queue state (and they're only meaningful on a real iPod whose
    // owner built them). A stale OTG playlist persisted across syncs carries
    // item refs (trackIds) that may no longer exist — the name "On-The-Go N"
    // itself marks it, and Apple's parser does not expect it to persist.
    // Drop them so they don't surface as phantom playlists with stale items.
    this.db.playlists = this.db.playlists.filter((p) => !(p.name && /^On-The-Go\b/i.test(p.name)));
    // The device often carries MULTIPLE copies of each special playlist (one
    // per mhsd section stub): this device had 13 "Videos", 2 "Brandon
    // James's iPod") — Apple's parser expects exactly one of each kind.
    // Dedupe by name so the written DB carries a single record per special
    // playlist (keeping the master, then one of each special section).
    const seen = new Set<string>();
    this.db.playlists = this.db.playlists.filter((p) => {
      const n = `${p.mhsdIndex ?? 2}:${p.name ?? ''}`;
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    // Apple's accepted layout carries the master playlist in BOTH special
    // (type 3) and standard (type 2) playlist sections (verified on this
    // device's own freshly-synced DBs). Model it explicitly: if exactly one
    // section holds the master, add a copy for the other. Doing it on the
    // model means writeDatabase stays 1:1 with what's stored, and the
    // self-validation counts match by construction.
    {
      // Apple keeps the master's ITEM LISTS identical in both sections. The
      // model may update only one copy after a replace-sync — propagate.
      // First, drop any items referencing tracks that no longer exist:
      // removeTrack() filters only ONE master copy (the isMaster one), so a
      // remove-sync leaves the OTHER copy's items stale — and the rich/poor
      // propagation below would then copy the STALE list into the fresh one,
      // re-inflating it (master=12 items for 4 live tracks → Apple flags the
      // DB as corrupt). Filtering both copies to live tracks first makes the
      // propagation copy the truthful list instead.
      const liveIds = new Set(this.db.tracks.map((t) => t.trackId));
      // The parsed DB often does NOT carry the isMaster flag (it's only set
      // on open when one section's copy is missing). A playlist that is *the
      // library list* is identifiable by size: the master(s) have the most
      // items, and Apple writes the same list in both sections. Rebuild those
      // 1:1 from live tracks so a re-sync can never leave stale/phantom item
      // ids (removeTrack only filters the flagged copy; with no flag set,
      // master items would keep referencing re-synthesized-away ids).
      const [maxItems] = [...this.db.playlists]
        .map((p) => p.items.length)
        .sort((a, b) => b - a);
      const isMasterPlaylist = (p: { isMaster?: boolean; items: { trackId: number }[] }) =>
        p.isMaster ||
        (this.db.tracks.length > 0 && p.items.length >= (maxItems ?? 0) && maxItems > 0);
      for (const p of this.db.playlists) {
        if (isMasterPlaylist(p)) {
          // The master is the library list by definition — it must be
          // exactly the live tracks, 1:1, no duplicates, no phantoms.
          p.items = this.db.tracks.map((t) => ({
            trackId: t.trackId,
            timestamp: dateToMac(new Date()),
            rawHeader: new Uint8Array(0),
          }));
        } else if (p.items.length > liveIds.size) {
          p.items = p.items.filter((it) => liveIds.has(it.trackId));
        }
      }
      const inSec = (n: number) => this.db.playlists.filter((p) => (p.mhsdIndex ?? 2) === n);
      for (const a of inSec(3)) {
        for (const b of inSec(2)) {
          if (a !== b && (a.name ?? '') === (b.name ?? '')) {
            const rich = a.items.length >= b.items.length ? a : b;
            const poor = rich === a ? b : a;
            if (poor.items.length < rich.items.length) {
              poor.items = rich.items.map((x) => ({ ...x }));
            }
          }
        }
      }
      // Duplicate ONLY when the written layout actually has both playlist
      // sections: legacy/single-section databases (and the db.sections
      // skeleton we preserve from parsed DBs) must not gain a record that
      // writeDatabase would then drop, which fails self-validation.
      const plSections = new Set<number>();
      if (this.db.sections && this.db.sections.length > 0) {
        for (const sec of this.db.sections) if (sec.kind === 'playlists') plSections.add(sec.index);
      } else {
        for (const p of this.db.playlists) plSections.add(p.mhsdIndex ?? 2);
      }
      // Duplicate the master playlist (type-3 -> type-2) ONLY when the
      // parsed DB's layout shows Apple's duplicated-master pattern (both
      // sections populated). The nano 1G/2G use a single-master layout (4
      // playlists — master in only one section); forcing a duplicate there
      // produces a layout Apple's parser rejects for that device. Never
      // invent a second copy for a layout that doesn't have one.
      if (plSections.has(2) && plSections.has(3)) {
        const hasIn = (n: number) => this.db.playlists.some((p) => (p.mhsdIndex ?? 2) === n);
        if (!hasIn(2) || !hasIn(3)) {
          const master =
            this.db.playlists.find((p) => p.isMaster) ??
            this.db.playlists.find((p) => (p.mhsdIndex ?? 2) === 3 && p.items.length > 0) ??
            this.db.playlists.find((p) => (p.mhsdIndex ?? 2) === 2 && p.items.length > 0) ??
            this.db.playlists.find((p) => p.isMaster === false);
          if (master) {
            master.isMaster = true;
            const missing = (master.mhsdIndex ?? 2) === 2 ? 3 : 2;
            this.db.playlists.push({ ...master, isMaster: true, mhsdIndex: missing });
          }
        }
      }
    }
    const itunesDb = writeDatabase(this.db, this.mhitHeaderSizeForDevice());
    // Self-validation: the serialized database must parse cleanly and keep the
    // same record counts as the in-memory model, or we abort BEFORE writing a
    // single byte to the iPod (a corrupt write is how devices get bricked).
    const validated = ITunesDB.parse(itunesDb);
    if (validated.tracks.length !== this.db.tracks.length || validated.playlists.length !== this.db.playlists.length) {
      throw new ItdbError(`save aborted: serialized database failed validation (tracks ${validated.tracks.length}/${this.db.tracks.length}, playlists ${validated.playlists.length}/${this.db.playlists.length})`);
    }
    // Device checksum: newer generations (nano 3G/4G, classic 1-3G, ...)
    // verify the iTunesDB checksum at boot. A DB without it is treated as
    // corrupt by the device — which is exactly the failure the user hit on a
    // nano 4G. Fail closed rather than write an unverifiable database.
    let bytesToWrite: Uint8Array = new Uint8Array(itunesDb);
    const checksum = checksumTypeForDevice(this.options.device);
    if (checksum === 'hash58') {
      const guid = this.options.device?.firewireGuid;
      if (!guid) {
        throw new ItdbError(
          `save aborted: this iPod (generation ${this.options.device?.generation}) requires the hash58 checksum, ` +
            'but no FireWire GUID is available. Pass `device` from detectDevice(SysInfo) or ensure SysInfo is readable on the device.',
        );
      }
    }
    // HASH72 signing. Two distinct consumers validate the 46-byte signature
    // stored in the mhbd header (offset 0x72, hashing_scheme@0x70 = 3):
    //   * the device firmware for the HASH72 generations (nano 5G, touch
    //     1-3G, ...) — required, fail closed when the key is unavailable;
    //   * Apple Music / Finder for the HASH58 generations (nano 3G/4G,
    //     classic) — they validate the DB signature even though the device
    //     does not, which is why a DB with an invalid/missing hash72 works
    //     on the iPod but reads as "corrupted" on macOS.
    // The (IV, random) pair comes from the device's HashInfo file or is
    // derived from a validly-signed DB already on the device (the signature
    // carries both; see `resolveHash72Key`).
    const hash72Key =
      this.hash72IvRandom ??
      (await this.resolveHash72Key(await this.readCurrentItunesDb().catch(() => undefined)));
    const hash72Required = this.checksumPlatformSupportsHash72 && (checksum === 'hash72' || checksum === 'hashAB');
    if (hash72Required && !hash72Key) {
      throw new ItdbError(
        `save aborted: this iPod (generation ${this.options.device?.generation}) requires the ${checksum} checksum, ` +
          'but no HASH72 signing key is available. Sync with Apple Music once (or restore with Finder) so the app can derive ' +
          "the device's signing pair from a validly-signed database, then retry.",
      );
    }
    if (hash72Key && this.checksumPlatformSupportsHash72 && checksum !== 'none') {
      bytesToWrite = await applyHash72(bytesToWrite, hash72Key.iv, hash72Key.random);
      this.hash72IvRandom = hash72Key;
      // Persist the signing key to the device (libgpod reads this file). Best
      // effort: a readable device can refuse the write (e.g. read-only mount).
      try {
        const guid = this.options.device?.firewireGuid;
        if (guid && this.fs.writeFile) {
          await this.fs.writeFile(fsPath(IpodPaths.HASHINFO), new Uint8Array(buildHashInfo(guid, hash72Key.iv, hash72Key.random)).buffer as ArrayBuffer);
        }
      } catch {
        // Best effort: the signature in the DB is sufficient for Apple's tools.
      }
    }
    // hash58 is applied LAST: its HMAC covers the whole buffer except
    // db_id/unk_0x32/hash58 themselves — including the hash72 scheme byte
    // and signature — exactly like Apple's own DBs (verified byte-for-byte
    // against an Apple-Music-written nano 4G DB).
    if (checksum === 'hash58') {
      bytesToWrite = applyHash58(bytesToWrite, this.options.device!.firewireGuid!);
    }
    this.ithmbCache = new Map();
    try {
      // When the caller wants zero artwork changes (e.g. a sync that should
      // behave like libgpod and leave the device's ArtworkDB/ithmb pair
      // byte-identical, because our writer's artwork layout is not what
      // Apple's parser expects), skip the artwork rewrite entirely even if
      // the in-memory dirty flag was set by our own track/artwork bookkeeping.
      const tmps = this.artworkDirty && !options?.skipArtwork ? await this.writeArtwork() : [];
      // Stage the new iTunesDB first.
      tmps.push(await writeTmp(this.fs, IpodPaths.ITUNESDB, bytesToWrite));
      // iTunes keeps `iTunesDB.bak` in sync with `iTunesDB` on every save:
      // it holds a copy of the *pre-save* DB (the state about to be replaced).
      // Apple's tools (Apple Music / Finder) validate the pair — a stale .bak
      // that diverges from the current iTunesDB reads as "corrupted". So write
      // the previous DB to .bak at every save, not just once.
      for (const t of tmps) {
        if (t.path === IpodPaths.ITUNESDB) {
          // Read the *current* (pre-replacement) file for the backup.
          let pre: ArrayBuffer | undefined;
          try {
            pre = await this.fs.readFile(fsPath(IpodPaths.ITUNESDB));
          } catch {
            // If the DB doesn't exist yet (first ever save), no .bak needed.
          }
          if (pre) await this.fs.writeFile(fsPath(IpodPaths.ITUNESDB) + '.bak', pre);
        } else if (t.path === IpodPaths.ARTWORKDB) {
          let pre: ArrayBuffer | undefined;
          try {
            pre = await this.fs.readFile(fsPath(IpodPaths.ARTWORKDB));
          } catch {
            // no-op
          }
          if (pre) await this.fs.writeFile(fsPath(IpodPaths.ARTWORKDB) + '.bak', pre);
        }
      }
      for (const t of tmps) await commitTmp(this.fs, t.tmp, t.path, t.data);
    } finally {
      this.ithmbCache = new Map();
    }
    if (this.artworkDirty) {
      this.pendingPixels.clear();
      this.artworkDirty = false;
      if (this.fs.remove) {
        // Best-effort cleanup of the legacy ArtworkDB location written by early
        // builds of this library (iPod_Control/iTunes/ArtworkDB). The device
        // only reads the canonical location, and a stray duplicate can confuse
        // tools that scan for ArtworkDB files.
        try {
          if (await this.fs.exists('iPod_Control/iTunes/ArtworkDB')) {
            await this.fs.remove('iPod_Control/iTunes/ArtworkDB');
            if (await this.fs.exists('iPod_Control/iTunes/ArtworkDB.bak')) await this.fs.remove('iPod_Control/iTunes/ArtworkDB.bak');
          }
        } catch {
          // Best effort: a leftover legacy file is harmless.
        }
      }
    }
    if (this.fs.remove) {
      const live = new Set(this.db.tracks.map(t => (t.path ? locationToPath(t.path) : '')));
      for (const p of this.pendingDeletes) {
        if (live.has(p)) continue;
        try {
          if (await this.fs.exists(fsPath(p))) await this.fs.remove(fsPath(p));
        } catch {
          // Best effort: a leftover audio file is harmless.
        }
      }
    }
    this.pendingDeletes.clear();
  }

  /**
   * Whether this device generation uses the HASH72 checksum platform
   * (nano 3G/4G and classic — libgpod's HASH72 families). These devices
   * carry a 46-byte hash72 signature in the mhbd header that Apple Music
   * / Finder validate. True when the device is in the HASH72 family or
   * when no device info is available (sign anyway for safety).
   */
  private get checksumPlatformSupportsHash72(): boolean {
    const g = this.options.device?.generation;
    if (!g) return true;
    // The HASH72 signature is only written on devices that Apple itself
    // signs with HASH72 (nano 5G, touch 1-3G, iPhone 1-3G — checksum type
    // `hash72`/`hashAB`). On the HASH58 families (nano 3G/4G, classic 1-3G,
    // checksum type `hash58`) Apple writes ONLY the hash58 HMAC and leaves
    // the 0x70-0x9e hash72 signature region all zeros — verified byte-for-
    // byte against Apple-Music-written DBs. Writing a hash72 signature there
    // on a hash58 device produces a header Apple's parser rejects as corrupt.
    return checksumTypeForDevice(this.options.device) === 'hash72' || checksumTypeForDevice(this.options.device) === 'hashAB';
  }

  /**
   * The mhit track-record header size for this device. Modern generations
   * (nano 3G/4G+, classic) use the 624-byte header; the earliest devices
   * (nano 1G/2G — proven by the accepted tunesreloaded DB on a nano 1G,
   * whose every mhit is 584 bytes) use the smaller 584-byte header.
   */
  private mhitHeaderSizeForDevice(): number {
    // The device's OWN carried mhit header size governs — read from any
    // preserved track in the parsed DB (Apple's accepted DBs on a given
    // device are uniform: 624 on nano 3/4G+ / classic, 584 on the smallest
    // vintage units). Deriving from the real bytes is authoritative and
    // survives generation misdetection — far more reliable than the model
    // guesses below. Apple rejects a DB whose tracks mix both sizes.
    const fromDevice = this.preservedMhitHeaderSize();
    if (fromDevice) return fromDevice;
    // Fallback only when no preserved track exists (e.g. a fresh device):
    // per-generation constants.
    const gen = this.options.device?.generation;
    if (gen === 'NANO_1' || gen === 'NANO_2' || gen === 'MINI_1' || gen === 'PHOTO' || gen === 'VIDEO_1') {
      return 584;
    }
    return ITUNESDB_HEADER_SIZES.MHIT;
  }

  /** The mhit header size carried by the on-device tracks, or null if none/ambiguous. */
  private preservedMhitHeaderSize(): number | null {
    let detected: number | null = null;
    for (const t of this.db.tracks) {
      if (t.rawHeader && t.rawHeader.length > 0 && (t.rawHeader.length === 584 || t.rawHeader.length === 624)) {
        if (detected === null) detected = t.rawHeader.length;
        else if (detected !== t.rawHeader.length) return null; // mixed — don't trust
      }
    }
    return detected;
  }

  /** Read the current on-device iTunesDB bytes (pre-save state), if any. */
  private async readCurrentItunesDb(): Promise<Uint8Array | undefined> {
    try {
      const buf = await this.fs.readFile(fsPath(IpodPaths.ITUNESDB));
      return new Uint8Array(buf);
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve the device's HASH72 (IV, random) signing pair, in order:
   *   1. The device's HashInfo file (`iPod_Control/iTunes/HashInfo`,
   *      written by libgpod tools and by this library once resolved).
   *   2. Derivation from a validly-signed iTunesDB on the device (the
   *      signature carries the pair; only a genuinely valid signature —
   *      verified by the two-block AES check — is accepted).
   * Returns null when neither source is available. The caller fails
   * closed on null rather than writing a DB Apple's tools would reject.
   */
  private async resolveHash72Key(currentDb: Uint8Array | undefined): Promise<{ iv: Uint8Array; random: Uint8Array } | null> {
    if (!this.checksumPlatformSupportsHash72) return null;
    // 1. HashInfo file on the device.
    try {
      const raw = await this.fs.readFile(fsPath(IpodPaths.HASHINFO));
      const buf = new Uint8Array(raw);
      if (buf.length >= 54 && String.fromCharCode(buf[0], buf[1], buf[2], buf[3], buf[4], buf[5]) === 'HASHv0') {
        return {
          random: buf.subarray(26, 38),
          iv: buf.subarray(38, 54),
        };
      }
    } catch {
      // No HashInfo file — fall through to derivation.
    }
    // 2. Derive from a validly-signed DB currently on the device. IV
    // extraction needs a raw ECB decrypt, which node:crypto provides; where
    // it is unavailable the failure is non-fatal (HashInfo is the primary
    // source, and a browser without HashInfo still gets a clear error).
    if (currentDb) {
      try {
        const derived = await extractHash72IvRandom(currentDb);
        if (derived) return derived;
      } catch {
        // Browser runtime without node:crypto — cannot extract; fall through.
      }
    }
    // 3. Self-consistent fresh key pair (libgpod's own bootstrap behavior,
    // `itdb_hash72_extract_hash_info`: when HashInfo is absent, recover the
    // pair from the current signature and WRITE it to HashInfo — and the
    // pair is only used to sign, so any (iv, random) that produces a
    // verifiable signature works; verification uses the globally known AES
    // key plus the random embedded in the signature itself). This is the
    // only path available in a browser (no ECB decrypt): the signature is
    // encrypt-only. Scoped to hash58-generation devices (nano 3G/4G,
    // classic 1-3G) whose FIRMWARE ignores hash72 and only Apple's tools
    // validate the signature; hash72-required generations keep failing
    // closed — their firmware validates and an arbitrary pair could make
    // the device unbootable (libgpod behavior: no HashInfo means it
    // bootstraps from the current DB via `hash_extract`; that needs ECB
    // and is not available in browsers).
    if (checksumTypeForDevice(this.options.device) === 'hash58') {
      try {
        const iv = new Uint8Array(16);
        const random = new Uint8Array(12);
        crypto.getRandomValues(iv);
        crypto.getRandomValues(random);
        return { iv, random };
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Release all in-memory state held by this instance: the parsed track,
   * playlist, album and artwork records, plus any pending pixel/deletion
   * queues and the ithmb cache. Files on the iPod are untouched (use
   * {@link save} first if you want changes committed). Implements the
   * `Disposable` protocol, so `using itdb = await Itdb.open(...)` releases
   * the records automatically when the block exits.
   */
  [Symbol.dispose](): void {
    this.db.tracks.length = 0;
    this.db.playlists.length = 0;
    this.db.albums.length = 0;
    if (this.artwork) {
      this.artwork.images.length = 0;
      this.artwork.fileInfos.length = 0;
    }
    this.pendingPixels.clear();
    this.pendingDeletes.clear();
    this.ithmbCache.clear();
  }
}
