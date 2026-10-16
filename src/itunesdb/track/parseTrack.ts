import { ItdbBinaryReader } from '../../common/binary/reader.js';
import type { ItdbTrack } from './types.js';
import { parseDataObject, MHOD_STRING_FIELDS } from './parseDataObject.js';

/**
 * Parse a single MHIT (track) record and its MHOD children from the iTunesDB.
 *
 * Reads the 584-byte (or larger) mhit header and then iterates over
 * the declared number of child mhod records. Recognised string MHODs
 * are promoted to named properties on the returned ItdbTrack object.
 *
 * @param reader - An ItdbBinaryReader positioned at the start of an `mhit` record.
 * @returns The parsed ItdbTrack and the total number of bytes consumed.
 */
export function parseTrack(reader: ItdbBinaryReader): { track: ItdbTrack; bytesRead: number } {
  const startOffset = reader.offset;

  const magic = reader.readMagic();
  if (magic !== 'mhit') {
    throw new Error(`Expected mhit magic at offset ${startOffset}, got "${magic}"`);
  }

  const headerLen = reader.readUint32();
  const totalLen = reader.readUint32();
  const numMhod = reader.readUint32();

  const rawHeader = new Uint8Array(reader.subreader(startOffset).readBytes(headerLen));

  reader.seek(startOffset + 0x10);
  const trackId = reader.readUint32();
  const visible = reader.readUint32();
  const filetype = reader.readUint32();
  const type = reader.readUint16();
  const compilation = reader.readUint8();
  const rating = reader.readUint8();
  const dateAdded = reader.readUint32();
  const size = reader.readUint32();
  const length = reader.readUint32();
  const trackNumber = reader.readUint32();
  const trackTotal = reader.readUint32();
  const year = reader.readUint32();
  const bitrate = reader.readUint32();
  const sampleRateRaw = reader.readUint32();
  const sampleRate = sampleRateRaw >>> 16;
  const volume = reader.readInt32();
  const startTime = reader.readUint32();
  const stopTime = reader.readUint32();
  const soundCheck = reader.readUint32();
  const playCount = reader.readUint32();
  reader.skip(4);
  const lastPlayed = reader.readUint32();
  const discNumber = reader.readUint32();
  const discTotal = reader.readUint32();
  reader.skip(4);
  const lastModified = reader.readUint32();
  const bookmarkTime = reader.readUint32();
  const dbid = reader.readUint64();
  reader.skip(2);
  const bpm = reader.readUint16();
  const artworkCount = reader.readUint16();
  reader.skip(2);
  const artworkSize = reader.readUint32();

  reader.seek(startOffset + 0xA4);
  const hasArtwork = reader.readUint8();

  reader.seek(startOffset + 0xD0);
  const mediatype = reader.readUint32();
  const seasonNumber = reader.readUint32();
  const episodeNumber = reader.readUint32();

  reader.seek(startOffset + 0x120);
  const albumId = reader.readUint32();

  // +0x124: the library id mirror (libgpod: "same as mhbd+0x24, purpose
  // unknown"). Apple writes the SAME 64-bit library id here as in the mhbd
  // header — every track in the library carries it. Apple's parser checks
  // this match; a track with 0 here is flagged corrupt ("needs restore").
  const libraryId = reader.readUint64();

  reader.seek(startOffset + 0x160);
  const mhiiLink = reader.readUint32();

  reader.seek(startOffset + 0x1E0);
  const artistId = reader.readUint32();

  reader.seek(startOffset + 0x1F4);
  const composerId = reader.readUint32();

  const track: ItdbTrack = {
    trackId, visible, filetype, type, compilation, rating,
    dateAdded, size, length, trackNumber, trackTotal, year,
    bitrate, sampleRate, volume, startTime, stopTime, soundCheck,
    playCount, lastPlayed, discNumber, discTotal,
    lastModified, bookmarkTime, dbid, bpm,
    artworkCount, artworkSize, hasArtwork, mediatype,
    seasonNumber, episodeNumber, albumId, libraryId, mhiiLink, artistId, composerId,
    dataObjects: [],
    rawHeader,
  };

  reader.seek(startOffset + headerLen);
  for (let i = 0; i < numMhod; i++) {
    const { object } = parseDataObject(reader);
    track.dataObjects.push(object);
    const fieldName = MHOD_STRING_FIELDS[object.type];
    if (fieldName && object.stringValue !== undefined) {
      (track as unknown as Record<string, unknown>)[fieldName] = object.stringValue;
    }
  }

  reader.seek(startOffset + totalLen);
  return { track, bytesRead: totalLen };
}
