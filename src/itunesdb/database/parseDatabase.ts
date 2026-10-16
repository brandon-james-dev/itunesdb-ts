import { ItdbBinaryReader } from '../../common/binary/reader.js';
import type { ItdbTrack, ItdbDataObject } from '../track/types.js';
import type { ItdbPlaylist } from '../playlist/types.js';
import type { ItdbAlbum } from '../album/types.js';
import type { ItdbDbSection } from './types.js';
import { ITunesDB } from './ITunesDB.js';
import { parseTrack } from '../track/parseTrack.js';
import { parsePlaylist } from '../playlist/parsePlaylist.js';
import { parseDataObject } from '../track/parseDataObject.js';

/**
 * Parse an entire iTunesDB binary file into a structured object.
 *
 * Accepts an `ArrayBuffer` containing the raw iTunesDB data and
 * returns a fully parsed {@link ITunesDB} with tracks, playlists,
 * and album records.
 *
 * The parser preserves raw header bytes for every record so that
 * fields it does not explicitly model are not lost on round-trip.
 *
 * @param buffer - The raw bytes of the iTunesDB file.
 * @returns A parsed ITunesDB object.
 * @throws If the file does not start with the `mhbd` magic.
 */
export function parseDatabase(buffer: ArrayBuffer): ITunesDB {
  const reader = new ItdbBinaryReader(buffer);

  const magic = reader.readMagic();
  if (magic !== 'mhbd') {
    throw new Error(`Not an iTunesDB file: expected "mhbd", got "${magic}"`);
  }

  const headerLen = reader.readUint32();
  reader.readUint32();
  reader.skip(4);
  const version = reader.readUint32();
  const numChildren = reader.readUint32();
  const dbId = reader.readUint64();
  const platform = reader.readUint16();
  reader.seek(0x46);
  const languageId = reader.readUint16();
  const persistentId = reader.readUint64();
  // +0x24: the library id — Apple writes the SAME 64-bit value here and
  // mirrored into every track at +0x124 (libgpod "unknown id"). Apple's
  // parser validates the track mirror against this header value; this is
  // required for Apple's tools to accept the DB.
  const libReader = new ItdbBinaryReader(buffer);
  libReader.seek(0x24);
  const libraryId = libReader.readUint64();
  const unk_0x50 = reader.readUint32();
  const unk_0x54 = reader.readUint32();

  const rawHeader = new Uint8Array(new ItdbBinaryReader(buffer).readBytes(headerLen));

  const tracks: ItdbTrack[] = [];
  const playlists: ItdbPlaylist[] = [];
  const albums: ItdbAlbum[] = [];
  const sections: ItdbDbSection[] = [];

  reader.seek(headerLen);

  for (let s = 0; s < numChildren; s++) {
    const sectionStart = reader.offset;
    const sectionMagic = reader.readMagic();
    if (sectionMagic !== 'mhsd') {
      reader.seek(sectionStart);
      break;
    }
    const sectionHeaderLen = reader.readUint32();
    const sectionTotalLen = reader.readUint32();
    const sectionIndex = reader.readUint32();

    reader.seek(sectionStart + sectionHeaderLen);

    const beforeTracks = tracks.length;
    const beforePlaylists = playlists.length;
    const beforeAlbums = albums.length;

    if (sectionIndex === 1) {
      parseMhlt(reader, tracks);
      if (tracks.length > beforeTracks) sections.push({ index: sectionIndex, kind: 'tracks' });
    } else if (sectionIndex === 2 || sectionIndex === 3 || sectionIndex === 5) {
      parseMhlp(reader, playlists, sectionIndex);
      if (playlists.length > beforePlaylists) sections.push({ index: sectionIndex, kind: 'playlists' });
    } else if (sectionIndex === 4) {
      parseMhla(reader, albums);
      if (albums.length > beforeAlbums) sections.push({ index: sectionIndex, kind: 'albums' });
    }

    if (
      tracks.length === beforeTracks &&
      playlists.length === beforePlaylists &&
      albums.length === beforeAlbums &&
      sectionTotalLen > sectionHeaderLen
    ) {
      // Apple writes the complete section skeleton (types 4,1,3,2,5) with an
      // mhla/mhlt/mhlp record in every section, even when empty. Preserve any
      // section that produced no records verbatim so the writer reproduces the
      // skeleton exactly — iTunes rejects files where these are dropped.
      reader.seek(sectionStart);
      const bytes = new Uint8Array(reader.readBytes(sectionTotalLen));
      sections.push({ index: sectionIndex, kind: 'raw', bytes });
    }

    reader.seek(sectionStart + sectionTotalLen);
  }

  return new ITunesDB({
    version, numChildren, dbId, platform, languageId, persistentId, libraryId,
    unk_0x50, unk_0x54,
    tracks, playlists, albums, sections, rawHeader,
  } as ITunesDB);
}

function parseMhlt(reader: ItdbBinaryReader, tracks: ItdbTrack[]): void {
  const start = reader.offset;
  const magic = reader.readMagic();
  if (magic !== 'mhlt') return;
  const headerLen = reader.readUint32();
  const numSongs = reader.readUint32();

  reader.seek(start + headerLen);
  for (let i = 0; i < numSongs; i++) {
    const { track } = parseTrack(reader);
    tracks.push(track);
  }
}

function parseMhlp(reader: ItdbBinaryReader, playlists: ItdbPlaylist[], mhsdIndex: number): void {
  const start = reader.offset;
  const magic = reader.readMagic();
  if (magic !== 'mhlp') return;
  const headerLen = reader.readUint32();
  const numPlaylists = reader.readUint32();

  reader.seek(start + headerLen);
  for (let i = 0; i < numPlaylists; i++) {
    const { playlist } = parsePlaylist(reader);
    playlist.mhsdIndex = mhsdIndex;
    playlists.push(playlist);
  }
}

function parseMhla(reader: ItdbBinaryReader, albums: ItdbAlbum[]): void {
  const start = reader.offset;
  const magic = reader.readMagic();
  if (magic !== 'mhla') return;
  const headerLen = reader.readUint32();
  const numAlbums = reader.readUint32();

  reader.seek(start + headerLen);
  for (let i = 0; i < numAlbums; i++) {
    const albumStart = reader.offset;
    const albumMagic = reader.readMagic();
    if (albumMagic !== 'mhia') {
      reader.seek(albumStart);
      break;
    }
    const albumHeaderLen = reader.readUint32();
    const albumTotalLen = reader.readUint32();
    const numMhod = reader.readUint32();
    const albumId = reader.readUint32();
    const dbid = reader.readUint64();

    const albumRawHeader = new Uint8Array(reader.subreader(albumStart).readBytes(albumHeaderLen));

    const dataObjects: ItdbDataObject[] = [];
    reader.seek(albumStart + albumHeaderLen);
    for (let j = 0; j < numMhod; j++) {
      const { object } = parseDataObject(reader);
      dataObjects.push(object);
    }

    let albumName: string | undefined;
    let artistName: string | undefined;
    for (const obj of dataObjects) {
      if (obj.type === 200 && obj.stringValue) albumName = obj.stringValue;
      if (obj.type === 201 && obj.stringValue) artistName = obj.stringValue;
    }

    albums.push({
      albumId, dbid, albumName, artistName,
      dataObjects, rawHeader: albumRawHeader,
    });

    reader.seek(albumStart + albumTotalLen);
  }
}
