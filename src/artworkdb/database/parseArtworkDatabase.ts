import { ItdbBinaryReader } from '../../common/binary/reader.js';
import type { ItdbImageItem, ItdbThumbnail, ItdbFileInfo } from './types.js';
import { ArtworkDB } from './ArtworkDB.js';

/**
 * Parse an entire ArtworkDB binary file into a structured object.
 *
 * Accepts an `ArrayBuffer` containing the raw ArtworkDB data and
 * returns a fully parsed {@link ArtworkDB} with images, thumbnails,
 * and file info records.
 *
 * @param buffer - The raw bytes of the ArtworkDB file.
 * @returns A parsed ArtworkDB object.
 * @throws If the file does not start with the `mhfd` magic.
 */
export function parseArtworkDatabase(buffer: ArrayBuffer): ArtworkDB {
  const reader = new ItdbBinaryReader(buffer);

  const magic = reader.readMagic();
  if (magic !== 'mhfd') {
    throw new Error(`Not an ArtworkDB file: expected "mhfd", got "${magic}"`);
  }

  const headerLen = reader.readUint32();
  reader.readUint32(); // totalLen — declared record length, not needed by the parser
  reader.skip(4);
  const version = reader.readUint32();
  const numChildren = reader.readUint32();
  reader.skip(4);
  const nextId = reader.readUint32();

  const rawHeader = new Uint8Array(new ItdbBinaryReader(buffer).readBytes(headerLen));

  const images: ItdbImageItem[] = [];
  const fileInfos: ItdbFileInfo[] = [];

  reader.seek(headerLen);

  for (let s = 0; s < numChildren; s++) {
    const sectionStart = reader.offset;
    if (reader.remaining < 12) break;
    const sectionMagic = reader.readMagic();
    if (sectionMagic !== 'mhsd') {
      reader.seek(sectionStart);
      break;
    }
    const sectionHeaderLen = reader.readUint32();
    const sectionTotalLen = reader.readUint32();
    const sectionIndex = reader.readUint16();

    reader.seek(sectionStart + sectionHeaderLen);

    if (sectionIndex === 1) {
      parseImageList(reader, images);
    } else if (sectionIndex === 3) {
      parseFileList(reader, fileInfos);
    }

    reader.seek(sectionStart + sectionTotalLen);
  }

  return new ArtworkDB({ version, numChildren, nextId, images, fileInfos, rawHeader } as ArtworkDB);
}

function parseImageList(reader: ItdbBinaryReader, images: ItdbImageItem[]): void {
  const start = reader.offset;
  const magic = reader.readMagic();
  if (magic !== 'mhli') return;
  const headerLen = reader.readUint32();
  const numChildren = reader.readUint32();

  reader.seek(start + headerLen);
  for (let i = 0; i < numChildren; i++) {
    const img = parseImageItem(reader);
    if (img) images.push(img);
  }
}

function parseImageItem(reader: ItdbBinaryReader): ItdbImageItem | null {
  const start = reader.offset;
  const magic = reader.readMagic();
  if (magic !== 'mhii') return null;

  const headerLen = reader.readUint32();
  const totalLen = reader.readUint32();
  const numChildren = reader.readUint32();
  const imageId = reader.readUint32();
  const songId = reader.readUint64();
  reader.skip(4);
  const rating = reader.readUint32();
  reader.skip(4);
  const originalDate = reader.readUint32();
  const digitizedDate = reader.readUint32();
  const originalImageSize = reader.readUint32();

  const rawHeader = new Uint8Array(reader.subreader(start).readBytes(headerLen));
  const thumbnails: ItdbThumbnail[] = [];

  reader.seek(start + headerLen);

  let remaining = numChildren;
  while (remaining > 0 && reader.offset < start + totalLen) {
    const childStart = reader.offset;
    const childMagic = reader.readMagic();

    if (childMagic === 'mhod') {
      const childHeaderLen = reader.readUint32();
      const childTotalLen = reader.readUint32();
      const childType = reader.readUint16();

      if (childType === 2) {
        reader.seek(childStart + childHeaderLen);
        const thumb = parseThumbnailContainer(reader, childStart + childTotalLen);
        if (thumb) thumbnails.push(thumb);
      }

      reader.seek(childStart + childTotalLen);
      remaining--;
    } else {
      reader.seek(childStart);
      break;
    }
  }

  reader.seek(start + totalLen);
  return { imageId, songId, rating, originalDate, digitizedDate, originalImageSize, thumbnails, rawHeader };
}

function parseThumbnailContainer(reader: ItdbBinaryReader, _containerEnd: number): ItdbThumbnail | null {
  const mhniStart = reader.offset;
  if (reader.remaining < 4) return null;

  const magic = reader.readMagic();
  if (magic !== 'mhni') return null;

  const headerLen = reader.readUint32();
  const totalLen = reader.readUint32();
  const numChildren = reader.readUint32();
  const formatId = reader.readUint32();
  const itmbOffset = reader.readUint32();
  const imageSize = reader.readUint32();
  const verticalPadding = reader.readUint16();
  const horizontalPadding = reader.readUint16();
  const imageHeight = reader.readUint16();
  const imageWidth = reader.readUint16();

  const rawHeader = new Uint8Array(reader.subreader(mhniStart).readBytes(headerLen));

  let filename = '';
  reader.seek(mhniStart + headerLen);

  for (let i = 0; i < numChildren; i++) {
    const childStart = reader.offset;
    if (reader.remaining < 12) break;
    const childMagic = reader.readMagic();
    if (childMagic !== 'mhod') {
      reader.seek(childStart);
      break;
    }
    const childHeaderLen = reader.readUint32();
    const childTotalLen = reader.readUint32();
    const childType = reader.readUint16();

    if (childType === 3) {
      reader.seek(childStart + childHeaderLen);
      const strLen = reader.readUint32();
      const encoding = reader.readUint8();
      reader.skip(3);
      reader.skip(4);
      if (encoding === 2) {
        filename = reader.readUtf16LE(strLen);
      } else {
        filename = reader.readUtf8(strLen);
      }
    }

    reader.seek(childStart + childTotalLen);
  }

  reader.seek(mhniStart + totalLen);
  return { formatId, itmbOffset, imageSize, verticalPadding, horizontalPadding, imageHeight, imageWidth, filename, rawHeader };
}

function parseFileList(reader: ItdbBinaryReader, fileInfos: ItdbFileInfo[]): void {
  const start = reader.offset;
  const magic = reader.readMagic();
  if (magic !== 'mhlf') return;
  const headerLen = reader.readUint32();
  const numChildren = reader.readUint32();

  reader.seek(start + headerLen);
  for (let i = 0; i < numChildren; i++) {
    const infoStart = reader.offset;
    const infoMagic = reader.readMagic();
    if (infoMagic !== 'mhif') {
      reader.seek(infoStart);
      break;
    }
    const infoHeaderLen = reader.readUint32();
    const infoTotalLen = reader.readUint32();
    reader.skip(4);
    const formatId = reader.readUint32();
    const imageSize = reader.readUint32();

    const rawHeader = new Uint8Array(reader.subreader(infoStart).readBytes(infoHeaderLen));

    fileInfos.push({ formatId, imageSize, rawHeader });
    reader.seek(infoStart + infoTotalLen);
  }
}
