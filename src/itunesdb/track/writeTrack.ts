import { ItdbBinaryWriter } from '../../common/binary/writer.js';
import { ITUNESDB_HEADER_SIZES } from '../constants/index.js';
import type { ItdbTrack, ItdbDataObject } from './types.js';
import { writeDataObject } from './writeDataObject.js';
import { randomLibraryId } from '../database/writeDatabase.js';
import { MHOD_STRING_FIELDS } from './parseDataObject.js';
import { APPLE_TRACK_TEMPLATE } from './appleTrackTemplate.js';

/**
 * Write a single MHIT (track) record and its MHOD children.
 *
 * If the track has a preserved `rawHeader`, it is used as the base
 * and only the explicitly-modelled fields are patched on top.
 * This preserves unknown fields for round-trip fidelity and avoids
 * corrupting data the parser does not yet model.
 *
 * @param writer - The ItdbBinaryWriter to append the record to.
 * @param track  - The ItdbTrack object to serialize.
 */
export function writeTrack(writer: ItdbBinaryWriter, track: ItdbTrack, libraryId?: bigint, mhitHeaderSize: number = ITUNESDB_HEADER_SIZES.MHIT): void {
  const headerLen = Math.max(mhitHeaderSize, track.rawHeader.length);
  const startOffset = writer.offset;

  if (track.rawHeader.length > 0) {
    writer.writeBytes(track.rawHeader);
  } else {
    writer.writeMagic('mhit');
    writer.writeUint32(headerLen);
    // Start from Apple's own known-good header bytes (see
    // appleTrackTemplate.ts) instead of zeros: every unmodelled field —
    // soundcheck, the audio-offset region, the sample-count/gapless trio,
    // the flag constants — then carries Apple's exact nonzero values on
    // every track we synthesize | Apple's own parser reads a zero there as
    // malformed (proven: identical env accepts Apple's file, rejects ours,
    // while every modeled field + both checksums match).
    const tail = Math.min(headerLen - 8, APPLE_TRACK_TEMPLATE.length - 8);
    writer.writeBytes(APPLE_TRACK_TEMPLATE.subarray(8, 8 + tail));
    writer.skip(headerLen - 8 - tail);
  }

  writer.seek(startOffset + 4);
  writer.writeUint32(headerLen);
  const totalLenOffset = startOffset + 8;

  const dataObjects = buildTrackMhods(track);

  writer.seek(startOffset + 0x0C);
  writer.writeUint32(dataObjects.length);
  writer.seek(startOffset + 0x10);
  writer.writeUint32(track.trackId);
  writer.writeUint32(track.visible);
  writer.writeUint32(track.filetype);
  // +0x1c/+0x1d: type1 and type2 as TWO separate bytes. Apple writes
  // [00 01] for regular audio tracks (u16 = 0x0100); libgpod writes
  // track->type1 then track->type2. Our previous writeUint16(track.type)
  // emitted the raw u16 which for a fresh track (type=1) gave [01 00] —
  // swapped vs Apple's [00 01]. Derive the two bytes from the u16 the
  // parser produced (little-endian) exactly as Apple stores them.
  writer.writeUint8(track.type1 ?? (track.type & 0xff));
  writer.writeUint8(track.type2 ?? ((track.type >> 8) & 0xff));
  writer.writeUint8(track.compilation);
  writer.writeUint8(track.rating);
  writer.writeUint32(track.dateAdded);
  writer.writeUint32(track.size);
  writer.writeUint32(track.length);
  writer.writeUint32(track.trackNumber);
  writer.writeUint32(track.trackTotal);
  writer.writeUint32(track.year);
  writer.writeUint32(track.bitrate);
  writer.writeUint32((track.sampleRate << 16) >>> 0);
  // Audio-derived block (+0x40..+0x4f): with the Apple template as base,
  // only write a value when the caller actually provided one. Leave the
  // template bytes otherwise — soundcheck (+0x4c) in particular is written
  // by Apple on every accepted track and a zero reads malformed to the
  // parser (verified on all 9 apple records). Writing `0` here would undo
  // the template.
  if (track.volume) writer.writeInt32(track.volume); else writer.skip(4);
  if (track.startTime) writer.writeUint32(track.startTime); else writer.skip(4);
  if (track.stopTime) writer.writeUint32(track.stopTime); else writer.skip(4);
  if (track.soundCheck) writer.writeUint32(track.soundCheck); else writer.skip(4);
  writer.writeUint32(track.playCount);
  writer.writeUint32(track.playCount);
  writer.writeUint32(track.lastPlayed);
  writer.writeUint32(track.discNumber);
  writer.writeUint32(track.discTotal);
  writer.skip(4);
  writer.writeUint32(track.lastModified);
  writer.writeUint32(track.bookmarkTime);
  writer.writeUint64(track.dbid);

  writer.seek(startOffset + 0x7A);
  writer.writeUint16(track.bpm);
  writer.writeUint16(track.artworkCount);
  writer.writeUint16(0xffff); // 0x7E byte-order marker (Apple writes it)
  writer.writeUint32(track.artworkSize);
  writer.seek(startOffset + 0x90);
  // +0x90 unk144 — libgpod's set_defaults writes 0x000c for MP3/AAC audio
  // (an "audio" indicator byte pair); Apple's accepted tracks carry 0x000c.
  writer.writeUint16(track.unk144 ?? 0x000c);
  // +0x92/0x93 — Apple writes the constant u16 0x0100 (bytes 00 01 LE) in
  // EVERY accepted track (verified on all 8 fixture tracks and the
  // iTunes-written track). We were leaving it 0; a zeroed flag reads as a
  // malformed track.
  if (track.rawHeader.length === 0) {
    writer.writeUint16(0x0100);
  } else {
    writer.skip(2);
  }

  writer.seek(startOffset + 0xA4);
  writer.writeUint8(track.hasArtwork ?? (track.artworkCount > 0 ? 1 : 0));

  writer.seek(startOffset + 0xA8);
  // +0xa8 dbid2 — libgpod's set_defaults sets dbid2 = dbid explicitly and
  // every accepted Apple track carries the same value as dbid at +0x70.
  writer.writeUint64(track.dbid2 ?? track.dbid);

  // +0xcc / +0xcf — Apple writes the constants 0x03 (unk220) and 0x02
  // (unk204) in EVERY accepted track (all 8 fixture + iTunes-written);
  // ours were 0. Only fresh tracks — parsed tracks keep original bytes.
  if (track.rawHeader.length === 0) {
    writer.seek(startOffset + 0xcc);
    writer.writeUint8(0x03); // unk220 — Apple invariant
    writer.seek(startOffset + 0xcf);
    writer.writeUint8(0x02); // unk204 — Apple invariant
  }

  writer.seek(startOffset + 0xD0);
  // mediatype (+0xd0): Apple writes 1 for ordinary audio in the template;
  // a fresh TrackMeta never sets it (defaults 0) but a 0 mediatype is the
  // malformed class again. Keep the template's 1 unless the caller set one.
  if (track.mediatype) writer.writeUint32(track.mediatype); else writer.skip(4);
  if (track.seasonNumber) writer.writeUint32(track.seasonNumber); else writer.skip(4);
  if (track.episodeNumber) writer.writeUint32(track.episodeNumber); else writer.skip(4);

  // +0x100 — Apple writes the gapless track flag 0x01 in EVERY accepted
  // track; ours was 0. Only fresh tracks.
  if (track.rawHeader.length === 0) {
    writer.seek(startOffset + 0x100);
    writer.writeUint8(0x01); // gapless track flag — Apple invariant
  }

  writer.seek(startOffset + 0x120);
  writer.writeUint32(track.albumId);
  // +0x124: the library id mirror — same 64-bit id as mhbd+0x24, in every
  // track (libgpod: "same as mhbd+0x24, purpose unknown"). Apple's parser
  // checks it matches the header; without it, tracks carry 0 and Apple
  // flags the whole DB "needs restore". This was the corruption that
  // survived every other fix. A stale parsed 0 mirror must not override
  // the header id — treat 0/absent as "not set" so the db id wins.
  const libraryIdValue = track.libraryId || libraryId || (libraryId = randomLibraryId());
  writer.writeUint64(libraryIdValue);
  // +0x12c: filesize again — libgpod writes track->size a second time
  // ("seems to be filesize again"); Apple's accepted tracks carry the
  // same value as +0x24 here. We were leaving it 0.
  writer.writeUint32(track.size);
  // +0x130: 0
  writer.writeUint32(0);
  // +0x134: gapless/samplecount padding marker. The Apple template already
  // carries the device's own accepted bytes here (0x80 0x8x 0x80 0x80 0x80
  // 0x80 …), so every track inherits them — an explicit write would
  // overwrite Apple's exact byte (e.g. 0x81 at +0x135 on the iTunes-written
  // record) and reintroduce a diff. Skip the 8 bytes either way so the
  // sequential +0x13c write below lands at the right offset.
  writer.skip(8);
  // +0x13c: 0
  writer.writeUint32(0);

  writer.seek(startOffset + 0x160);
  writer.writeUint32(track.mhiiLink);
  writer.skip(4); // 0x164
  // +0x195 — Apple writes the constant 0x01 (unk405) in EVERY accepted
  // track; ours was 0. Only fresh tracks.
  if (track.rawHeader.length === 0) {
    writer.seek(startOffset + 0x195);
    writer.writeUint8(0x01); // unk405 — Apple invariant
  }
  writer.seek(startOffset + 0x168); // 0x168 (Apple writes 1, libgpod hardcodes it)
  writer.writeUint32(1);

  writer.seek(startOffset + 0x1E0);
  // artist_id — Apple/tunesreloaded write the ARTIST's own catalog id here
  // (not the track's album id): each distinct artist gets its own id (2825
  // in the reference = a separate id interleaved with the track/album ids).
  // Itdb releases these per-artist/per-composer ids on rebuild; fall back to
  // the album id if unset so the field is never left 0.
  writer.writeUint32(track.artistId || track.albumId);
  writer.seek(startOffset + 0x1F4);
  // composer_id — libgpod writes the composer's own id, and leaves it 0
  // when the track has no composer (verified against the accepted tunes DB:
  // +0x1f4 = 0 for those tracks). We previously fell back to albumId here,
  // writing a nonzero id Apple's parser doesn't expect. Keep 0 when unset.
  writer.writeUint32(track.composerId ?? 0);
  writer.seek(startOffset + 0x88);
  // samplerate2 (float) — the reference track carries ~44100.0 here (we
  // were leaving it 0). Write the track's sample rate as a float32.
  // samplerate2 float (+0x88) — keep template when unset (Apple writes
  // 44100.0 there; a 0.0 float is the same class of malformed as a zeroed
  // constant).
  if (track.sampleRate > 0) {
    const srBuf = new Uint8Array(4);
    new DataView(srBuf.buffer).setFloat32(0, track.sampleRate, true);
    for (const b of srBuf) writer.writeUint8(b);
  } else {
    writer.skip(4);
  }
  writer.seek(startOffset + 0xB0);
  // +0xb0: lyrics_flag, movie_flag, mark_unplayed, unk179. mark_unplayed is
  // PER-TRACK STATE (Apple's accepted DB carries 1 on one track, 2 on
  // another) — it is NOT a format validatorainer, and forcing any constant
  // leaves one track's accepted byte wrong. So only write these for
  // fresh/synthesized tracks (defaulting mark_unplayed to 1, libgpod's
  // set_defaults value); preserved tracks keep their original bytes from
  // rawHeader (which writeBytes already emitted) — don't overwrite them.
  if (track.rawHeader.length === 0) {
    writer.writeUint8(0);   // lyrics_flag
    writer.writeUint8(0);   // movie_flag
    writer.writeUint8(2);   // mark_unplayed — Apple writes 2 in EVERY
    // accepted track (fixture + iTunes-written); libgpod defaults to 1 but
    // Apple's parser expects 2. Verified byte-level on all 9 Apple tracks.
    writer.writeUint8(0);   // unk179
  } else {
    // preserved: the 4 bytes after +0xb0 came from rawHeader; keep them.
  }
  // +0xb8/0xb9 — Apple writes the constant u16 0x0210 in EVERY accepted
  // track (all 8 fixture + iTunes-written; ours was 0). Also the existence
  // of this field shifts nothing — it sits in the reserved tail. Fresh
  // tracks must carry it or the track reads as malformed.
  if (track.rawHeader.length === 0) {
    writer.seek(startOffset + 0xb8);
    writer.writeUint16(0x0210);
  }
  writer.seek(startOffset + headerLen);

  for (const obj of dataObjects) {
    writeDataObject(writer, obj);
  }

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}

function buildTrackMhods(track: ItdbTrack): ItdbDataObject[] {
  // PRESERVE, don't reorder: the accepted order differs by writer (Apple
  // writes 1,4,3,5,6,2; libgpod writes 1,4,3,6,2,5) and Apple's parser
  // accepts both — so reordering a parsed track's mhods (as earlier code
  // did) breaks byte-fidelity for one of the accepted layouts. For an
  // existing track, emit the mhods in the ORIGINAL parsed order, updating
  // string values from the model, and append only mhods that are genuinely
  // new (a missing type-6 filetype). For a brand-new track (no parsed
  // mhods) use libgpod's canonical order, which the device accepts.
  const result: ItdbDataObject[] = [];
  const seen = new Set<number>();

  if (track.dataObjects && track.dataObjects.length > 0) {
    const reverseMap: Record<string, number> = {};
    for (const [typeStr, field] of Object.entries(MHOD_STRING_FIELDS)) {
      reverseMap[field] = Number(typeStr);
    }
    const inline = (obj: ItdbDataObject): ItdbDataObject => {
      const field = MHOD_STRING_FIELDS[obj.type];
      if (field) {
        const val = (track as unknown as Record<string, unknown>)[field];
        if (typeof val === 'string') return { type: obj.type, stringValue: val };
      }
      return obj;
    };
    for (const obj of track.dataObjects) {
      if (seen.has(obj.type)) continue;
      seen.add(obj.type);
      result.push(inline(obj));
    }
    if (!seen.has(6)) {
      const fileType = track.fileTypeString ?? inferFileType(track.filetype);
      if (fileType) {
        result.push({ type: 6, stringValue: fileType });
        seen.add(6);
      }
    }
    return result;
  }

  const typesFromFields = new Set<number>();

  const reverseMap: Record<string, number> = {};
  for (const [typeStr, field] of Object.entries(MHOD_STRING_FIELDS)) {
    reverseMap[field] = Number(typeStr);
  }

  for (const [field, type] of Object.entries(reverseMap)) {
    const value = (track as unknown as Record<string, unknown>)[field];
    if (typeof value === 'string') {
      result.push({ type, stringValue: value });
      typesFromFields.add(type);
    }
  }

  // Ensure every track carries a type-6 (filetype) MHOD — Apple's parser
  // expects one on every track; its absence flags the DB as corrupted.
  if (!typesFromFields.has(6)) {
    const fileType = track.fileTypeString ?? inferFileType(track.filetype);
    if (fileType) {
      result.push({ type: 6, stringValue: fileType });
      typesFromFields.add(6);
    }
  }

  for (const obj of track.dataObjects) {
    if (!typesFromFields.has(obj.type)) {
      result.push(obj);
    }
  }

  // libgpod's canonical order for NEW tracks: title/artist/album/filetype/
  // path/genre. Apple's parser accepts this (this order is what the
  // accepted tunesreloaded DB carries).
  const LIBGPOD_ORDER = [1, 4, 3, 6, 2, 5];
  const byType = new Map<number, ItdbDataObject>();
  for (const obj of result) byType.set(obj.type, obj);
  const ordered: ItdbDataObject[] = [];
  const used = new Set<number>();
  for (const ty of LIBGPOD_ORDER) {
    const obj = byType.get(ty);
    if (obj) { ordered.push(obj); used.add(ty); }
  }
  for (const o of result) if (!used.has(o.type)) ordered.push(o);
  return ordered;
}

/** Infer a libgpod-style filetype string from the numeric mhit filetype. */
function inferFileType(filetype: number): string {
  // The mhit `filetype` field carries the fourcc (e.g. 0x4D503320 = "MP3 ").
  // Decode it back to the trimmed token libgpod/Apple store in the MHOD.
  const fourcc =
    String.fromCharCode((filetype >> 24 & 0xff), (filetype >> 16 & 0xff), (filetype >> 8 & 0xff), (filetype & 0xff));
  const trimmed = fourcc.trim();
  return trimmed.length > 0 ? trimmed : String(filetype);
}
