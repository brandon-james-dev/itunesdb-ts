import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDatabase } from '../itunesdb/database/parseDatabase.js';
import { writeDatabase } from '../itunesdb/database/writeDatabase.js';
import { ITunesDB } from '../itunesdb/database/ITunesDB.js';
import { parseArtworkDatabase } from '../artworkdb/database/parseArtworkDatabase.js';
import { writeArtworkDatabase } from '../artworkdb/database/writeArtworkDatabase.js';
import { ArtworkDB } from '../artworkdb/database/ArtworkDB.js';
import { ARTWORKDB_FILE_RELATIVE_PATH } from '../artworkdb/constants/index.js';
import { detectDevice } from '../device/detectDevice.js';
import { encodePixels, decodePixels } from '../artworkdb/artwork/encodePixels.js';
import { resizeImage, rotateImage } from '../artworkdb/artwork/resizeImage.js';
import { addTrack } from '../itunesdb/sync/addTrack.js';
import { removeTrack } from '../itunesdb/sync/removeTrack.js';
import { writeTrack } from '../itunesdb/track/writeTrack.js';
import { ItdbBinaryWriter } from '../common/binary/writer.js';
import { extractEmbeddedArtwork } from '../itunesdb/metadata/extractEmbeddedArtwork.js';
import { Itdb, ItdbError, IpodPaths, locationToPath, pathToLocation } from '../ipod/Itdb.js';
import { createMemoryFs } from '../common/fs/MemoryFs.js';
import { createBrowserFs } from '../common/fs/browserFs.js';
import {
  sha1, hmacSha1, toHex, fromHex,
  applyHash58, HASH58_TABLE1, HASH58_TABLE2,
  applyHash72, buildHashInfo, extractHash72IvRandom, HASH72_SCHEME,
  checksumTypeForGeneration, checksumTypeForDevice,
} from '../common/checksum/index.js';
import { createNodeFs } from '../common/fs/nodeFs.js';
import { atomicWrite } from '../common/fs/atomic.js';
import { detectRuntime, createDefaultFs, createDefaultImageDecoder, findIpodRoot } from '../common/env.js';

const root = resolve(import.meta.dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

console.log('=== iTunesDB parse/write round-trip ===');
const itunesRaw = readFileSync(resolve(root, 'iTunesDB'));
const itunesBuffer = itunesRaw.buffer.slice(itunesRaw.byteOffset, itunesRaw.byteOffset + itunesRaw.byteLength);
const db = parseDatabase(itunesBuffer);

assert(db.version > 0, `DB version is ${db.version}`);
assert(db.tracks.length === 1, `Track count: ${db.tracks.length} (expected 1)`);
assert(db.playlists.length > 0, `Playlist count: ${db.playlists.length}`);

const track = db.tracks[0];
assert(typeof track.title === 'string' && track.title.length > 0, `Track title: "${track.title}"`);
assert(typeof track.path === 'string' && track.path.length > 0, `Track path: "${track.path}"`);
assert(track.dbid > 0n, `Track dbid: ${track.dbid}`);

console.log(`  Track: "${track.title}" by "${track.artist}" on "${track.album}"`);
console.log(`  Path: ${track.path}`);
console.log(`  Genre: ${track.genre}, Year: ${track.year}, Bitrate: ${track.bitrate}kbps`);

const rewritten = writeDatabase(db);
const reparsed = parseDatabase(rewritten);

assert(reparsed.tracks.length === db.tracks.length, `Round-trip track count matches: ${reparsed.tracks.length}`);
assert(reparsed.playlists.length === db.playlists.length, `Round-trip playlist count matches: ${reparsed.playlists.length}`);
assert(reparsed.tracks[0].title === track.title, `Round-trip title matches: "${reparsed.tracks[0].title}"`);
assert(reparsed.tracks[0].artist === track.artist, `Round-trip artist matches: "${reparsed.tracks[0].artist}"`);
assert(reparsed.tracks[0].path === track.path, `Round-trip path matches`);
assert(reparsed.tracks[0].dbid === track.dbid, `Round-trip dbid matches`);
assert(reparsed.tracks[0].bitrate === track.bitrate, `Round-trip bitrate matches: ${reparsed.tracks[0].bitrate}`);
{
  const u32 = (b: ArrayBuffer, o: number): number => new DataView(b).getUint32(o, true);
  const mgc = (b: ArrayBuffer, o: number): string => String.fromCharCode(...new Uint8Array(b).slice(o, o + 4));
  const headerLen = u32(rewritten, 4);
  const numChildren = u32(rewritten, 0x14);
  let seek = headerLen;
  for (let i = 0; i < numChildren; i++) {
    assert(mgc(rewritten, seek) === 'mhsd', `section ${i} is an mhsd`);
    const tot = u32(rewritten, seek + 8);
    const body = tot - u32(rewritten, seek + 4);
    assert(body > 0, `section ${i} (type ${u32(rewritten, seek + 12)}) is not an empty stub (body ${body} B)`);
    seek += tot;
  }
  assert(seek === rewritten.byteLength, 'sections cover the whole file');
}

console.log('\n=== ArtworkDB parse/write round-trip ===');
const artworkRaw = readFileSync(resolve(root, 'ArtworkDB'));
const artworkBuffer = artworkRaw.buffer.slice(artworkRaw.byteOffset, artworkRaw.byteOffset + artworkRaw.byteLength);
const artDb = parseArtworkDatabase(artworkBuffer);

assert(artDb.images.length > 0, `ArtworkDB image count: ${artDb.images.length}`);
assert(artDb.fileInfos.length > 0, `ArtworkDB fileInfo count: ${artDb.fileInfos.length}`);

for (const img of artDb.images) {
  console.log(`  Image ID=${img.imageId}, songId=${img.songId}, thumbnails=${img.thumbnails.length}`);
  for (const thumb of img.thumbnails) {
    console.log(`    Format ${thumb.formatId}: ${thumb.imageWidth}x${thumb.imageHeight}, offset=${thumb.itmbOffset}, size=${thumb.imageSize}, file="${thumb.filename}"`);
  }
}

const artRewritten = writeArtworkDatabase(artDb);
const artReparsed = parseArtworkDatabase(artRewritten);

assert(artReparsed.images.length === artDb.images.length, `Round-trip ArtworkDB image count matches`);
assert(artReparsed.fileInfos.length === artDb.fileInfos.length, `Round-trip ArtworkDB fileInfo count matches`);

if (artReparsed.images.length > 0 && artDb.images.length > 0) {
  assert(artReparsed.images[0].songId === artDb.images[0].songId, `Round-trip ArtworkDB songId matches`);
  if (artReparsed.images[0].thumbnails.length > 0 && artDb.images[0].thumbnails.length > 0) {
    const origThumb = artDb.images[0].thumbnails[0];
    const rtThumb = artReparsed.images[0].thumbnails[0];
    assert(rtThumb.formatId === origThumb.formatId, `Round-trip thumbnail formatId matches`);
    assert(rtThumb.imageWidth === origThumb.imageWidth, `Round-trip thumbnail width matches`);
    assert(rtThumb.imageHeight === origThumb.imageHeight, `Round-trip thumbnail height matches`);
  }
}

console.log('\n=== Device detection ===');
const sysInfo1 = 'ModelNumStr: MB598\nFireWireGUID: 0000A1B2C3D4E5F6\nSerialNumber: ABC123';
const dev1 = detectDevice(sysInfo1);
assert(dev1 !== null, 'Detected MB598');
assert(dev1!.name === 'iPod nano (4th generation)', `Friendly name: ${dev1!.name}`);
assert(dev1!.shortName === 'Nano 4G', `Short name: ${dev1!.shortName}`);
assert(dev1!.color === 'Silver', `Color: ${dev1!.color}`);
assert(dev1!.artworkFormats.length > 0, `Artwork formats: ${dev1!.artworkFormats.length}`);

const sysInfoXml = '<key>ModelNumStr</key>\n<string>MC293</string>';
const dev2 = detectDevice(sysInfoXml);
assert(dev2 !== null, 'Detected MC293 from XML');
assert(dev2!.shortName === 'Classic 3G', `Short name: ${dev2!.shortName}`);

let unknownThrew = false;
try {
  detectDevice('ModelNumStr: ZZZZZ');
} catch {
  unknownThrew = true;
}
assert(unknownThrew, 'Unknown model number throws');

function expectThrow(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const devModel = detectDevice('mb598');
assert(devModel.name === 'iPod nano (4th generation)', `Model-string detection: ${devModel.name}`);
assert(devModel.shortName === 'Nano 4G', `Model-string short name: ${devModel.shortName}`);

const devPidNum = detectDevice(0x1263);
assert(devPidNum.shortName === 'Nano 4G', `USB PID number 0x1263 -> ${devPidNum.shortName}`);
const devPidHex = detectDevice('0x1263');
assert(devPidHex.shortName === 'Nano 4G', `USB PID hex string 0x1263 -> ${devPidHex.shortName}`);
const devPidBare = detectDevice('1261');
assert(devPidBare.shortName === 'Classic 1G', `USB PID bare hex 1261 -> ${devPidBare.shortName}`);
const devPidShuffle = detectDevice(0x1301);
assert(devPidShuffle.shortName === 'Shuffle 2G', `USB PID 0x1301 -> ${devPidShuffle.shortName}`);
const devPidShuffle1 = detectDevice(0x1300);
assert(devPidShuffle1.shortName === 'Shuffle 1G', `USB PID 0x1300 -> ${devPidShuffle1.shortName}`);
assert(expectThrow(() => detectDevice(0x9999)), 'Unknown USB product ID throws');
assert(expectThrow(() => detectDevice('ZZZZZ')), 'Unknown model string throws');

console.log('\n=== Runtime inference ===');
assert(detectRuntime() === 'node', `detectRuntime() => ${detectRuntime()}`);

const defaultDecoder = createDefaultImageDecoder();
assert(typeof defaultDecoder.decode === 'function', 'createDefaultImageDecoder returned an ItdbImageDecoder');

const ipodRoot = await findIpodRoot();
assert(ipodRoot === undefined || typeof ipodRoot === 'string', `findIpodRoot => ${String(ipodRoot)}`);

// Zero-config assertions must not depend on the machine's state (a real
// iPod may or may not be mounted). Two branches:
//  - a real iPod found: auto-detection must read exactly what an explicit
//    root reads (read-only — never save/write in these tests);
//  - no iPod: fall back from a fresh empty directory and verify the
//    empty-db / missing-db behavior.
const savedCwd = process.cwd();
const zeroConfigDir = mkdtempSync(join(tmpdir(), 'itdb-zero-config-'));
process.chdir(zeroConfigDir);
try {
  const realFs = ipodRoot ? createNodeFs(ipodRoot) : undefined;

  if (realFs) {
    const auto = await Itdb.open();
    const explicit = await Itdb.open(realFs);
    assert(auto.tracks.length === explicit.tracks.length, `auto-inferred fs reads the real iPod like an explicit fs (${auto.tracks.length} tracks)`);
    // The mounted iPod may legitimately have an empty (freshly restored)
    // library; only fail on >0 when the explicit fs saw a library.
    if (explicit.tracks.length === 0) {
      console.warn('mounted iPod currently has a pristine/empty library, skipping the >0 check');
    } else {
      assert(auto.tracks.length > 0, `mounted iPod has ${auto.tracks.length} track(s)`);
    }
    const autoDev = await Itdb.open({ device: detectDevice('MB598') });
    assert(autoDev.artworkFormats.length === 4, `Auto fs + device picked ${autoDev.artworkFormats.length} artwork formats`);
    autoDev[Symbol.dispose]();

    const autoItunes = await ITunesDB.open();
    assert(autoItunes.tracks.length === explicit.db.tracks.length, 'ITunesDB.open() auto-inferred fs reads the real iTunesDB');
    auto[Symbol.dispose]();
  } else {
    const defaultFs = await createDefaultFs();
    assert(typeof defaultFs.readFile === 'function' && typeof defaultFs.writeFile === 'function', 'createDefaultFs returned an ItdbFileSystem');
    assert(typeof defaultFs.rename === 'function', `createDefaultFs includes rename (needed for atomic saves)`);

    {
      const auto = await Itdb.open();
      assert(auto.tracks.length === 0, `Itdb.open() auto-inferred fs, empty db: ${auto.tracks.length} tracks`);
      assert(auto.artwork === null, 'Itdb.open() auto-inferred fs, no ArtworkDB found');
      auto[Symbol.dispose]();
    }

    {
      const auto = await Itdb.open({ device: detectDevice('MB598') });
      assert(auto.tracks.length === 0, 'Itdb.open({ device }) with auto-inferred fs');
      assert(auto.artworkFormats.length === 4, `Auto fs + device picked ${auto.artworkFormats.length} artwork formats`);
      auto[Symbol.dispose]();
    }

    {
      const auto = await Itdb.create();
      assert(auto.tracks.length === 0 && auto.playlists.length === 1, 'Itdb.create() auto-inferred fs, fresh master playlist');
      auto[Symbol.dispose]();
    }

    assert(await rejects(ITunesDB.open()), 'ITunesDB.open() with no fs throws when no iTunesDB is found');
    assert(await rejects(ArtworkDB.open()), 'ArtworkDB.open() with no fs throws when no ArtworkDB is found');
  }
} finally {
  process.chdir(savedCwd);
  rmSync(zeroConfigDir, { recursive: true, force: true });
}


console.log('\n=== Browser bundle safety (no top-level node: imports) ===');
{
  const nodeFsSrc = readFileSync(resolve(root, 'src/common/fs/nodeFs.ts'), 'utf8');
  assert(!/^import .*['"]node:/.test(nodeFsSrc), 'nodeFs.ts has no static node: imports (safe to import from a browser bundle)');
  assert(nodeFsSrc.includes("import('node:fs/promises')") && nodeFsSrc.includes("import('node:path')"), 'nodeFs.ts loads node: builtins lazily via dynamic import');
  assert(nodeFsSrc.includes("import('node:fs')"), 'nodeFs.ts loads node:fs lazily via dynamic import');
}
{
  const savedProcess = (globalThis as Record<string, unknown>).process;
  const savedWindow = (globalThis as Record<string, unknown>).window;
  const savedBitmap = (globalThis as Record<string, unknown>).createImageBitmap;
  (globalThis as Record<string, unknown>).process = undefined;
  (globalThis as Record<string, unknown>).window = {};
  (globalThis as Record<string, unknown>).createImageBitmap = async () => {
    throw new Error('createImageBitmap stub (browser simulation)');
  };
  try {
    assert(detectRuntime() === 'browser', `detectRuntime()=>${detectRuntime()} when process is absent (browser)`);
    const browserDecoder = createDefaultImageDecoder();
    assert(typeof browserDecoder.decode === 'function', 'createDefaultImageDecoder picks the browser decoder when createImageBitmap exists');
  } finally {
    (globalThis as Record<string, unknown>).process = savedProcess;
    if (savedWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else (globalThis as Record<string, unknown>).window = savedWindow;
    if (savedBitmap === undefined) delete (globalThis as Record<string, unknown>).createImageBitmap;
    else (globalThis as Record<string, unknown>).createImageBitmap = savedBitmap;
  }
  assert(detectRuntime() === 'node', `detectRuntime() restored to node (got ${detectRuntime()})`);
}

console.log('\n=== Browser fs exists() on missing parent (SysInfo GUID lookup) ===');
{
  // A freshly-picked folder has no iPod_Control/Device/SysInfo. exists() must
  // return false for a missing file whose PARENT DIRECTORY also doesn't exist
  // (the throw-on-missing-parent was silently eating the SysInfo read, which
  // left the FireWire GUID unresolved and made nano-4G saves fail closed).
  const fakeRoot = {
    name: 'IPOD',
    async getDirectoryHandle() { throw new DOMException('not found', 'NotFoundError'); },
    async getFileHandle() { throw new DOMException('not found', 'NotFoundError'); },
  } as FileSystemDirectoryHandle;
  const fs = createBrowserFs(fakeRoot);
  assert(await fs.exists('iPod_Control/Device/SysInfo') === false, 'exists() returns false when the parent dir is missing');
  assert(await fs.exists('iPod_Control/iTunes/iTunesDB') === false, 'exists() returns false when the dir and file are missing');
}

console.log('\n=== Pixel encode/decode round-trip ===');
const testRgba = new Uint8Array(4 * 4 * 4);
for (let i = 0; i < 16; i++) {
  testRgba[i * 4] = (i * 17) & 0xFF;
  testRgba[i * 4 + 1] = (i * 37) & 0xFF;
  testRgba[i * 4 + 2] = (i * 53) & 0xFF;
  testRgba[i * 4 + 3] = 255;
}
const encoded565 = encodePixels(testRgba, 4, 4, 'RGB565_LE');
assert(encoded565.length === 32, `RGB565_LE encoded to ${encoded565.length} bytes (expected 32)`);
const decoded565 = decodePixels(encoded565, 4, 4, 'RGB565_LE');
assert(decoded565.length === 64, `RGB565_LE decoded to ${decoded565.length} bytes (expected 64)`);
let maxDiff = 0;
for (let i = 0; i < 16; i++) {
  maxDiff = Math.max(maxDiff, Math.abs(testRgba[i * 4] - decoded565[i * 4]));
  maxDiff = Math.max(maxDiff, Math.abs(testRgba[i * 4 + 1] - decoded565[i * 4 + 1]));
  maxDiff = Math.max(maxDiff, Math.abs(testRgba[i * 4 + 2] - decoded565[i * 4 + 2]));
}
assert(maxDiff <= 8, `RGB565 round-trip max color diff: ${maxDiff} (expected <= 8)`);

console.log('\n=== Image resize ===');
const srcImg = { width: 100, height: 100, pixels: new Uint8Array(100 * 100 * 4) };
srcImg.pixels.fill(128);
const resized = resizeImage(srcImg, 42, 42, true);
assert(resized.width === 42 && resized.height === 42, `Resized to ${resized.width}x${resized.height}`);

const rotated = rotateImage(srcImg, 90);
assert(rotated.width === 100 && rotated.height === 100, `Rotated 90deg: ${rotated.width}x${rotated.height}`);

console.log('\n=== Sync: addTrack / removeTrack ===');
const dbCopy = parseDatabase(itunesBuffer);
const origCount = dbCopy.tracks.length;
const newTrack = addTrack(dbCopy, {
  ipodPath: ':iPod_Control:Music:F00:test.mp3',
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
});
assert(dbCopy.tracks.length === origCount + 1, `After addTrack: ${dbCopy.tracks.length} tracks`);
assert(newTrack.title === 'Test Song', `New track title: ${newTrack.title}`);

const removed = removeTrack(dbCopy, newTrack.trackId);
assert(removed === true, `removeTrack returned true`);
assert(dbCopy.tracks.length === origCount, `After removeTrack: ${dbCopy.tracks.length} tracks`);

const removedAgain = removeTrack(dbCopy, 999999);
assert(removedAgain === false, `removeTrack non-existent returned false`);

console.log('\n=== Auto-generated track locations ===');
{
  const genDb = parseDatabase(itunesBuffer);
  const noPath = addTrack(genDb, { title: 'Auto' });
  assert(noPath.path?.startsWith(':iPod_Control:Music:F'), `Auto-generated location: "${noPath.path}"`);
  assert(noPath.path?.endsWith('.mp3'), `Auto-generated extension (.mp3 default): "${noPath.path}"`);
  assert(noPath.filetype === 0x4D503320, `Auto filetype matches .mp3: 0x${noPath.filetype.toString(16)}`);

  const mp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const withBytes = addTrack(genDb, { title: 'Sniffed', audioData: mp3Bytes });
  assert(withBytes.path?.endsWith('.mp3'), `Sniffed extension from ID3 bytes: "${withBytes.path}"`);
  assert(withBytes.size === mp3Bytes.length, `size set from audioData: ${withBytes.size}`);

  const m4aBytes = new Uint8Array([0, 0, 0, 20, ...Array.from('ftypM4A ').map(c => c.charCodeAt(0)), 0, 0, 0, 0, 2, 2]);
  const withM4a = addTrack(genDb, { title: 'M4A', audioData: m4aBytes });
  assert(withM4a.path?.endsWith('.m4a'), `Sniffed .m4a from ftyp bytes: "${withM4a.path}"`);
  assert(withM4a.filetype === 0x4D344120, `Auto filetype matches .m4a: 0x${withM4a.filetype.toString(16)}`);

  const named = addTrack(genDb, { title: 'Named', fileName: 'Closing Time.mp3' });
  assert(named.path?.endsWith('Closing Time.mp3'), `Explicit file name kept: "${named.path}"`);
  assert(named.path?.includes(':F'), `Explicit name still got a generated folder: "${named.path}"`);

  const duplicate = addTrack(genDb, { title: 'Dup', fileName: 'Closing Time.mp3' });
  assert(duplicate.path !== named.path && duplicate.path?.includes('Closing Time'), `Duplicate name got a unique location: "${duplicate.path}"`);

  assert(genDb.tracks.length === db.tracks.length + 5, `All auto-generated tracks added: ${genDb.tracks.length}`);
}

console.log('\n=== Every track carries a type-6 (filetype) MHOD ===');
{
  const genDb = parseDatabase(itunesBuffer);
  const added = addTrack(genDb, { title: 'Type6Test' });
  const rewriter = new ItdbBinaryWriter();
  writeTrack(rewriter, added);
  // walk the written mhits' mhods and confirm a type-6 with the string body exists
  const out = new Uint8Array(rewriter.finalize());
  let found6 = false;
  let p = 0;
  while (p < out.length) {
    const mgc = String.fromCharCode(out[p], out[p+1], out[p+2], out[p+3]);
    if (mgc !== 'mhit') break;
    const t = (out[p+8] | out[p+9] << 8 | out[p+10] << 16 | out[p+11] << 24);
    const h = (out[p+4] | out[p+5] << 8 | out[p+6] << 16 | out[p+7] << 24);
    let q = p + h;
    while (q < p + t && q + 4 <= out.length) {
      const m2 = String.fromCharCode(out[q], out[q+1], out[q+2], out[q+3]);
      if (m2 !== 'mhod') break;
      const ty = (out[q+12] | out[q+13] << 8 | out[q+14] << 16 | out[q+15] << 24);
      if (ty === 6) {
        found6 = true;
        // body after the 24-byte header: 16-byte sub-header (1, len, 1, 0), then utf16 string.
        // Bound by the mhod's own total (the mhit total `t` includes subsequent mhods).
        const mhodTotal = (out[q+8] | out[q+9] << 8 | out[q+10] << 16 | out[q+11] << 24);
        const body = out.subarray(q + 24, q + mhodTotal);
        const bytes = [];
        for (let i = 16; i + 1 < body.length; i += 2) {
          const c = body[i] | body[i+1] << 8;
          if (c === 0) break;
          bytes.push(String.fromCharCode(c));
        }
        assert(bytes.join('') === 'MP3', `Type-6 MHOD body is MP3: "${bytes.join('')}"`);
      }
      q += (out[q+8] | out[q+9] << 8 | out[q+10] << 16 | out[q+11] << 24) || 12;
    }
    p += t || 4;
  }
  assert(found6, 'Written track contains a type-6 MHOD');
}

console.log('\n=== Disposable instance classes ===');
{
  using itunesDb = ITunesDB.parse(itunesBuffer);
  assert(itunesDb.tracks.length === db.tracks.length, `ITunesDB.parse: ${itunesDb.tracks.length} tracks`);
  const added = await itunesDb.addTrack({ ipodPath: ':iPod_Control:Music:F00:song.mp3', title: 'Test' });
  assert(itunesDb.tracks.length === db.tracks.length + 1, 'ITunesDB.addTrack added a track');
  assert(itunesDb.removeTrack(added.trackId) === true, 'ITunesDB.removeTrack removed the track');
  const rewrittenBuf = itunesDb.write();
  assert(rewrittenBuf.byteLength > 0, `ITunesDB.write produced ${rewrittenBuf.byteLength} bytes`);
}
assert(itunesDbDisposed(), 'ITunesDB cleared its records on dispose');

{
  using artworkDb = ArtworkDB.parse(artworkBuffer);
  assert(artworkDb.images.length === artDb.images.length, `ArtworkDB.parse: ${artworkDb.images.length} images`);
  const rewrittenBuf = artworkDb.write();
  assert(rewrittenBuf.byteLength > 0, `ArtworkDB.write produced ${rewrittenBuf.byteLength} bytes`);
}

function itunesDbDisposed(): boolean {
  const check = ITunesDB.parse(itunesBuffer);
  check[Symbol.dispose]();
  return check.tracks.length === 0 && check.playlists.length === 0 && check.albums.length === 0;
}

console.log('\n=== Entity methods ===');
{
  using itunesDb = ITunesDB.parse(itunesBuffer);
  const first = itunesDb.getTracks()[0];
  const master = itunesDb.getPlaylists()[0];
  assert(master !== undefined, 'getPlaylists returned the master playlist');
  assert(itunesDb.getPlaylist(master.playlistId)?.name === master.name, 'getPlaylist found the master playlist by id');
  assert(itunesDb.getTrack(first.trackId)?.title === first.title, 'getTrack found the track by trackId');
  assert(itunesDb.updateTrack(first.trackId, { rating: 42, year: 2001 }) === true, 'updateTrack patched rating/year');
  const updated = itunesDb.getTrack(first.trackId)!;
  assert(updated.rating === 42 && updated.year === 2001, `updateTrack applied (rating=${updated.rating}, year=${updated.year})`);
  assert(itunesDb.updateTrack(999999, { rating: 1 }) === false, 'updateTrack with unknown id returned false');
  const pl = itunesDb.addPlaylist('My Favorites', [first.trackId]);
  assert(pl.name === 'My Favorites' && itunesDb.getPlaylist(pl.playlistId)?.items.length === 1, 'addPlaylist created a playlist with the track');
  assert(itunesDb.addTrackToPlaylist(pl.playlistId, first.trackId) === false, 'addTrackToPlaylist rejected a duplicate');
  const other = await itunesDb.addTrack({ ipodPath: ':iPod_Control:Music:F01:other.mp3', title: 'Other' });
  assert(itunesDb.addTrackToPlaylist(pl.playlistId, other.trackId) === true, 'addTrackToPlaylist appended a new track');
  assert(itunesDb.removeTrackFromPlaylist(pl.playlistId, other.trackId) === true, 'removeTrackFromPlaylist removed the track');
  assert(itunesDb.removeTrackFromPlaylist(pl.playlistId, other.trackId) === false, 'removeTrackFromPlaylist second removal returned false');
  assert(itunesDb.removePlaylist(pl.playlistId) === true, 'removePlaylist removed the new playlist');
  assert(itunesDb.removePlaylist(999999n) === false, 'removePlaylist with unknown id returned false');
}

console.log('\n=== Embedded artwork extraction ===');
{
  const pngPayload = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8]);
  const apic = new Uint8Array([0, ...asciiBytes('image/png'), 0, 3, ...asciiBytes('cover'), 0, ...pngPayload]);
  const frameSize = apic.length;
  const tagSize = 10 + frameSize;
  const id3 = new Uint8Array([
    0x49, 0x44, 0x33, 4, 0, 0x00,
    (tagSize >> 21) & 0x7f, (tagSize >> 14) & 0x7f, (tagSize >> 7) & 0x7f, tagSize & 0x7f,
    ...asciiBytes('APIC'),
    (frameSize >> 24) & 0xff, (frameSize >> 16) & 0xff, (frameSize >> 8) & 0xff, frameSize & 0xff,
    0, 0,
    ...apic,
  ]);
  const extracted = extractEmbeddedArtwork(id3);
  assert(extracted !== null, 'extractEmbeddedArtwork found an APIC frame in ID3v2.4');
  assert(extracted!.mimeType === 'image/png', `Detected MIME: ${extracted!.mimeType}`);
  assert(extracted!.data.length === pngPayload.length, `Extracted ${extracted!.data.length} image bytes`);
  const none = extractEmbeddedArtwork(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 9, 0, 0, 0, 1, 2]));
  assert(none === null, 'Audio without artwork returns null');
}

console.log('\n=== Open from root handle ===');
async function rejects(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch {
    return true;
  }
}
{
  const fakeFs = {
    readFile: async (path: string) => {
      if (path === 'iPod_Control/iTunes/iTunesDB') return itunesBuffer;
      if (path === 'iPod_Control/Artwork/ArtworkDB') return artworkBuffer;
      throw new Error(`ENOENT: ${path}`);
    },
    writeFile: async () => {},
    exists: async (path: string) => path === 'iPod_Control/iTunes/iTunesDB' || path === 'iPod_Control/Artwork/ArtworkDB',
    mkdir: async () => {},
  };
  const opened = await ITunesDB.open({ fs: fakeFs });
  assert(opened.tracks.length === db.tracks.length, `ITunesDB.open read the DB from the root`);
  assert(opened.root?.databasePath === 'iPod_Control/iTunes/iTunesDB', `Root resolved to ${opened.root?.databasePath}`);
  await opened.save();
  const artOpened = await ArtworkDB.open({ fs: fakeFs });
  assert(artOpened.images.length === artDb.images.length, `ArtworkDB.open read the ArtworkDB from the root`);
  await artOpened.save();
}
{
  const emptyFs = { readFile: async () => { throw new Error('ENOENT'); }, writeFile: async () => {}, exists: async () => false, mkdir: async () => {} };
  assert(await rejects(ITunesDB.open({ fs: emptyFs })), 'ITunesDB.open throws when iTunesDB is missing');
  assert(await rejects(ArtworkDB.open({ fs: emptyFs })), 'ArtworkDB.open throws when ArtworkDB is missing');
}
{
  assert(IpodPaths.ARTWORKDB === '/iPod_Control/Artwork/ArtworkDB', `canonical ArtworkDB path is ${IpodPaths.ARTWORKDB}`);
  assert(ARTWORKDB_FILE_RELATIVE_PATH === 'iPod_Control/Artwork/ArtworkDB', `ArtworkDB.open relative path is ${ARTWORKDB_FILE_RELATIVE_PATH}`);
  const legacyFs = createMemoryFs({
    'iPod_Control/iTunes/iTunesDB': new Uint8Array(itunesBuffer),
    'iPod_Control/iTunes/ArtworkDB': new Uint8Array(artworkBuffer),
  });
  const legacyDevice = detectDevice('MB598');
  legacyDevice.firewireGuid = '000A27000D496E2A';
  const legacy = await Itdb.open(legacyFs, { device: legacyDevice });
  assert(legacy.artwork !== null && legacy.artwork.images.length === artDb.images.length, 'Itdb.open fell back to the legacy iTunes/ArtworkDB when the canonical file is absent');
  const legacyTrack = legacy.tracks[0];
  await legacy.setArtwork(legacyTrack.trackId, { width: 8, height: 8, pixels: new Uint8Array(8 * 8 * 4).fill(96) });
  await legacy.save();
  assert([...legacyFs.files.keys()].some(k => k.endsWith('iPod_Control/Artwork/ArtworkDB')), `save wrote the canonical ArtworkDB (has ${[...legacyFs.files.keys()].filter(k => k.includes('ArtworkDB'))})`);
  assert(![...legacyFs.files.keys()].some(k => k.endsWith('iPod_Control/iTunes/ArtworkDB')), 'save cleaned up the stray legacy ArtworkDB after writing the canonical one');
}

console.log('\n=== Itdb: transactional unit-of-work save ===');
function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
  return true;
}
{
  const fs2 = createMemoryFs({
    'iPod_Control/iTunes/iTunesDB': new Uint8Array(itunesBuffer),
    'iPod_Control/Artwork/ArtworkDB': new Uint8Array(artworkBuffer),
  });
  // Seed the ithmb files referenced by the sample artwork so writeArtwork can read them on save.
  for (const img of artDb.images) {
    for (const t of img.thumbnails) {
      const p = `${IpodPaths.ARTWORK_DIR}/${t.filename}`;
      await fs2.writeFile(p, new Uint8Array(Math.max(1, t.itmbOffset + t.imageSize)));
    }
  }

  const device = detectDevice('MB598');
  device.firewireGuid = '000A27000D496E2A';
  const itdb = await Itdb.open(fs2, { device });
  assert(itdb.tracks.length === 1, `Itdb.open read ${itdb.tracks.length} track(s)`);
  assert(itdb.artwork !== null, 'Itdb.open read the ArtworkDB');
  assert(itdb.masterPlaylist.isMaster === true, 'Itdb.open marked the first playlist as master');
  assert(itdb.artworkFormats.length === device.artworkFormats.length, `Itdb artworkFormats from device: ${itdb.artworkFormats.length}`);

  const mp3Bytes = new Uint8Array(16);
  mp3Bytes.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 6], 0); // "ID3" v2.4 header → .mp3
  const itunesBefore = await fs2.readFile('iPod_Control/iTunes/iTunesDB');
  const t1 = await itdb.addTrack({ title: 'New Song', artist: 'Me', bitrate: 192, year: 2020 }, mp3Bytes);
  const audioPath = locationToPath(t1.path);
  assert(t1.path.startsWith(':iPod_Control:Music:F'), `Track stored at ${t1.path}`);
  assert(await fs2.exists(audioPath), 'Audio file written immediately on addTrack');
  assert(sameBytes(await fs2.readFile('iPod_Control/iTunes/iTunesDB'), itunesBefore), 'iTunesDB unchanged on disk before save (pending unit of work)');
  assert(itdb.tracks.length === 2, 'In-memory track count updated before save');

  const rgba = { width: 8, height: 8, pixels: new Uint8Array(8 * 8 * 4).fill(128) };
  const image = await itdb.setArtwork(t1.trackId, rgba);
  assert(image.thumbnails.length === itdb.artworkFormats.length, `setArtwork created ${image.thumbnails.length} thumbnails`);
  assert(itdb.artwork!.images.length === 2, 'ArtworkDB gained an image in memory');
  assert(t1.artworkCount === 1 && t1.artworkSize > 0 && t1.mhiiLink === image.imageId, `Track artwork linkage set like iTunes (artCount 1, mhiiLink=${t1.mhiiLink} = imageId ${image.imageId})`);
  assert(/^:F\d+_1\.ithmb$/.test(image.thumbnails[0]!.filename), `Thumbnail filename is iTunes-style (:F{format}_1.ithmb, got "${image.thumbnails[0]!.filename}")`);

  await itdb.save();
  assert(![...fs2.files.keys()].some(k => k.endsWith('.tmp')), 'No .tmp files left after save (atomic commit)');
  assert(await fs2.exists(`iPod_Control/Artwork/F${image.thumbnails[0]!.formatId}_1.ithmb`), 'ithmb file written to the artwork dir');

  const itdb2 = await Itdb.open(fs2, { device });
  assert(itdb2.tracks.length === 2, `Reopened DB has ${itdb2.tracks.length} tracks`);
  const rt = itdb2.getTrack(t1.trackId);
  assert(rt !== undefined && rt.title === 'New Song' && rt.artist === 'Me' && rt.bitrate === 192 && rt.year === 2020, 'Reopened track preserved meta (title/artist/bitrate/year)');
  assert(rt!.size === mp3Bytes.length, `Track size set from audio data: ${rt!.size}`);
  const art2 = await itdb2.getArtwork(t1.trackId);
  assert(art2 !== null && art2.width > 0 && art2.height > 0, `getArtwork decoded ${art2?.width}x${art2?.height}`);
  const firstThumb = image.thumbnails[0]!;
  assert(await fs2.exists(`iPod_Control/Artwork/F${firstThumb.formatId}_1.ithmb`), 'Thumbnail ithmb file exists after reopen');

  itdb2.removeTrack(t1.trackId);
  await itdb2.save();
  assert(itdb2.tracks.length === 1, 'Track removed in memory');
  assert(!(await fs2.exists(audioPath)), 'Removed track audio file deleted on save');
  assert((await itdb2.getArtwork(t1.trackId)) === null, 'Removed track artwork gone');

  let threw = false;
  try {
    itdb2.removeTrack(999999);
  } catch (e) {
    threw = e instanceof ItdbError && e.message.includes('unknown track id');
  }
  assert(threw, 'removeTrack with unknown id throws ItdbError');
  threw = false;
  try {
    itdb2.removePlaylist(itdb2.masterPlaylist.playlistId);
  } catch (e) {
    threw = e instanceof ItdbError && (e.message.includes('cannot remove the master'));
  }
  assert(threw, 'removePlaylist on the master playlist throws ItdbError');

  assert(pathToLocation(locationToPath(':iPod_Control:Music:F00:X.mp3')) === ':iPod_Control:Music:F00:X.mp3', 'locationToPath/pathToLocation round-trip');

  itdb2[Symbol.dispose]();
  assert(itdb2.tracks.length === 0 && itdb2.playlists.length === 0, 'Itdb[Symbol.dispose] cleared the in-memory records');
}
{
  const atomicFs = createMemoryFs();
  await atomicWrite(atomicFs, 'a/b.txt', new Uint8Array([1, 2, 3]));
  assert(await atomicFs.exists('a/b.txt') && !(await atomicFs.exists('a/b.txt.tmp')), 'atomicWrite commits via tmp+rename');
}
{
  const tmpDir = await createNodeFsTmp();
  const nodeFs = createNodeFs(tmpDir);
  await nodeFs.writeFile('iPod_Control/iTunes/iTunesDB', itunesBuffer);
  assert(await nodeFs.exists('iPod_Control/iTunes/iTunesDB'), 'createNodeFs.writeFile created the DB file');
  const back = await nodeFs.readFile('iPod_Control/iTunes/iTunesDB');
  assert(back.byteLength === itunesBuffer.byteLength, 'createNodeFs.readFile round-trips the bytes');
  await nodeFs.rename('iPod_Control/iTunes/iTunesDB', 'iPod_Control/iTunes/iTunesDB.1');
  assert(!(await nodeFs.exists('iPod_Control/iTunes/iTunesDB')) && (await nodeFs.exists('iPod_Control/iTunes/iTunesDB.1')), 'createNodeFs.rename moved the file');
  await nodeFs.remove('iPod_Control/iTunes/iTunesDB.1');
  assert(!(await nodeFs.exists('iPod_Control/iTunes/iTunesDB.1')), 'createNodeFs.remove deleted the file');
  await import('node:fs/promises').then(fsPromise => fsPromise.rm(tmpDir, { recursive: true, force: true }));
}

async function createNodeFsTmp(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  return mkdtemp(join(tmpdir(), 'itdb-ts-'));
}

function asciiBytes(s: string): number[] {
  return Array.from(s, c => c.charCodeAt(0) & 0xff);
}

console.log('\n=== iTunesDB checksum (hash58) ===');
{
  // SHA-1 known-answer (RFC 3174): sha1("abc")
  const sha1abc = sha1(new TextEncoder().encode('abc'));
  assert(toHex(sha1abc) === 'a9993e364706816aba3e25717850c26c9cd0d89d', `sha1("abc") = ${toHex(sha1abc)}`);
  // HMAC-SHA1 known-answer (RFC 2204 test case 2).
  const jefeKey = fromHex('4a656665');
  const hmacOut = hmacSha1(jefeKey, new TextEncoder().encode('what do ya want for nothing?'));
  assert(toHex(hmacOut) === 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79', `RFC2204 HMAC-SHA1 = ${toHex(hmacOut)}`);
  // The S-box tables must be mutual inverses (catches transcription errors).
  for (let i = 0; i < 256; i++) {
    assert(HASH58_TABLE1[HASH58_TABLE2[i]] === i && HASH58_TABLE2[HASH58_TABLE1[i]] === i, `S-box inverse identity at ${i}`);
  }
  // applyHash58: patch a crafted mhbd buffer.
  const crafted = new Uint8Array(0x80);
  crafted.set([0x6d, 0x68, 0x62, 0x64]); // "mhbd"
  const dv = new DataView(crafted.buffer);
  dv.setUint32(4, 0xf4, true);
  dv.setUint32(8, 0x80, true);
  dv.setUint16(0x30, 0, true); // scheme = 0 initially
  const dbId = [1, 2, 3, 4, 5, 6, 7, 8];
  crafted.set(dbId, 0x18);
  const unk32 = Array.from({ length: 20 }, (_, i) => (i * 7) & 0xff);
  crafted.set(unk32, 0x32);
  const guid = '000A27000D496E2A';
  const patched = applyHash58(crafted, guid);
  assert(patched.length === crafted.length, 'applyHash58 keeps the buffer length');
  assert(String.fromCharCode(patched[0], patched[1], patched[2], patched[3]) === 'mhbd', 'mhbd magic preserved');
  assert(new DataView(patched.buffer).getUint16(0x30, true) === 1, 'hashing_scheme set to 1');
  assert(Array.from(patched.slice(0x58, 0x6c)).some(b => b !== 0), 'hash58 field is filled');
  assert(Array.from(patched.slice(0x18, 0x20)).join(',') === dbId.join(','), 'db_id restored after hashing');
  assert(Array.from(patched.slice(0x32, 0x46)).join(',') === unk32.join(','), 'unk_0x32 restored after hashing');
  const again = applyHash58(crafted, guid);
  assert(toHex(patched) === toHex(again), 'applyHash58 is deterministic');
  const different = applyHash58(crafted, '000A27000D123456');
  assert(toHex(patched) !== toHex(different), 'different GUID yields different checksum');
  // Generation gate.
  assert(checksumTypeForGeneration('NANO_4') === 'hash58' && checksumTypeForGeneration('CLASSIC_2') === 'hash58', 'nano 3/4G + classic need hash58');
  assert(checksumTypeForGeneration('NANO_2') === 'none' && checksumTypeForGeneration('SHUFFLE_3') === 'none' && checksumTypeForGeneration('VIDEO_1') === 'none', 'legacy devices need no checksum');
  assert(checksumTypeForGeneration('NANO_5') === 'hash72' && checksumTypeForGeneration('TOUCH_2') === 'hash72', 'nano 5G + touch 1-3 need hash72');
  assert(checksumTypeForGeneration('NANO_6') === 'hashAB' && checksumTypeForGeneration('TOUCH_4') === 'hashAB', 'nano 6G + touch 4 need hashAB');
  assert(checksumTypeForDevice(undefined) === 'none', 'unknown device -> no checksum');
  // End-to-end via MemoryFs: nano 4G save writes a DB whose header carries the checksum.
  const nano4g = detectDevice('MB598');
  nano4g.firewireGuid = '000A27000D496E2A';
  const hashFs = createMemoryFs({
    '/iPod_Control/iTunes/iTunesDB': new Uint8Array(itunesBuffer),
    '/iPod_Control/Device/SysInfo': new TextEncoder().encode('ModelNumStr: MB598\nFireWireGUID: 000A27000D496E2A\nSerialNumber: ABC123\n'),
  } as Record<string, Uint8Array>);
  using hashItdb = await Itdb.open(hashFs, { device: nano4g });
  await hashItdb.save();
  const written = hashFs.files.get('/iPod_Control/iTunes/iTunesDB')!;
  assert(new DataView(written.buffer).getUint16(0x30, true) === 1, 'saved nano 4G DB has hashing_scheme = 1');
  assert(Array.from(written.slice(0x58, 0x6c)).some(b => b !== 0), 'saved nano 4G DB carries the hash58 digest');
  const reparsed = parseDatabase(written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer);
  assert(reparsed.tracks.length === db.tracks.length, 'hashed DB still parses cleanly');
  // Fail closed: nano 4G without a FireWire GUID must abort BEFORE any write.
  const noGuid = detectDevice('MB598');
  const emptyFs = createMemoryFs({
    '/iPod_Control/iTunes/iTunesDB': new Uint8Array(itunesBuffer),
  } as Record<string, Uint8Array>);
  using noGuidItdb = await Itdb.open(emptyFs, { device: noGuid });
  let threw = false;
  try {
    await noGuidItdb.save();
  } catch (err) {
    threw = err instanceof ItdbError && /hash58/.test(err.message);
  }
  assert(threw, 'nano 4G save without FireWire GUID throws ItdbError');
  assert(!emptyFs.files.has('/iPod_Control/iTunes/iTunesDB.tmp') && !emptyFs.files.has('/iPod_Control/iTunes/iTunesDB.bak'), 'no .tmp or .bak staged when the checksum cannot be computed');
  assert(sameBytes(emptyFs.files.get('/iPod_Control/iTunes/iTunesDB')!.buffer, itunesBuffer), 'seeded iTunesDB is untouched when the save aborts');
  // Known-answer test against a REAL iTunes-computed DB: the on-disk iTunesDB
  // read from an actual iPod nano 4G carries iTunes' own hash58 digest at 0x58.
  // Recomputed with the device's FireWire GUID (= USB serial "000A27001DD6F0A8")
  // it must reproduce iTunes' digest exactly — the strongest proof our port is right.
  {
    const realDb = new Uint8Array(readFileSync(resolve(root, 'src/__tests__/fixtures/iTunesDB-nano4g-hash58.bin')));
    const itunesDigest = toHex(realDb.slice(0x58, 0x6c));
    assert(itunesDigest === '151faf82cc4afca770faf952d7673244dab6b4c2', `fixture carries iTunes' hash58 (got ${itunesDigest})`);
    const recomputed = applyHash58(realDb, '000A27001DD6F0A8');
    assert(toHex(recomputed.slice(0x58, 0x6c)) === itunesDigest, 'our hash58 reproduces iTunes digest byte-for-byte on a real device DB');
    assert(new DataView(recomputed.buffer).getUint16(0x30, true) === 1, 'real-device hash has scheme = 1');
  }
  // hash72 signing (nano 3G/4G / classic DBs — the check Apple Music and
  // Finder perform). Sign a crafted DB with a test (IV, random), then
  // recover the pair via extraction: must round-trip exactly.
  {
    const iv = fromHex('c63ea43d0b1e89c3abb7a865a9bd4d86');
    const rnd = fromHex('f5f17ff85d7545e79397668e');
    const crafted = new Uint8Array(0xa8);
    crafted.set([0x6d, 0x68, 0x62, 0x64]); // "mhbd"
    const dv2 = new DataView(crafted.buffer);
    dv2.setUint32(4, 0xf4, true);
    dv2.setUint32(8, crafted.length, true);
    dv2.setUint16(0x30, 0, true);
    crafted.set([1, 2, 3, 4, 5, 6, 7, 8], 0x18);
    const signed = await applyHash72(crafted, iv, rnd);
    assert(new DataView(signed.buffer).getUint16(0x70, true) === HASH72_SCHEME, 'hash72 sets hashing_scheme@0x70 = 3');
    assert(signed[0x72] === 0x01 && signed[0x73] === 0x00, 'hash72 signature starts with 01 00');
    const recovered = await extractHash72IvRandom(signed);
    assert(recovered !== null, 'extractHash72IvRandom accepts a properly signed DB');
    assert(toHex(recovered!.iv) === 'c63ea43d0b1e89c3abb7a865a9bd4d86', 'IV round-trips through signing + extraction');
    assert(toHex(recovered!.random) === 'f5f17ff85d7545e79397668e', 'random round-trips through signing + extraction');
    // An unsigned/garbage signature must be rejected (that is the corrupt case).
    const garbage = new Uint8Array(signed);
    garbage[0x74] ^= 0xff;
    assert(await extractHash72IvRandom(garbage) === null, 'corrupted signatures are rejected');
    // HashInfo file format (libgpod Hash78Info): "HASHv0" + 20-byte UUID + rnd + iv.
    const hi = buildHashInfo('000A27001DD6F0A8', iv, rnd);
    assert(String.fromCharCode(hi[0], hi[1], hi[2], hi[3], hi[4], hi[5]) === 'HASHv0', 'HashInfo starts with HASHv0');
    assert(hi.length === 54, 'HashInfo is 54 bytes');
    assert(hi[7] === 0x0a && hi[8] === 0x27, 'HashInfo UUID is the hex-packed FireWire GUID');
    assert(toHex(hi.slice(26, 38)) === 'f5f17ff85d7545e79397668e' && toHex(hi.slice(38, 54)) === 'c63ea43d0b1e89c3abb7a865a9bd4d86', 'HashInfo carries rnd then iv');
  }
  // Device-level: nano 5G save with a valid HashInfo on the device writes a
  // DB whose hash72 signature validates (extraction succeeds).
  const nano5 = detectDevice('MC027');
  nano5.firewireGuid = '000A27000D496E2A';
  const fiveFs = createMemoryFs({
    '/iPod_Control/iTunes/iTunesDB': new Uint8Array(itunesBuffer),
    '/iPod_Control/iTunes/HashInfo': new Uint8Array(buildHashInfo('000A27000D496E2A', fromHex('c63ea43d0b1e89c3abb7a865a9bd4d86'), fromHex('f5f17ff85d7545e79397668e'))),
  } as Record<string, Uint8Array>);
  using fiveItdb = await Itdb.open(fiveFs, { device: nano5 });
  await fiveItdb.save();
  const fiveWritten = fiveFs.files.get('/iPod_Control/iTunes/iTunesDB')!;
  const fiveExtract = await extractHash72IvRandom(fiveWritten);
  assert(fiveExtract !== null, 'nano 5G save produces a DB with a valid hash72 signature');
  assert(new DataView(fiveWritten.buffer).getUint16(0x70, true) === HASH72_SCHEME, 'saved DB scheme = 3');
  // …and a HASH72-family device (nano 5G) with no HashInfo and no valid
  // signed DB to derive from fails closed — the firmware would reject a DB
  // without the checksum, matching the original nano-4G corruption.
  const fiveFsNoKey = createMemoryFs({
    '/iPod_Control/iTunes/iTunesDB': new Uint8Array(itunesBuffer),
  } as Record<string, Uint8Array>);
  using fiveItdbNoKey = await Itdb.open(fiveFsNoKey, { device: nano5 });
  let threw5 = false;
  try {
    await fiveItdbNoKey.save();
  } catch (err) {
    threw5 = err instanceof ItdbError && /HASH72 signing key/.test(err.message);
  }
  assert(threw5, 'HASH72-family save without a signing key throws ItdbError');
  assert(!fiveFsNoKey.files.has('/iPod_Control/iTunes/iTunesDB.bak'), 'no .bak staged when hash72 cannot be signed');
}

{
  console.log('\n=== writeSysInfo (one-time setup, mirrors tunesreloaded) ===');
  const { readSysInfo, writeSysInfo } = await import('../device/sysInfo.js');
  // Fresh folder with no Device/SysInfo: writeSysInfo creates the file with
  // FirewireGuid (0x-normalized) and ModelNumStr.
  const freshFs = createMemoryFs({} as Record<string, Uint8Array>);
  const fresh = await writeSysInfo(freshFs, '0x000A27001DD6F0A8', 'MB754');
  assert(fresh.includes('FirewireGuid: 0x000A27001DD6F0A8'), 'writeSysInfo writes FirewireGuid with 0x prefix, stripped for storage');
  assert(fresh.includes('ModelNumStr: MB754'), 'writeSysInfo writes ModelNumStr');
  assert(!fresh.includes('0x0x'), 'GUID value gets a single 0x prefix even when input already has one');
  const back = await readSysInfo(freshFs);
  assert(back?.firewireGuid === '0x000A27001DD6F0A8' && back.modelNumber === 'MB754', 'readSysInfo round-trips the freshly written SysInfo');
  // Preserve unrelated lines (e.g. SerialNumber), replace only the setup keys.
  const seededFs = createMemoryFs({
    '/iPod_Control/Device/SysInfo': new TextEncoder().encode('SerialNumber: ABC123\nFirewireGuid: 0xOLDDEAD\nModelNumStr: MB598\n'),
  } as Record<string, Uint8Array>);
  await writeSysInfo(seededFs, '000A27001DD6F0A8', 'MB754');
  const seededText = new TextDecoder().decode(seededFs.files.get('/iPod_Control/Device/SysInfo')!);
  assert(seededText.includes('SerialNumber: ABC123'), 'unrelated SysInfo lines are preserved');
  assert(seededText.includes('FirewireGuid: 0x000A27001DD6F0A8') && !seededText.includes('OLDDEAD'), 'old FirewireGuid is replaced');
  assert(seededText.includes('ModelNumStr: MB754') && !seededText.includes('MB598'), 'old ModelNumStr is replaced');
  // No model number supplied -> existing ModelNumStr untouched, GUID still written.
  const noModelFs = createMemoryFs({
    '/iPod_Control/Device/SysInfo': new TextEncoder().encode('ModelNumStr: MB598\n'),
  } as Record<string, Uint8Array>);
  await writeSysInfo(noModelFs, 'ABC123');
  const noModelText = new TextDecoder().decode(noModelFs.files.get('/iPod_Control/Device/SysInfo')!);
  assert(noModelText.includes('ModelNumStr: MB598'), 'omitting modelNumStr leaves the existing one alone');
  assert(noModelText.includes('FirewireGuid: 0xABC123'), 'GUID still written without a model');
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  console.log(`\n--- ${name} ---`);
  try {
    await fn();
  } catch (e) {
    failed++;
    console.error(`  EXCEPTION: ${String(e)}`);
    console.error((e as Error)?.stack);
  }
}

test('playlist mhip trackId round-trips at +0x18 with a regenerated type-100 position mhod', () => {
  const db = new ITunesDB({
    tracks: [],
    playlists: [
      {
        playlistId: 1n,
        hidden: 0,
        timestamp: 0,
        sortOrder: 0,
        name: 'Master',
        mhsdIndex: 2,
        items: [
          { trackId: 7, timestamp: 11, rawHeader: new Uint8Array(0) },
          { trackId: 3, timestamp: 0, rawHeader: new Uint8Array(0) },
        ],
        dataObjects: [],
        rawHeader: new Uint8Array(0),
      },
    ],
    albums: [],
    sections: [],
    rawHeader: new Uint8Array(0),
  } as ITunesDB);
  const bytes = writeDatabase(db);
  const parsed = parseDatabase(bytes);
  const master = parsed.playlists.find((p) => (p.mhsdIndex ?? 2) === 2)!;
  assert(master.items.length === 2, 'master items written and parsed');
  assert(master.items.map((i) => i.trackId).join(',') === '7,3', 'mhip trackId survives a write/parse round trip');
  assert(master.items[0].objects?.[0]?.type === 100, 'writePlaylistItem regenerates the type-100 position mhod for fresh items');
  // A second round trip through the writer (now carrying the child mhods) must keep the ids stable.
  const bytes2 = writeDatabase(parsed);
  const parsed2 = parseDatabase(bytes2);
  const master2 = parsed2.playlists[0];
  assert(master2.items.map((i) => i.trackId).join(',') === '7,3', 'mhip trackId stable across a second round trip');
});

test('sections 3 and 5 parse as playlists and empty ones are dropped on write', () => {
  const db = new ITunesDB({
    tracks: [],
    playlists: [
      {
        playlistId: 10n, hidden: 0, timestamp: 0, sortOrder: 0, name: 'Master',
        mhsdIndex: 2, items: [], dataObjects: [], rawHeader: new Uint8Array(0),
      },
      {
        playlistId: 40n, hidden: 0, timestamp: 0, sortOrder: 0, name: 'Specials',
        mhsdIndex: 5, items: [], dataObjects: [], rawHeader: new Uint8Array(0),
      },
    ],
    albums: [],
    sections: [
      { index: 4, kind: 'albums' },
      { index: 1, kind: 'tracks' },
      { index: 3, kind: 'playlists' },
      { index: 2, kind: 'playlists' },
      { index: 5, kind: 'playlists' },
    ],
    rawHeader: new Uint8Array(0),
  } as ITunesDB);
  const bytes = writeDatabase(db);
  const parsed = parseDatabase(bytes);
  const s5 = parsed.playlists.find((p) => p.mhsdIndex === 5);
  assert(s5 !== undefined, 'section-5 playlists are parsed into the model');
  assert(parsed.sections.some((s) => s.kind === 'playlists' && s.index === 5), 'section 5 emitted while it has playlists');
  parsed.playlists = parsed.playlists.filter((p) => p.mhsdIndex !== 5);
  const bytes2 = writeDatabase(parsed);
  const parsed2 = parseDatabase(bytes2);
  assert(!parsed2.sections.some((s) => s.kind === 'playlists' && s.index === 5), 'empty section 5 is dropped (no stale stubs)');
  assert(parsed2.playlists.length === 1, 'only the section-2 master remains');
});

test('thmb (0x12) MHODs round-trip as raw thumbnail bodies, not strings', () => {
  const db = new ITunesDB({
    tracks: [
      {
        trackId: 1,
        dbid: 12345n,
        title: 'T',
        artist: 'A',
        dataObjects: [
          { type: 1, stringValue: 'T' },
          { type: 18, rawBody: new Uint8Array([0x00, 0x50, 0x00, 0x50, 0x02, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 1, 2, 3, 4]) },
        ],
        rawHeader: new Uint8Array(0),
      },
    ],
    playlists: [],
    albums: [],
    sections: [],
    rawHeader: new Uint8Array(0),
  } as ITunesDB);
  const bytes = writeDatabase(db);
  const parsed = parseDatabase(bytes);
  const thmb = parsed.tracks[0].dataObjects.find((o) => o.type === 18);
  assert(thmb !== undefined, 'thmb MHOD (type 18) survives a write/parse round trip');
  assert(thmb.rawBody !== undefined && thmb.rawBody.length === 16, 'thmb body is preserved as bytes, not decoded as a string');
  assert(thmb.rawBody![15] === 4 && thmb.rawBody![0] === 0x00, 'thmb payload bytes match the input');
  assert(parsed.tracks[0].dataObjects.find((o) => o.type === 18)?.stringValue === undefined, 'thmb is never treated as a subtitle string');
});

test("artworkSize uses the encoded source size (Apple-style) not the decoded RGBA size", async () => {
  const fs = createMemoryFs({} as Record<string, Uint8Array>);
  const device = detectDevice('MB598');
  device.firewireGuid = '000A27001DD6F0A8';
  const itdb = await Itdb.create(fs, { device });
  const mp3Bytes = new Uint8Array(16);
  mp3Bytes.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 6], 0);
  const t = await itdb.addTrack({ title: 'T', artist: 'A' }, mp3Bytes);
  const rgba = { width: 8, height: 8, pixels: new Uint8Array(8 * 8 * 4).fill(64) };

  await itdb.setArtwork(t.trackId, rgba);
  assert(t.artworkSize === 8 * 8 * 4, `RGBA input defaults artworkSize to decoded bytes (got ${t.artworkSize})`);

  await itdb.setArtwork(t.trackId, rgba, 10124);
  assert(t.artworkSize === 10124, `explicit encoded size overrides (got ${t.artworkSize})`);

  await itdb.save();
  const chk = await Itdb.open(fs, { device });
  const rt = chk.getTrack(t.trackId)!;
  assert(rt.artworkCount >= 1, 'track has artworkCount set after save');
  assert(rt.hasArtwork === 1, `hasArtwork byte written as 1 (Apple-style) when track has art (got ${rt.hasArtwork})`);
  assert(rt.mhiiLink === t.mhiiLink, 'mhiiLink preserved across round-trip');
  const raw = Buffer.from((fs as unknown as { files: Map<string, Uint8Array> }).files.get('/iPod_Control/iTunes/iTunesDB')!);
  const mhit = raw.indexOf(Buffer.from('mhit', 'ascii'));
  assert(mhit >= 0, 'found mhit record');
  assert(raw[mhit + 0x7e] === 0xff && raw[mhit + 0x7f] === 0xff, `0x7E byte-order marker written as 0xFFFF (got ${raw[mhit + 0x7e].toString(16)})`);
  assert(raw[mhit + 0x168] === 1, `0x168 written as 1 (Apple/libgpod) (got ${raw[mhit + 0x168]})`);
});

test('Itdb replace-library flow rebuilds the master playlist and albums for the current tracks', async () => {
  const fs = createMemoryFs({} as Record<string, Uint8Array>);
  const seed = new ITunesDB({
    tracks: [],
    playlists: [
      {
        playlistId: 10n, hidden: 0, timestamp: 0, sortOrder: 0, name: 'Old Master',
        mhsdIndex: 2, items: [{ trackId: 99, timestamp: 0, rawHeader: new Uint8Array(0) }],
        dataObjects: [], rawHeader: new Uint8Array(0),
      },
    ],
    albums: [],
    sections: [],
    rawHeader: new Uint8Array(0),
  } as ITunesDB);
  const seedBytes = writeDatabase(seed);
  await fs.writeFile('/iPod_Control/iTunes/iTunesDB', seedBytes as ArrayBuffer);
  const itdb = await Itdb.open(fs);
  itdb.clear();
  const track = await itdb.addTrack(
    { title: 'Neon Moon', artist: 'Brooks & Dunn', album: 'Brand New Man', length: 93, bitrate: 160, year: 1991 },
    new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  );
  await itdb.save();
  const written = new Uint8Array(await fs.readFile('/iPod_Control/iTunes/iTunesDB'));
  const parsed = parseDatabase(written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength));
  const master = parsed.playlists.find((p) => p.items.some((i) => i.trackId === track.trackId));
  assert(master !== undefined, 'master playlist references the new track id');
  assert(master.items.length === 1 && master.items[0].trackId === track.trackId, 'master playlist references the new track id exactly once');
  assert(master.items[0].objects?.[0]?.type === 100, 'master mhip carries the type-100 position mhod');
  assert(parsed.albums.length === 1, 'one album rebuilt for the current track');
  assert(parsed.albums[0]!.dbid !== track.dbid, 'album dbid is distinct from the track dbid (no id collision)');
  assert(parsed.albums[0]?.dataObjects.some((o) => o.type === 200 && o.stringValue === 'Brand New Man'), 'album name written as a type-200 mhod');
  const latin2 = Buffer.from(written).toString('latin1');
  const mhlps = (latin2.match(/mhlp/g) || []).length;
  assert(mhlps === 1, 'single mhlp playlist section after a replace-library sync');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);


if (failed > 0) process.exit(1);
