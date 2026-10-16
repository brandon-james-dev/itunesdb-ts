import { detectImageMimeType } from '../../artworkdb/artwork/decodeImage.js';

export interface ItdbEmbeddedArtwork {
  mimeType: string;
  data: Uint8Array;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readSynchsafe(bytes: Uint8Array, offset: number, len: number): number {
  let value = 0;
  for (let i = 0; i < len; i++) value = (value << 7) | (bytes[offset + i] & 0x7f);
  return value;
}

function asci(bytes: Uint8Array, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]);
  return s;
}

function findUtf16Terminator(bytes: Uint8Array, offset: number): number {
  for (let i = offset; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  }
  return -1;
}

function inferMime(data: Uint8Array, fallback: string): string {
  const detected = detectImageMimeType(data);
  return detected === 'application/octet-stream' ? fallback : detected;
}

function parseApic(payload: Uint8Array): ItdbEmbeddedArtwork | null {
  if (payload.length < 4) return null;
  const encoding = payload[0];
  let pos = 1;
  const mimeEnd = payload.indexOf(0, pos);
  if (mimeEnd === -1) return null;
  const mimeType = asci(payload, pos, mimeEnd - pos);
  pos = mimeEnd + 1;
  if (pos + 1 > payload.length) return null;
  pos += 1;
  if (encoding === 1 || encoding === 2) {
    const term = findUtf16Terminator(payload, pos);
    if (term === -1) return null;
    pos = term + 2;
  } else {
    const term = payload.indexOf(0, pos);
    if (term === -1) return null;
    pos = term + 1;
  }
  const data = payload.subarray(pos);
  if (data.length === 0) return null;
  return { mimeType: inferMime(data, mimeType || 'image/jpeg'), data };
}

function parsePic(payload: Uint8Array): ItdbEmbeddedArtwork | null {
  if (payload.length < 6) return null;
  const encoding = payload[0];
  const format = asci(payload, 1, 3).toUpperCase();
  let pos = 5;
  if (encoding === 1 || encoding === 2) {
    const term = findUtf16Terminator(payload, pos);
    if (term === -1) return null;
    pos = term + 2;
  } else {
    const term = payload.indexOf(0, pos);
    if (term === -1) return null;
    pos = term + 1;
  }
  const data = payload.subarray(pos);
  if (data.length === 0) return null;
  const mimeType = format === 'PNG' ? 'image/png' : format === 'JPG' || format === 'PIC' || format === 'BMP' ? 'image/jpeg' : 'image/jpeg';
  return { mimeType: inferMime(data, mimeType), data };
}

function extractId3v2(bytes: Uint8Array): ItdbEmbeddedArtwork | null {
  if (bytes.length < 10 || asci(bytes, 0, 3) !== 'ID3') return null;
  const version = bytes[3];
  const tagSize = readSynchsafe(bytes, 6, 4);
  const end = Math.min(bytes.length, 10 + tagSize);
  let pos = 10;
  if (version === 2) {
    while (pos + 6 <= end) {
      const id = asci(bytes, pos, 3);
      const size = readU32Stretch(bytes, pos + 3, 3);
      const payload = bytes.subarray(pos + 6, pos + 6 + size);
      if (id === 'PIC') {
        const art = parsePic(payload);
        if (art) return art;
      }
      pos += 6 + size;
    }
    return null;
  }
  const frameSizeIsSynchsafe = version === 4;
  while (pos + 10 <= end) {
    const id = asci(bytes, pos, 4);
    if (id.charCodeAt(0) === 0) break;
    const size = frameSizeIsSynchsafe ? readSynchsafe(bytes, pos + 4, 4) : readU32(bytes, pos + 4);
    const payload = bytes.subarray(pos + 10, pos + 10 + size);
    if (id === 'APIC') {
      const art = parseApic(payload);
      if (art) return art;
    }
    pos += 10 + size;
  }
  return null;
}

function readU32Stretch(bytes: Uint8Array, offset: number, len: number): number {
  let value = 0;
  for (let i = 0; i < len; i++) value = (value << 8) | bytes[offset + i];
  return value;
}

interface ItdbAtom {
  type: string;
  header: number;
  start: number;
  end: number;
}

function* atoms(bytes: Uint8Array, start: number, end: number): Generator<ItdbAtom> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = readU32(bytes, pos);
    const type = asci(bytes, pos + 4, 4);
    let header = 8;
    if (size === 1 && pos + 16 <= end) {
      const hi = readU32(bytes, pos + 8);
      const lo = readU32(bytes, pos + 12);
      size = hi * 0x100000000 + lo;
      header = 16;
    }
    if (size === 0) size = end - pos;
    if (size < header || pos + size > end) return;
    yield { type, header, start: pos + header, end: pos + size };
    pos += size;
  }
}

function findDescendant(bytes: Uint8Array, parentStart: number, parentEnd: number, target: string): ItdbAtom | null {
  const stack: Array<[number, number]> = [[parentStart, parentEnd]];
  let guard = 0;
  while (stack.length > 0 && guard++ < 16) {
    const [start, end] = stack.pop()!;
    for (const atom of atoms(bytes, start, end)) {
      if (atom.type === target) return atom;
      const childStart = atom.type === 'meta' ? atom.start + 4 : atom.start;
      if (atom.end - childStart >= 8) stack.push([childStart, atom.end]);
    }
  }
  return null;
}

function extractMp4Covr(bytes: Uint8Array): ItdbEmbeddedArtwork | null {
  const covr = findDescendant(bytes, 0, bytes.length, 'covr');
  if (!covr) return null;
  const data = findDescendant(bytes, covr.start, covr.end, 'data');
  if (!data) return null;
  const payload = bytes.subarray(data.start + 8, data.end);
  if (payload.length === 0) return null;
  return { mimeType: inferMime(payload, 'image/jpeg'), data: payload };
}

function extractFlac(bytes: Uint8Array): ItdbEmbeddedArtwork | null {
  if (asci(bytes, 0, 4) !== 'fLaC') return null;
  let pos = 4;
  let last = 0;
  while (pos + 4 <= bytes.length && !last) {
    const header = bytes[pos];
    last = header & 0x80;
    const type = header & 0x7f;
    const length = readU32Stretch(bytes, pos + 1, 3);
    pos += 4;
    if (type === 6 && pos + length <= bytes.length) {
      const block = bytes.subarray(pos, pos + length);
      if (block.length < 8) return null;
      const mimeLen = readU32(block, 4);
      if (block.length < 8 + mimeLen + 4 + 16) return null;
      const mimeType = asci(block, 8, mimeLen);
      const descLen = readU32(block, 8 + mimeLen);
      const dataOffset = 12 + mimeLen + descLen + 16;
      if (block.length < dataOffset + 4) return null;
      const dataLen = readU32(block, dataOffset - 4);
      const imageData = block.subarray(dataOffset, dataOffset + dataLen);
      if (imageData.length === 0) return null;
      return { mimeType: inferMime(imageData, mimeType), data: imageData };
    }
    pos += length;
  }
  return null;
}

/**
 * Extract embedded album artwork from audio file bytes.
 *
 * Supports MP3 (ID3v2.2 `PIC` / ID3v2.3+ `APIC` frames), M4A/MP4/AAC
 * (`covr` atoms) and FLAC (`PICTURE` metadata blocks). Returns the
 * raw image bytes and detected MIME type, or `null` when no artwork
 * is embedded. Pure byte-scanning — no streaming, no dependencies.
 */
export function extractEmbeddedArtwork(bytes: Uint8Array): ItdbEmbeddedArtwork | null {
  return extractId3v2(bytes) ?? extractMp4Covr(bytes) ?? extractFlac(bytes);
}
