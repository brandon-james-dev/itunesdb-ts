import { ItdbBinaryWriter } from '../../common/binary/writer.js';
import { ARTWORKDB_HEADER_SIZES } from '../constants/index.js';
import type { ItdbImageItem, ItdbThumbnail, ItdbFileInfo } from './types.js';
import type { ArtworkDB } from './ArtworkDB.js';

/**
 * Serialize a parsed {@link ArtworkDB} back into its binary format.
 *
 * Preserves raw header bytes for round-trip fidelity, patching only
 * the fields that are explicitly modelled.
 *
 * @param db - The ArtworkDB object to serialize.
 * @returns An ArrayBuffer containing the binary ArtworkDB file.
 */
export function writeArtworkDatabase(db: ArtworkDB): ArrayBuffer {
  const writer = new ItdbBinaryWriter(16 * 1024);

  const headerLen = Math.max(ARTWORKDB_HEADER_SIZES.MHFD, db.rawHeader.length);
  if (db.rawHeader.length > 0) {
    writer.writeBytes(db.rawHeader);
  } else {
    writer.writeMagic('mhfd');
    writer.writeUint32(headerLen);
    writer.skip(headerLen - 8);
  }

  writer.seek(4);
  writer.writeUint32(headerLen);
  writer.seek(0x10);
  writer.writeUint32(6);
  writer.writeUint32(3);
  writer.skip(4);
  writer.writeUint32(db.nextId);

  writer.seek(headerLen);

  writeImageSection(writer, db.images);
  writeAlbumSection(writer);
  writeFileSection(writer, db.fileInfos);

  const totalLen = writer.offset;
  writer.seek(8);
  writer.writeUint32(totalLen);

  writer.seek(totalLen);
  return writer.finalize();
}

function writeImageSection(writer: ItdbBinaryWriter, images: ItdbImageItem[]): void {
  const sectionStart = writer.offset;
  const sectionHeaderLen = ARTWORKDB_HEADER_SIZES.MHSD;

  writer.writeMagic('mhsd');
  writer.writeUint32(sectionHeaderLen);
  const sectionTotalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint16(1);
  writer.skip(sectionHeaderLen - 14);

  const mhliHeaderLen = ARTWORKDB_HEADER_SIZES.MHLI;
  writer.writeMagic('mhli');
  writer.writeUint32(mhliHeaderLen);
  writer.writeUint32(images.length);
  writer.skip(mhliHeaderLen - 12);

  for (const image of images) {
    writeItdbImageItem(writer, image);
  }

  const sectionTotal = writer.offset - sectionStart;
  writer.patchUint32(sectionTotalLenOffset, sectionTotal);
}

function writeItdbImageItem(writer: ItdbBinaryWriter, image: ItdbImageItem): void {
  const headerLen = Math.max(ARTWORKDB_HEADER_SIZES.MHII, image.rawHeader.length);
  const startOffset = writer.offset;

  if (image.rawHeader.length > 0) {
    writer.writeBytes(image.rawHeader);
  } else {
    writer.writeMagic('mhii');
    writer.writeUint32(headerLen);
    writer.skip(headerLen - 8);
  }

  writer.seek(startOffset + 4);
  writer.writeUint32(headerLen);
  const totalLenOffset = startOffset + 8;

  writer.seek(startOffset + 0x0C);
  writer.writeUint32(image.thumbnails.length);
  writer.writeUint32(image.imageId);
  writer.writeUint64(image.songId);
  writer.skip(4);
  writer.writeUint32(image.rating);
  writer.skip(4);
  writer.writeUint32(image.originalDate);
  writer.writeUint32(image.digitizedDate);
  writer.writeUint32(image.originalImageSize);

  writer.seek(startOffset + headerLen);

  for (const thumb of image.thumbnails) {
    writeItdbThumbnailContainer(writer, thumb);
  }

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}

function writeItdbThumbnailContainer(writer: ItdbBinaryWriter, thumb: ItdbThumbnail): void {
  const containerStart = writer.offset;
  const mhodHeaderLen = ARTWORKDB_HEADER_SIZES.MHOD;

  writer.writeMagic('mhod');
  writer.writeUint32(mhodHeaderLen);
  const containerTotalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint16(2);
  writer.skip(mhodHeaderLen - 14);

  writeItdbThumbnailInfo(writer, thumb);

  const containerTotal = writer.offset - containerStart;
  writer.patchUint32(containerTotalLenOffset, containerTotal);
}

function writeItdbThumbnailInfo(writer: ItdbBinaryWriter, thumb: ItdbThumbnail): void {
  const headerLen = Math.max(ARTWORKDB_HEADER_SIZES.MHNI, thumb.rawHeader.length);
  const startOffset = writer.offset;

  if (thumb.rawHeader.length > 0) {
    writer.writeBytes(thumb.rawHeader);
  } else {
    writer.writeMagic('mhni');
    writer.writeUint32(headerLen);
    writer.skip(headerLen - 8);
  }

  writer.seek(startOffset + 4);
  writer.writeUint32(headerLen);
  const totalLenOffset = startOffset + 8;

  const hasFilename = thumb.filename.length > 0;
  writer.seek(startOffset + 0x0C);
  writer.writeUint32(hasFilename ? 1 : 0);
  writer.writeUint32(thumb.formatId);
  writer.writeUint32(thumb.itmbOffset);
  writer.writeUint32(thumb.imageSize);
  writer.writeUint16(thumb.verticalPadding);
  writer.writeUint16(thumb.horizontalPadding);
  writer.writeUint16(thumb.imageHeight);
  writer.writeUint16(thumb.imageWidth);

  writer.seek(startOffset + headerLen);

  if (hasFilename) {
    writeFilenameString(writer, thumb.filename);
  }

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}

function writeFilenameString(writer: ItdbBinaryWriter, filename: string): void {
  const mhodHeaderLen = ARTWORKDB_HEADER_SIZES.MHOD;
  const startOffset = writer.offset;

  const strBytes = filename.length * 2;

  writer.writeMagic('mhod');
  writer.writeUint32(mhodHeaderLen);
  const totalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint16(3);
  writer.skip(mhodHeaderLen - 14);

  writer.writeUint32(strBytes);
  writer.writeUint8(2);
  writer.skip(3);
  writer.skip(4);
  writer.writeUtf16LE(filename);

  const totalLen = writer.offset - startOffset;
  writer.patchUint32(totalLenOffset, totalLen);
}

function writeAlbumSection(writer: ItdbBinaryWriter): void {
  const sectionStart = writer.offset;
  const sectionHeaderLen = ARTWORKDB_HEADER_SIZES.MHSD;

  writer.writeMagic('mhsd');
  writer.writeUint32(sectionHeaderLen);
  const sectionTotalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint16(2);
  writer.skip(sectionHeaderLen - 14);

  const mhlaHeaderLen = ARTWORKDB_HEADER_SIZES.MHLA;
  writer.writeMagic('mhla');
  writer.writeUint32(mhlaHeaderLen);
  writer.writeUint32(0);
  writer.skip(mhlaHeaderLen - 12);

  const sectionTotal = writer.offset - sectionStart;
  writer.patchUint32(sectionTotalLenOffset, sectionTotal);
}

function writeFileSection(writer: ItdbBinaryWriter, fileInfos: ItdbFileInfo[]): void {
  const sectionStart = writer.offset;
  const sectionHeaderLen = ARTWORKDB_HEADER_SIZES.MHSD;

  writer.writeMagic('mhsd');
  writer.writeUint32(sectionHeaderLen);
  const sectionTotalLenOffset = writer.offset;
  writer.writeUint32(0);
  writer.writeUint16(3);
  writer.skip(sectionHeaderLen - 14);

  const mhlfHeaderLen = ARTWORKDB_HEADER_SIZES.MHLF;
  writer.writeMagic('mhlf');
  writer.writeUint32(mhlfHeaderLen);
  writer.writeUint32(fileInfos.length);
  writer.skip(mhlfHeaderLen - 12);

  for (const info of fileInfos) {
    writeItdbFileInfo(writer, info);
  }

  const sectionTotal = writer.offset - sectionStart;
  writer.patchUint32(sectionTotalLenOffset, sectionTotal);
}

function writeItdbFileInfo(writer: ItdbBinaryWriter, info: ItdbFileInfo): void {
  const headerLen = Math.max(ARTWORKDB_HEADER_SIZES.MHIF, info.rawHeader.length);
  const startOffset = writer.offset;

  if (info.rawHeader.length > 0) {
    writer.writeBytes(info.rawHeader);
  } else {
    writer.writeMagic('mhif');
    writer.writeUint32(headerLen);
    writer.skip(headerLen - 8);
  }

  writer.seek(startOffset + 4);
  writer.writeUint32(headerLen);

  writer.seek(startOffset + 8);
  writer.writeUint32(headerLen);

  writer.seek(startOffset + 0x10);
  writer.writeUint32(info.formatId);
  writer.writeUint32(info.imageSize);

  writer.seek(startOffset + headerLen);
}
