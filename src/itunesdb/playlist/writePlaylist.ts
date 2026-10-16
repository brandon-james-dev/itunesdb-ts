import { ItdbBinaryWriter } from '../../common/binary/writer.js';
import { ITUNESDB_HEADER_SIZES } from '../constants/index.js';
import type { ItdbPlaylist, ItdbPlaylistItem } from './types.js';
import type { ItdbDataObject } from '../track/types.js';
import { writeDataObject } from '../track/writeDataObject.js';

/**
 * Write a single MHYP (playlist) record and its children to the writer.
 *
 * Uses the preserved `rawHeader` for round-trip fidelity and patches
 * known fields on top. Each mhip item is written with its child MHODs;
 * items without preserved children get a type-100 (playlist position)
 * MHOD so playlist ordering survives on the device, matching iTunes.
 *
 * @param writer   - The ItdbBinaryWriter to append the record to.
 * @param playlist - The ItdbPlaylist object to serialize.
 */
export function writePlaylist(writer: ItdbBinaryWriter, playlist: ItdbPlaylist): void {
  const headerLen = Math.max(ITUNESDB_HEADER_SIZES.MHYP, playlist.rawHeader.length);
  const startOffset = writer.offset;

  if (playlist.rawHeader.length > 0) {
    writer.writeBytes(playlist.rawHeader);
  } else {
    writer.writeMagic('mhyp');
    writer.writeUint32(headerLen);
    writer.skip(headerLen - 8);
  }

  writer.seek(startOffset + 4);
  writer.writeUint32(headerLen);
  const totalLenOffset = startOffset + 8;

  writer.seek(startOffset + 0x0C);
  writer.writeUint32(playlist.dataObjects.length);
  writer.writeUint32(playlist.items.length);
  writer.writeUint32(playlist.hidden);
  writer.writeUint32(playlist.timestamp);
  writer.writeUint64(playlist.playlistId);

  writer.seek(startOffset + 0x44);
  writer.writeUint32(playlist.sortOrder);

  writer.seek(startOffset + headerLen);

  for (const obj of playlist.dataObjects) {
    writeDataObject(writer, obj);
  }

  for (let i = 0; i < playlist.items.length; i++) {
    writePlaylistItem(writer, playlist.items[i]!, i);
  }

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}

function writePlaylistItem(writer: ItdbBinaryWriter, item: ItdbPlaylistItem, position: number): void {
  const headerLen = Math.max(ITUNESDB_HEADER_SIZES.MHIP, item.rawHeader.length);
  const startOffset = writer.offset;
  const children = item.objects && item.objects.length > 0
    ? item.objects
    : [{ type: 100, rawBody: uint32le(position + 1) } as ItdbDataObject];

  if (item.rawHeader.length > 0) {
    writer.writeBytes(item.rawHeader);
  } else {
    writer.writeMagic('mhip');
    writer.writeUint32(headerLen);
    writer.skip(headerLen - 8);
  }

  writer.seek(startOffset + 4);
  writer.writeUint32(headerLen);
  const totalLenOffset = startOffset + 8;

  writer.seek(startOffset + 0x0C);
  writer.writeUint32(children.length);
  writer.skip(8);
  writer.writeUint32(item.trackId);
  writer.writeUint32(item.timestamp);

  writer.seek(startOffset + headerLen);

  for (const obj of children) {
    writeDataObject(writer, obj);
  }

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}

function uint32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}
