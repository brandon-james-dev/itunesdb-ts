import { ItdbBinaryWriter } from '../../common/binary/writer.js';
import { isStringMhodType, isPodcastMhodType, ITUNESDB_HEADER_SIZES, MhodType } from '../constants/index.js';
import type { ItdbDataObject } from './types.js';

/**
 * Write a single MHOD (data object) record to an ItdbBinaryWriter.
 *
 * String-type MHODs are always written as UTF-16LE (matching the
 * standard iPod encoding), except podcast URL/RSS types which are
 * written as raw UTF-8.
 *
 * @param writer - The ItdbBinaryWriter to append the record to.
 * @param obj    - The ItdbDataObject to serialize.
 */
export function writeDataObject(writer: ItdbBinaryWriter, obj: ItdbDataObject): void {
  const headerLen = ITUNESDB_HEADER_SIZES.MHOD;
  const startOffset = writer.offset;

  writer.writeMagic('mhod');
  writer.writeUint32(headerLen);
  const totalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint32(obj.type);
  writer.writeUint32(0);
  writer.writeUint32(0);

  if (isPodcastMhodType(obj.type) && obj.stringValue !== undefined) {
    writer.writeUtf8(obj.stringValue);
  } else if (obj.type === MhodType.THMB) {
    if (obj.rawBody) writer.writeBytes(obj.rawBody);
  } else if ((isStringMhodType(obj.type) || obj.type === 200 || obj.type === 201 || obj.type === MhodType.ALBUM_ARTIST_MHII) && obj.stringValue !== undefined) {
    const strBytes = obj.stringValue.length * 2;
    writer.writeUint32(1);
    writer.writeUint32(strBytes);
    writer.writeUint32(1);
    writer.writeUint32(0);
    writer.writeUtf16LE(obj.stringValue);
  } else if (obj.rawBody) {
    writer.writeBytes(obj.rawBody);
  }

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}
