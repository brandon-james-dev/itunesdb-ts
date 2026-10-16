import { ItdbBinaryReader } from '../../common/binary/reader.js';
import type { ItdbDataObject } from '../track/types.js';
import type { ItdbPlaylist, ItdbPlaylistItem } from './types.js';
import { parseDataObject } from '../track/parseDataObject.js';

/**
 * Parse a single MHYP (playlist) record and its MHOD/MHIP children.
 *
 * @param reader - An ItdbBinaryReader positioned at the start of an `mhyp` record.
 * @returns The parsed ItdbPlaylist and total bytes consumed.
 */
export function parsePlaylist(reader: ItdbBinaryReader): { playlist: ItdbPlaylist; bytesRead: number } {
  const startOffset = reader.offset;

  const magic = reader.readMagic();
  if (magic !== 'mhyp') {
    throw new Error(`Expected mhyp magic at offset ${startOffset}, got "${magic}"`);
  }

  const headerLen = reader.readUint32();
  const totalLen = reader.readUint32();
  const numMhod = reader.readUint32();
  const numItems = reader.readUint32();
  const hidden = reader.readUint32();
  const timestamp = reader.readUint32();
  const playlistId = reader.readUint64();

  reader.seek(startOffset + 0x44);
  const sortOrder = reader.readUint32();

  const rawHeader = new Uint8Array(reader.subreader(startOffset).readBytes(headerLen));

  const dataObjects: ItdbDataObject[] = [];
  const items: ItdbPlaylistItem[] = [];

  reader.seek(startOffset + headerLen);

  for (let i = 0; i < numMhod; i++) {
    const peekMagic = reader.readMagic();
    reader.seek(reader.offset - 4);

    if (peekMagic === 'mhod') {
      const { object } = parseDataObject(reader);
      dataObjects.push(object);
    } else {
      break;
    }
  }

  for (let i = 0; i < numItems; i++) {
    const itemStart = reader.offset;
    const itemMagic = reader.readMagic();
    if (itemMagic !== 'mhip') {
      reader.seek(itemStart);
      break;
    }
    const itemHeaderLen = reader.readUint32();
    const itemTotalLen = reader.readUint32();
    const itemMhodNum = reader.readUint32();
    reader.skip(8);
    const trackId = reader.readUint32();
    const itemTimestamp = reader.readUint32();

    const itemRawHeader = new Uint8Array(reader.subreader(itemStart).readBytes(itemHeaderLen));

    const itemObjects: ItdbDataObject[] = [];
    reader.seek(itemStart + itemHeaderLen);
    for (let j = 0; j < itemMhodNum; j++) {
      const { object } = parseDataObject(reader);
      itemObjects.push(object);
    }

    items.push({
      trackId,
      timestamp: itemTimestamp,
      rawHeader: itemRawHeader,
      objects: itemObjects,
    });

    reader.seek(itemStart + itemTotalLen);
  }

  let name: string | undefined;
  for (const obj of dataObjects) {
    if (obj.type === 1 && obj.stringValue) {
      name = obj.stringValue;
      break;
    }
  }

  reader.seek(startOffset + totalLen);
  return {
    playlist: {
      playlistId, hidden, timestamp, sortOrder, name,
      items, dataObjects, rawHeader,
    },
    bytesRead: totalLen,
  };
}
