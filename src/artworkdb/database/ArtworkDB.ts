import type { ItdbImageItem, ItdbThumbnail, ItdbFileInfo } from './types.js';
import { parseArtworkDatabase } from './parseArtworkDatabase.js';
import { writeArtworkDatabase } from './writeArtworkDatabase.js';
import { addArtworkEntry, prepareThumbnails } from '../sync/prepareArtwork.js';
import type { ItdbRawImage } from '../artwork/types.js';
import type { ItdbArtworkFormat } from '../../device/types.js';
import { resolveRoot, joinRootPath } from '../../common/fs/root.js';
import type { ItdbRootHandle, ItdbResolvedRoot } from '../../common/fs/root.js';
import { createDefaultFs } from '../../common/env.js';
import { ARTWORKDB_FILE_RELATIVE_PATH } from '../constants/index.js';

/**
 * Data fields of a parsed ArtworkDB (the `mhfd` record and all children).
 *
 * This interface is merged with the `ArtworkDB` class: a parsed database
 * is a single object that carries these fields directly on the instance
 * (e.g. `artDb.images`) while also offering the class methods. It is
 * also the structural shape the `write()`/`writeArtworkDatabase()`
 * serializers read.
 */
export interface ArtworkDB {
  version: number;
  numChildren: number;
  nextId: number;
  images: ItdbImageItem[];
  fileInfos: ItdbFileInfo[];
  /** Raw header bytes preserved for round-trip fidelity. */
  rawHeader: Uint8Array;
}

export interface ArtworkDBOptions {
  root?: ItdbRootHandle;
}

export interface ItdbResolvedRootWithPath extends ItdbResolvedRoot {
  databasePath: string;
}

/**
 * A parsed ArtworkDB.
 *
 * Two ways to create one:
 * - `await ArtworkDB.open(root)` — resolves the root
 *   handle ({@link ItdbRootHandle}), reads `iPod_Control/iTunes/ArtworkDB`
 *   from it, and throws if the file is missing.
 * - `ArtworkDB.parse(buffer)` or the standalone `parseArtworkDatabase(buffer)` —
 *   for in-memory buffers.
 *
 * The parsed data fields (see the merged `ArtworkDB` interface) live
 * directly on the instance. Entity methods cover images and thumbnails;
 * `save()` writes the database back to the root it was opened from.
 * Implements the `Disposable` protocol (`using` releases the in-memory
 * records).
 */
export class ArtworkDB implements Disposable {
  readonly root: ItdbResolvedRootWithPath | null;

  constructor(data: ArtworkDB, options: ArtworkDBOptions = {}) {
    Object.assign(this, data);
    if (options.root) {
      const resolved = resolveRoot(options.root);
      this.root = {
        fs: resolved.fs,
        rootPath: resolved.rootPath,
        databasePath: joinRootPath(resolved.rootPath, ARTWORKDB_FILE_RELATIVE_PATH),
      };
    } else {
      this.root = null;
    }
  }

  /**
   * Open an ArtworkDB from a root handle, reading the database file
   * from the device root directory. Throws if the file is not found.
   *
   * `root` is optional — when omitted the runtime is inferred
   * automatically (Node: auto-detected iPod mount or the working
   * directory; browser: a `showDirectoryPicker()` prompt).
   */
  static async open(root: ItdbRootHandle | undefined = undefined): Promise<ArtworkDB> {
    const resolved = root ? resolveRoot(root) : { fs: await createDefaultFs(), rootPath: '' };
    const databasePath = joinRootPath(resolved.rootPath, ARTWORKDB_FILE_RELATIVE_PATH);
    if (!(await resolved.fs.exists(databasePath))) {
      throw new Error(`ArtworkDB not found at: ${databasePath}`);
    }
    const buffer = await resolved.fs.readFile(databasePath);
    return new ArtworkDB(parseArtworkDatabase(buffer), { root: resolved });
  }

  /** Parse an ArtworkDB binary buffer into a new managed instance. */
  static parse(buffer: ArrayBuffer): ArtworkDB {
    return parseArtworkDatabase(buffer);
  }

  // ---- Images ----

  getImages(): ItdbImageItem[] {
    return this.images;
  }

  getImage(imageId: number): ItdbImageItem | undefined {
    return this.images.find(img => img.imageId === imageId);
  }

  getImagesForSong(songDbid: bigint): ItdbImageItem[] {
    return this.images.filter(img => img.songId === songDbid);
  }

  addArtwork(
    songDbid: bigint,
    thumbnails: Array<{ formatId: number; itmbOffset: number; imageSize: number; width: number; height: number; filename: string }>,
  ): void {
    addArtworkEntry(this, songDbid, thumbnails);
  }

  removeImage(imageId: number): boolean {
    const idx = this.images.findIndex(img => img.imageId === imageId);
    if (idx === -1) return false;
    this.images.splice(idx, 1);
    return true;
  }

  getThumbnailsForImage(imageId: number): ItdbThumbnail[] {
    return this.getImage(imageId)?.thumbnails ?? [];
  }

  // ---- Thumbnails ----

  /** @see prepareThumbnails */
  prepareThumbnails(source: ItdbRawImage, formats: ItdbArtworkFormat[]) {
    return prepareThumbnails(source, formats);
  }

  // ---- I/O ----

  /** Serialize the current state back into an ArtworkDB binary buffer. */
  write(): ArrayBuffer {
    return writeArtworkDatabase(this);
  }

  /** Write the database back to the root it was opened from. */
  async save(): Promise<void> {
    if (!this.root) throw new Error('This database has no root handle; use write() instead of save().');
    await this.root.fs.writeFile(this.root.databasePath, this.write());
  }

  /** Releases in-memory references held by this instance. */
  [Symbol.dispose](): void {
    this.images.length = 0;
    this.fileInfos.length = 0;
  }
}
