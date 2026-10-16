import { ItdbBinaryWriter } from '../../common/binary/writer.js';
import { ITUNESDB_HEADER_SIZES } from '../constants/index.js';
import type { ITunesDB } from './ITunesDB.js';
import type { ItdbDbSection } from './types.js';
import type { ItdbPlaylist } from '../playlist/types.js';
import { writeTrack } from '../track/writeTrack.js';
import { writePlaylist } from '../playlist/writePlaylist.js';
import { writeDataObject } from '../track/writeDataObject.js';

/**
 * libgpod's `prepare_itdb_for_write` id assignment, applied at write time:
 *
 *  - every track gets a sequential id starting at FIRST_IPOD_ID (52, 53, 54…),
 *    assigned in playlist order (mpl order) — NOT persisted catalog ids;
 *  - albums, artists and composers each get their OWN 1-based counter,
 *    assigned in first-appearance order tied to the unique item;
 *  - the mhla/mhli sections and the track's album_id/artist_id/composer_id
 *    fields all use these freshly-assigned small ids.
 *
 * This is the exact assignment libgpod performs, and the one Apple's
 * parser validates against. It must run before any section is written
 * (album/artist ids feed the mhla/mhli headers and the track fields).
 */
export function prepareItdbIds(_db: ITunesDB): void {
  // Deprecated: this libgpod-style "fresh ids per write" renumber pass is
  // intentionally disabled. Itdb assigns ids at the model level (library-wide
  // counter continuing the device's sequence) and byte-preservation keeps
  // each known track's original Apple ids. Renumbering here destroyed both.
}

/**
 * Generate a fresh 64-bit library id for a newly-created database (or when
 * a parsed DB's id is 0). Consistency matters: Apple mirrors this id into
 * every track at +0x124 and validates it against mhbd+0x24. If `db` is
 * given, the generated id is stored on it so all tracks (and the header)
 * share the same value within a single write pass.
 */
export function randomLibraryId(db?: ITunesDB): bigint {
  const hi = BigInt((Math.random() * 0xffffffff) >>> 0);
  const lo = BigInt((Math.random() * 0xffffffff) >>> 0);
  const id = (hi << 32n) | lo;
  if (db) db.libraryId = id;
  return id;
}

/**
 * Serialize a parsed {@link ITunesDB} back into its binary format.
 *
 * The writer preserves raw header bytes from the original parse so
 * that unknown fields survive the round-trip. Only fields that are
 * explicitly modelled (track count, section sizes, etc.) are patched.
 *
 * @param db - The ITunesDB object to serialize.
 * @returns An ArrayBuffer containing the binary iTunesDB file.
 */
export function writeDatabase(db: ITunesDB, mhitHeaderSize?: number): ArrayBuffer {
  // NOTE: track/album/artist/composer ids are the MODEL's, assigned by
  // Itdb's library-wide id counter (continuing the device's sequence) and
  // by byte-preservation (keeping Apple's original ids for known tracks).
  // We do NOT renumber here — a leftover libgpod-style "fresh ids from 52"
  // pass renumbered every track to 52,53,54... on every write, which
  // destroyed both the preserved Apple ids and the continued sequence.
  const writer = new ItdbBinaryWriter(64 * 1024);

  const headerLen = Math.max(ITUNESDB_HEADER_SIZES.MHBD, db.rawHeader.length);
  if (db.rawHeader.length > 0) {
    writer.writeBytes(db.rawHeader);
  } else {
    writer.writeMagic('mhbd');
    writer.writeUint32(headerLen);
    writer.skip(headerLen - 8);
  }

  writer.seek(headerLen);

  // Reproduce the parsed section layout exactly (Apple's skeleton is
  // types [4,1,3,2,5]: tracks=4, library=1, playlists=3,2, albums=5).
  // Preserve parsed sections; for a fresh write, emit Apple's exact order.
  let parsedSections = db.sections && db.sections.length > 0 ? db.sections : null;
  // A parsed skeleton must COVER the current model: if the database we
  // opened had no tracks (or no albums) section, newly added tracks/albums
  // would be silently dropped — the section skeleton decides what gets
  // written. When that happens, fall back to Apple's default layout, which
  // is derived from the model itself. (This was the browser `tracks 0/7`
  // abort: the device DB was opened empty, so its skeleton had no type-1
  // tracks section, and the 7 added tracks had nowhere to go.)
  if (parsedSections) {
    const kinds = new Set(parsedSections.map((sec) => sec.kind));
    if ((db.tracks.length > 0 && !kinds.has('tracks')) || (db.albums.length > 0 && !kinds.has('albums'))) {
      parsedSections = null;
    }
  }
  const emittedSections = parsedSections ?? defaultSections(db);

  // +0x24: the library id, mirrored into every track at +0x124 (libgpod
  // "unknown id"). Apple's parser validates each track's mirror against
  // this header value. If the parsed DB carried one, preserve it; when we
  // create a fresh DB, generate a stable random 64-bit id (stored on the
  // model so every track mirror matches the header).
  const libraryId = db.libraryId || randomLibraryId(db);

  for (const section of emittedSections) {
    if (section.kind === 'tracks') writeTrackSection(writer, db, libraryId, mhitHeaderSize);
    else if (section.kind === 'playlists') writePlaylistSection(writer, db, section.index);
    else if (section.kind === 'albums') writeAlbumSection(writer, db);
    else if (section.kind === 'raw' && section.bytes) {
      writer.writeBytes(section.bytes);
    }
  }

  const totalLen = writer.offset;

  writer.seek(4);
  writer.writeUint32(headerLen);
  writer.writeUint32(totalLen);
  writer.seek(0x14);
  writer.writeUint32(emittedSections.length);
  // Apple writes unk_0x50 = 1 and unk_0x54 = 13 in the mhbd header on this
  // device (libgpod preserves both as "unknown, seen 0x05/0x4d for nano
  // 3G"). Early versions of this writer dropped them — a zeroed header is a
  // structural delta Apple's parser can reject. Restore Apple's values on
  // write, preserving any parsed nonzero value.
  writer.seek(0x50);
  writer.writeUint32(db.unk_0x50 ?? (db.tracks.length > 0 ? 1 : 0));
  writer.seek(0x54);
  writer.writeUint32(db.unk_0x54 ?? (db.tracks.length > 0 ? 13 : 0));

  // +0x24: the library id, mirrored into every track at +0x124 (libgpod
  // "unknown id"). Apple's parser validates each track's mirror against
  // this header value — use the SAME id computed above so header and
  // tracks agree.
  writer.seek(0x24);
  writer.writeUint64(libraryId);

  writer.seek(totalLen);
  return writer.finalize();
}

/**
 * Apple's accepted section skeleton is types [4,1,3,2,5]:
 *   type 4 = tracks (the track section — FIRST),
 *   type 1 = the library/playlists section,
 *   type 3 = playlists,
 *   type 2 = playlists,
 *   type 5 = albums.
 * The writer emits sections in that exact order. Index is the section's
 * position in this sequence (used for playlist filtering on write).
 */
/*
 * Apple's accepted section skeleton: tracks=type1 (mhlt), playlists in
 * type 2/3/5 (mhlp), albums=type4 (mhla). The accepted order is
 * [1, 2, 3, 4, 5]; keep that exact ordering on fresh writes.
 */
function defaultSections(db: ITunesDB): ItdbDbSection[] {
  // Apple's accepted layout on this device (nano 4G / classic): FIVE sections
  // in this exact order — 4 (albums, mhla), 1 (tracks, mhlt), 3 (special
  // playlists, mhlp), 2 (standard playlists, mhlp), 5 (extra playlists, mhlp).
  // Verified against a fresh Apple Music sync: types [4,1,3,2,5].
  // libgpod 0.8.0 (8 sections: 1,3,2,4,8,6,10,5) is REJECTED by Apple's
  // parser; the 5-section Apple order is what the device reads clean.
  const sections: ItdbDbSection[] = [];
  // type 4: albums (mhla) — Apple puts albums FIRST
  if (db.albums.length > 0) sections.push({ index: 4, kind: 'albums' });
  // type 1: tracks (mhlt)
  if (db.tracks.length > 0) sections.push({ index: 1, kind: 'tracks' });
  // type 3: special podcast playlists
  if (db.playlists.some((p) => (p.mhsdIndex ?? 2) === 3)) {
    sections.push({ index: 3, kind: 'playlists' });
  }
  // type 2: standard playlists — Apple always emits this section because
  // the master playlist appears in BOTH type-3 and type-2. Even if no
  // parsed playlist carries mhsdIndex 2, the section must be present so the
  // master (and any standard playlists) can be written under it.
  if (
    db.playlists.some((p) => (p.mhsdIndex ?? 2) === 2) ||
    db.playlists.some((p) => p.isMaster)
  ) {
    sections.push({ index: 2, kind: 'playlists' });
  }
  // type 5: extra playlists
  if (db.playlists.some((p) => (p.mhsdIndex ?? 2) === 5)) {
    sections.push({ index: 5, kind: 'playlists' });
  }
  return sections;
}

function writeTrackSection(writer: ItdbBinaryWriter, db: ITunesDB, libraryId: bigint, mhitHeaderSize?: number): void {
  const sectionStart = writer.offset;
  const sectionHeaderLen = ITUNESDB_HEADER_SIZES.MHSD;

  writer.writeMagic('mhsd');
  writer.writeUint32(sectionHeaderLen);
  const sectionTotalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint32(1); // track section is type 1 — Apple's accepted type-1
  // section carries mhlt (tracks); type-4 is albums (mhla). (Verified
  // against the accepted DB: type1→mhlt, type4→mhla, type5→mhlp.)
  writer.skip(sectionHeaderLen - 16);

  const mhltHeaderLen = ITUNESDB_HEADER_SIZES.MHLT;
  writer.writeMagic('mhlt');
  writer.writeUint32(mhltHeaderLen);
  writer.writeUint32(db.tracks.length);
  writer.skip(mhltHeaderLen - 12);

  // The mhit track-header size is DEVICE-GENERATION dependent: modern
  // devices (nano 4G+, classic) use 624-byte track headers, but older
  // generations (nano 1G — proven by the accepted tunesreloaded DB on a
  // nano 1G, whose every mhit header is 584 bytes) expect the smaller
  // size. Prefer the caller-supplied size (from Itdb.save(), which knows
  // the generation); fall back to the model's preserved tracks (they
  // carry the device's own header size), otherwise the modern 624.
  const mhitHeaderSizeFinal = mhitHeaderSize
    ?? (db.tracks.reduce<number>(
      (max, t) => Math.max(max, t.rawHeader.length > 0 ? t.rawHeader.length : 0),
      0,
    ) || ITUNESDB_HEADER_SIZES.MHIT);

  for (const track of db.tracks) {
    writeTrack(writer, track, libraryId, mhitHeaderSizeFinal);
  }

  const sectionTotal = writer.offset - sectionStart;
  writer.patchUint32(sectionTotalLenOffset, sectionTotal);
}

function writePlaylistSection(writer: ItdbBinaryWriter, db: ITunesDB, sectionIndex: number): void {
  const sectionStart = writer.offset;
  const sectionHeaderLen = ITUNESDB_HEADER_SIZES.MHSD;
  const sectionPlaylists = db.playlists.filter((p) => (p.mhsdIndex ?? 2) === sectionIndex);
  // Defensive dedupe by (section, name) — the model is expected to carry
  // exactly one record per (mhsdIndex, name), including the master copy
  // duplicated via Itdb.save()'s model-level master duplication.
  const unique = new Map<string, ItdbPlaylist>();
  for (const pl of sectionPlaylists) {
    const key = `${pl.mhsdIndex ?? 2}:${pl.name ?? ''}`;
    if (!unique.has(key)) unique.set(key, pl);
  }
  const masterPlays = [...unique.values()];

  writer.writeMagic('mhsd');
  writer.writeUint32(sectionHeaderLen);
  const sectionTotalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint32(sectionIndex);
  writer.skip(sectionHeaderLen - 16);

  const mhlpHeaderLen = ITUNESDB_HEADER_SIZES.MHLP;
  writer.writeMagic('mhlp');
  writer.writeUint32(mhlpHeaderLen);
  writer.writeUint32(masterPlays.length);
  writer.skip(mhlpHeaderLen - 12);

  for (const playlist of masterPlays) {
    writePlaylist(writer, playlist);
  }

  const sectionTotal = writer.offset - sectionStart;
  writer.patchUint32(sectionTotalLenOffset, sectionTotal);
}

function writeAlbumSection(writer: ItdbBinaryWriter, db: ITunesDB): void {
  const sectionStart = writer.offset;
  const sectionHeaderLen = ITUNESDB_HEADER_SIZES.MHSD;

  writer.writeMagic('mhsd');
  writer.writeUint32(sectionHeaderLen);
  const sectionTotalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint32(4); // album section is type 4 (mhla) — Apple's accepted.
  writer.skip(sectionHeaderLen - 16);

  const mhlaHeaderLen = ITUNESDB_HEADER_SIZES.MHLA;
  writer.writeMagic('mhla');
  writer.writeUint32(mhlaHeaderLen);
  writer.writeUint32(db.albums.length);
  writer.skip(mhlaHeaderLen - 12);

  for (const album of db.albums) {
    const albumStart = writer.offset;
    const albumHeaderLen = Math.max(ITUNESDB_HEADER_SIZES.MHIA, album.rawHeader.length);

    if (album.rawHeader.length > 0) {
      writer.writeBytes(album.rawHeader);
    } else {
      writer.writeMagic('mhia');
      writer.writeUint32(albumHeaderLen);
      writer.skip(albumHeaderLen - 8);
    }

    writer.seek(albumStart + 4);
    writer.writeUint32(albumHeaderLen);
    const albumTotalLenOffset = albumStart + 8;

    writer.seek(albumStart + 0x0C);
    writer.writeUint32(album.dataObjects.length);
    writer.writeUint32(album.albumId);
    writer.writeUint64(album.dbid);

    writer.seek(albumStart + albumHeaderLen);

    for (const obj of album.dataObjects) {
      writeDataObject(writer, obj);
    }

    const albumTotal = writer.offset - albumStart;
    writer.patchUint32(albumTotalLenOffset, albumTotal);
  }

  const sectionTotal = writer.offset - sectionStart;
  writer.patchUint32(sectionTotalLenOffset, sectionTotal);
}
