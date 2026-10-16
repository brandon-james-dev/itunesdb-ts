import { ItdbBinaryReader } from '../../common/binary/reader.js';
import { isStringMhodType, isPodcastMhodType, MhodType } from '../constants/index.js';
import type { ItdbDataObject } from './types.js';

/**
 * Parse a single MHOD (data object) record from the iTunesDB.
 *
 * String-type MHODs (types 1–31) contain a 16-byte sub-header at
 * offset 0x18 followed by UTF-16LE or UTF-8 string data.
 * Podcast URL types (15–16) store raw UTF-8 directly after the header.
 *
 * @param reader - An ItdbBinaryReader positioned at the start of an `mhod` record.
 * @returns The parsed ItdbDataObject and the total number of bytes consumed.
 */
export function parseDataObject(reader: ItdbBinaryReader): { object: ItdbDataObject; bytesRead: number } {
  const startOffset = reader.offset;

  const magic = reader.readMagic();
  if (magic !== 'mhod') {
    throw new Error(`Expected mhod magic at offset ${startOffset}, got "${magic}"`);
  }

  const headerLen = reader.readUint32();
  const totalLen = reader.readUint32();
  const type = reader.readUint32();
  reader.skip(8);

  const obj: ItdbDataObject = { type };

  if (isPodcastMhodType(type)) {
    const strLen = totalLen - headerLen;
    if (strLen > 0) {
      reader.seek(startOffset + headerLen);
      obj.stringValue = reader.readUtf8(strLen);
    }
  } else if (type === MhodType.THMB) {
    const bodyLen = totalLen - headerLen;
    if (bodyLen > 0) {
      reader.seek(startOffset + headerLen);
      obj.rawBody = reader.readBytes(bodyLen);
    }
  } else if (isStringMhodType(type) || type === 200 || type === 201 || type === MhodType.ALBUM_ARTIST_MHII) {
    reader.seek(startOffset + headerLen);
    const stringType = reader.readUint32();
    const stringLen = reader.readUint32();
    reader.skip(8);
    if (stringLen > 0) {
      if (stringType === 2) {
        obj.stringValue = reader.readUtf8(stringLen);
      } else {
        obj.stringValue = reader.readUtf16LE(stringLen);
      }
    }
  } else {
    const bodyLen = totalLen - headerLen;
    if (bodyLen > 0) {
      reader.seek(startOffset + headerLen);
      obj.rawBody = reader.readBytes(bodyLen);
    }
  }

  reader.seek(startOffset + totalLen);
  return { object: obj, bytesRead: totalLen };
}

/**
 * Map well-known string MHOD types to ItdbTrack property names.
 */
export const MHOD_STRING_FIELDS: Record<number, string> = {
  [MhodType.TITLE]:              'title',
  [MhodType.PATH]:               'path',
  [MhodType.ALBUM]:              'album',
  [MhodType.ARTIST]:             'artist',
  [MhodType.GENRE]:              'genre',
  [MhodType.FILETYPE]:           'fileTypeString',
  [MhodType.COMMENT]:            'comment',
  [MhodType.COMPOSER]:           'composer',
  [MhodType.GROUPING]:           'grouping',
  [MhodType.DESCRIPTION]:        'description',
  [MhodType.ALBUM_ARTIST]:       'albumArtist',
  [MhodType.SORT_TITLE]:         'sortTitle',
  [MhodType.SORT_ALBUM]:         'sortAlbum',
  [MhodType.SORT_ARTIST]:        'sortArtist',
  [MhodType.SORT_ALBUM_ARTIST]:  'sortAlbumArtist',
  [MhodType.SORT_COMPOSER]:      'sortComposer',
};
