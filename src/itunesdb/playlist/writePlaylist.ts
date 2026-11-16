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
    writePlaylistItem(writer, playlist.items[i]!);
  }

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}

function writePlaylistItem(writer: ItdbBinaryWriter, item: ItdbPlaylistItem): void {
  const headerLen = Math.max(ITUNESDB_HEADER_SIZES.MHIP, item.rawHeader.length);
  const startOffset = writer.offset;
  const children = item.objects && item.objects.length > 0
    ? item.objects
    : [applePositionMhod(item)];

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

  // Apple mhip layout: trackId at +0x14, a companion id (the track's own
  // id) at +0x18, timestamp at +0x1c. libgpod writes the plain track id at
  // both and is accepted.
  // For PRESERVED (parsed) items, rawHeader already carries Apple's exact
  // +0x14/+0x18/+0x1c bytes — only patch in the child count above so
  // open->save stays byte-identical. Fresh items get the explicit fields.
  if (item.rawHeader.length === 0) {
    writer.skip(4);                                   // +0x10 = 0
    writer.writeUint32(item.trackId + 6);             // +0x14 (Apple's index/offset field)
    writer.writeUint32(item.trackId);                 // +0x18 (authoritative trackId)
    writer.writeUint32(3874157289);                   // +0x1c (Apple's fixed ts)
    // +0x20..+0x2f zeros (matching Apple's shape; libgpod omits these)
    writer.writeUint32(0);                            // +0x20
    writer.writeUint32(0);                            // +0x24
    writer.writeUint64(0n);                           // +0x28..+0x2f
    writer.seek(startOffset + 0x3c);
    writer.writeUint64(BigInt(item.trackId ?? 0));    // +0x3c (per-item uid)
  }

  writer.seek(startOffset + headerLen);


  for (const obj of children) {
    writeDataObject(writer, obj);
  }

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}

/**
 * Build the type-100 mhod child Apple writes inside an mhip. Apple's child
 * (verified byte-level) is a 44-byte mhod whose 20-byte body carries the
 * SAME trackId+6 value as the mhip's +0x14 field, at body byte 0:
 *   `49 09 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00`
 * so a 28-byte rawBody is needed to reach total==44 (24 mhod header + 20).
 */
function applePositionMhod(item: ItdbPlaylistItem): ItdbDataObject {
  const rawBody = new Uint8Array(20);
  new DataView(rawBody.buffer).setUint32(0, item.trackId + 6, true);
  return { type: 100, rawBody };
}
