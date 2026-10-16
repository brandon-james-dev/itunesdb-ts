# itunesdb-ts

A JavaScript/TypeScript library for reading and writing iPod database files (`iTunesDB` and `ArtworkDB`). Works in **browser**, **Node.js**, and **Tauri** runtimes.

Inspired by [libgpod](https://github.com/AdrienClerworksgeot/libgpod), rewritten from scratch in TypeScript with a focus on cross-runtime compatibility and round-trip fidelity.

## Features

- **Parse and write iTunesDB** — songs, playlists, albums with full round-trip support
- **Parse and write ArtworkDB** — album art thumbnails in device-specific pixel formats
- **Device detection** — identify iPod model, friendly name, color, and supported artwork formats from SysInfo
- **Artwork processing** — resize, rotate, and encode images to iPod pixel formats (RGB565, RGB555, UYVY, etc.)
- **Image decoding** — pluggable decoders for JPEG, PNG, WebP (browser and Node implementations included)
- **Cross-runtime** — pure ArrayBuffer/DataView I/O, no Node-specific APIs in the core

## Install

```bash
npm install itunesdb-ts
```

For Node.js image decoding (JPEG/PNG/WebP → RGBA), also install:

```bash
npm install sharp
```

## Quick Start

### Reading an iTunesDB

```ts
import { parseDatabase } from "itunesdb-ts";
import { readFileSync } from "node:fs";

const buffer = readFileSync("/mnt/ipod/iPod_Control/iTunes/iTunesDB");
const arrayBuffer = buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength
);

const db = parseDatabase(arrayBuffer);

for (const track of db.tracks) {
  console.log(`${track.title} — ${track.artist} (${track.album})`);
  console.log(`  Path: ${track.path}`);
  console.log(`  Genre: ${track.genre}, Year: ${track.year}`);
}

for (const playlist of db.playlists) {
  console.log(`Playlist: ${playlist.name} (${playlist.items.length} tracks)`);
}
```

### Writing an iTunesDB

```ts
import { parseDatabase, writeDatabase } from "itunesdb-ts";
import { readFileSync, writeFileSync } from "node:fs";

const buffer = readFileSync("/mnt/ipod/iPod_Control/iTunes/iTunesDB");
const db = parseDatabase(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
);

// Modify tracks, playlists, etc.
db.tracks[0].title = "New Title";

const output = writeDatabase(db);
writeFileSync("/mnt/ipod/iPod_Control/iTunes/iTunesDB", Buffer.from(output));
```

### Adding a Track

```ts
import { parseDatabase, writeDatabase, addTrack } from "itunesdb-ts";

const db = parseDatabase(existingBuffer);

const track = addTrack(db, {
  title: "My Song",
  artist: "My Artist",
  album: "My Album",
  genre: "Rock",
  trackNumber: 1,
  year: 2024,
  fileName: "My Song.mp3", // optional: the location/file name is generated automatically otherwise
});
// track.path — e.g. ":iPod_Control:Music:F03:My Song.mp3" — was filled in automatically

// Copy the audio file to the iPod, then write the database
const output = writeDatabase(db);
```

### Removing a Track

```ts
import { parseDatabase, writeDatabase, removeTrack } from "itunesdb-ts";

const db = parseDatabase(existingBuffer);
removeTrack(db, trackId); // removes from tracks list and all playlists
const output = writeDatabase(db);
```

### Reading the ArtworkDB

```ts
import { parseArtworkDatabase } from "itunesdb-ts";

const artDb = parseArtworkDatabase(artworkBuffer);

for (const image of artDb.images) {
  console.log(`Image for songId=${image.songId}`);
  for (const thumb of image.thumbnails) {
    console.log(
      `  ${thumb.imageWidth}x${thumb.imageHeight} @ ${thumb.filename}`
    );
  }
}
```

### Device Detection

```ts
import { detectDevice } from "itunesdb-ts";
import { readFileSync } from "node:fs";

// From a SysInfo file on the device
const sysInfo = readFileSync("/mnt/ipod/iPod_Control/Device/SysInfo", "utf-8");
const device = detectDevice(sysInfo);

// ...or from a model number string
const device2 = detectDevice("MB598");

// ...or from a USB product ID (WebUSB device.productId, lsusb, etc.)
const device3 = detectDevice(0x1263); // iPod nano (4th generation)

console.log(device.name); // "iPod nano (4th generation)"
console.log(device.shortName); // "Nano 4G"
console.log(device.color); // "Silver"
console.log(device.capacityGB); // 8
console.log(device.artworkFormats); // supported thumbnail sizes
// Throws an Error for model numbers / USB product IDs that are not recognised.
```

### Preparing Artwork

```ts
import {
  detectDevice,
  prepareThumbnails,
  addArtworkEntry,
  createNodeImageDecoder,
  parseArtworkDatabase,
  writeArtworkDatabase,
} from "itunesdb-ts";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

// 1. Detect device and get artwork formats
const device = detectDevice(
  readFileSync("/mnt/ipod/iPod_Control/Device/SysInfo", "utf-8")
);
const formats = device!.artworkFormats;

// 2. Decode the artwork image (JPEG/PNG/WebP → RGBA)
const decoder = createNodeImageDecoder();
const coverBytes = readFileSync("cover.jpg");
const coverImage = await decoder.decode(new Uint8Array(coverBytes));

// 3. Generate thumbnails for each device format
const thumbnails = prepareThumbnails(coverImage, formats);

// 4. Write raw pixel data to .ithmb files and record offsets
const thumbEntries = thumbnails.map((t) => {
  const filename = `:F${t.formatId}_1.ithmb`;
  const itmbPath = `/mnt/ipod/iPod_Control/Artwork/${filename.replace(/:/g, "/")}`;
  const stat = { size: 0 }; // get current file size for offset
  try {
    stat.size = readFileSync(itmbPath).length;
  } catch {}
  appendFileSync(itmbPath, Buffer.from(t.data));
  return {
    formatId: t.formatId,
    itmbOffset: stat.size,
    imageSize: t.data.length,
    width: t.width,
    height: t.height,
    filename,
  };
});

// 5. Update the ArtworkDB
const artDb = parseArtworkDatabase(artworkBuffer);
addArtworkEntry(artDb, track.dbid, thumbEntries);
const output = writeArtworkDatabase(artDb);
writeFileSync("/mnt/ipod/iPod_Control/Artwork/ArtworkDB", Buffer.from(output));
```

### Opening a Database from a Root Handle

Both databases also have an instance class (`ITunesDB`, `ArtworkDB`) that can open the database file **from the root directory of the mount** — you hand it a root handle, it reads `iPod_Control/iTunes/iTunesDB` (or `ArtworkDB`) itself, and throws if the file is not there. They implement TypeScript's `Disposable` protocol, so `using` releases the in-memory records automatically:

```ts
import { ITunesDB, createNodeImageDecoder } from "itunesdb-ts";

// Root handles are runtime-agnostic: an ItdbFileSystem adapter + optional
// root path, or a browser FileSystemDirectoryHandle. See "Usage by Runtime".
const root = { fs: nodeFs, rootPath: "/Volumes/IPOD" };

{
  using db = await ITunesDB.open(root, {
    imageDecoder: createNodeImageDecoder(),
  });
  await db.addTrack({
    title: "My Song",
    audioData: await nodeFs.readFile("/path/to/song.mp3"), // artwork is pulled from the audio metadata automatically
    // the ":iPod_Control:Music:Fxx:" location is generated automatically
  });
  const output = db.write();
  await db.save(); // or write the output wherever you like
  // db's in-memory arrays are cleared here, when the block exits
}
```

Entity methods live on the instances themselves:

```ts
db.getTrack(trackId); // -> ItdbTrack | undefined
db.getTracks(); // -> ItdbTrack[]
db.updateTrack(trackId, { rating: 5 }); // patch metadata in place
db.removeTrack(trackId);
db.getPlaylist(id) / db.getPlaylists();
db.addPlaylist("Favorites", [trackId]);
db.addTrackToPlaylist(id, trackId) / db.removeTrackFromPlaylist(id, trackId);
db.removePlaylist(id);
db.getAlbum(id) / db.getAlbums();

artDb.getImage(imageId) / artDb.getImages() / artDb.getImagesForSong(dbid);
artDb.addArtwork(songDbid, thumbnailEntries) / artDb.removeImage(imageId);
artDb.prepareThumbnails(rawImage, formats);
```

Passing a buffer that's already in memory still works via `ITunesDB.parse(buffer)` / `ArtworkDB.parse(buffer)`, and the standalone functions (`parseDatabase`/`writeDatabase`/`addTrack`/`removeTrack`, `parseArtworkDatabase`/`writeArtworkDatabase`/`prepareThumbnails`/`addArtworkEntry`) remain fully available if you'd rather manage `ITunesDB`/`ArtworkDB` objects manually instead of through the classes.

## Transactional Unit-of-Work Sync (`Itdb`)

The high-level `Itdb` class (mirroring the libgpod-ts API) owns the iTunesDB, the ArtworkDB and the iPod filesystem together, and applies **every mutation as a pending unit of work**:

- `addTrack`, `removeTrack`, playlist edits, and `setArtwork`/`removeArtwork` only change in-memory state (plus writing the new audio file itself).
- **`save()` commits everything as one transaction**: both databases are serialised in memory first (any error leaves the iPod untouched), every file is written as `<name>.tmp`, then moved into place with a filesystem `rename` (an atomic replace when available), and the iTunesDB is committed **last**. .tmp files are used because a mid-rename crash can leave an iPod with a corrupted database.
- Audio files of removed tracks are queued (`pendingDeletes`) and deleted only on `save()` — best effort, only when the adapter implements `remove`.

```ts
import { Itdb, createMemoryFs, detectDevice } from "itunesdb-ts";

const itdb = await Itdb.open(fs, { device: detectDevice("MB598") });
//            ^— fs: any ItdbFileSystem implementation (Node/Browser/Tauri)

const track = await itdb.addTrack(
  { title: "Song", artist: "Me", bitrate: 192 }, // metadata
  mp3Bytes, // audio file bytes
  undefined // artwork (auto-extracted if omitted)
);

await itdb.setArtwork(track.trackId, rgbaImage); // RGBA or encoded bytes (with imageDecoder)
await itdb.save(); // atomically: ithmb files → ArtworkDB → iTunesDB (last)
```

`Itdb.create(fs, options)` builds a fresh empty database without touching the filesystem. `IpodPaths` (`/iPod_Control/iTunes/iTunesDB`, `/iPod_Control/Artwork/ArtworkDB`, ...), `locationToPath`/`pathToLocation` (iPod `:`-location ↔ `/` path), `createMemoryFs`, `atomicWrite`/`commitTmp` and `ItdbError` mirror the libgpod-ts helpers. Artwork formats come from `device` or `artworkFormats` in the options.

### Zero-config runtime inference

The file system and image decoder are inferred from the runtime, so the
common paths need no wiring at all:

- **Node** — `findIpodRoot()` scans `/Volumes/*`, `/media/*`, `/run/media/*` and `/mnt/*` for a mounted iPod (`iPod_Control/iTunes/iTunesDB`); the default fs is rooted there, falling back to `process.cwd()`. The decoder uses `sharp` (lazily imported).
- **Browser** — the default fs prompts once with `showDirectoryPicker()` (File System Access API); the decoder uses `createImageBitmap`/`OffscreenCanvas`.
- **Tauri** — the decoder works in the webview, but the file system cannot be auto-wired (no mount info); pass an explicit `ItdbFileSystem` (e.g. wrap `@tauri-apps/plugin-fs`).

```ts
// Fully automatic — finds the iPod (or prompts for the folder) and
// picks the right decoder for the runtime:
using itdb = await Itdb.open({ device: detectDevice("MB598") });
// explicit forms still work: Itdb.open(fs, opts) / Itdb.open({ fs, device })
```

`ItunesDB.open()` and `ArtworkDB.open()` accept an optional root too, and
`createDefaultFs()` / `createDefaultImageDecoder()` / `detectRuntime()` /
`findIpodRoot()` are exported for manual use.

### Device checksum (hash58)

Newer iPods verify the iTunesDB at boot with a device-keyed checksum stored
in the `mhbd` header — **writing a DB without it makes the device treat the
library as corrupt**. `Itdb.save()` handles it automatically:

- The device generation decides the checksum type, exactly like libgpod
  (`hash58` for nano 3/4G and classic 1–3G; `hash72` / `hashAB` for nano 5G+,
  touch and iPhone generations; none for legacy devices).
- The FireWire GUID comes from the on-device `SysInfo`, which `Itdb.open()` /
  `Itdb.create()` read automatically — it can also auto-detect the model when
  no `device` was passed.
- `save()` computes the hash58 HMAC-SHA1 (key = SHA1 of the fixed seed and the
  GUID's S-box/LCM mix) over the serialized DB with `db_id`, `unk_0x32` and the
  hash field zeroed, then patches `hashing_scheme` (0x30) and the 20-byte hash
  (0x58) before the atomic commit.
- HASH72 signing (libgpod's `itdb_hash72`): a 46-byte AES-128-CBC signature at
  `0x72` over `SHA1(db) || random` with the device's (IV, random) pair. The
  pair is read from the on-device `iPod_Control/iTunes/HashInfo` file or
  derived from a validly-signed database already on the device; the derived
  pair is persisted back to `HashInfo` so later saves (and libgpod tools) can
  use it. **Apple Music and Finder validate this signature even on hash58
  generations** — a DB with an invalid/missing hash72 works on the iPod but
  reads as "corrupted" on macOS. `hash58` is applied last so its HMAC covers
  the final signed bytes (exactly like Apple's own DBs).
- It **fails closed**: a hash58 device without a readable GUID aborts the save
  before any byte is written, and `hash72` / `hashAB` generations refuse to save
  without a resolvable signing key (a wrong checksum is worse than none).

The primitives are exported for advanced use: `applyHash58`, `computeHash58`,
`applyHash72`, `extractHash72IvRandom`, `buildHashInfo`, `generateKey`,
`sha1`, `hmacSha1`, `checksumTypeForGeneration`, `checksumTypeForDevice`.

### Full workflow

```ts
import { Itdb, detectDevice } from "itunesdb-ts";
import { readFile } from "node:fs/promises";

// One object owns the iTunesDB + ArtworkDB + filesystem together.
// The fs (auto-detected iPod mount) and imageDecoder (sharp) are inferred.
using itdb = await Itdb.open({
  device: detectDevice("MB598"), // picks the thumbnail formats
});

// 1. Add tracks — audio bytes are copied to the iPod immediately
//    (into F00..F19 folders) and queued in the database; album art
//    embedded in the file is extracted and decoded automatically.
const audio = new Uint8Array(await readFile("/Users/me/Music/closing.mp3"));
const track = await itdb.addTrack(
  { title: "Closing Time", artist: "Semisonic" },
  audio
);

// 2. Playlists are created/edited in memory
const favorites = itdb.addPlaylist("My Favorites");
itdb.addTrackToPlaylist(track.trackId, favorites.playlistId);

// 3. Override artwork with your own image (RGBA or encoded bytes)
await itdb.setArtwork(track.trackId, coverArtPngBytes);

// 4. One atomic save: ithmb files -> ArtworkDB -> iTunesDB (last)
await itdb.save();

// The state is still live afterwards — keep editing and save again,
// or let `using` dispose it on block exit.
```

`itdb.tracks`, `itdb.playlists` and `itdb.masterPlaylist` are live views of the in-memory state — mutations through the methods show up there immediately, before any `save()`.

## Usage by Runtime

Every runtime needs an `ItdbFileSystem` adapter (`readFile`/`writeFile`/`exists`/`mkdir`) to talk to the iPod's mounted volume; the parse/write/sync logic itself is identical everywhere.

### Node.js

```ts
import { createNodeFs, createNodeImageDecoder } from "itunesdb-ts";

// Mount point of the iPod (any directory works for testing too)
const nodeFs = createNodeFs("/Volumes/IPOD");

using db = await ITunesDB.open(
  { fs: nodeFs }, // already rooted at the mount point
  { imageDecoder: createNodeImageDecoder() }
);

await db.addTrack({
  title: "My Song",
  artist: "My Artist",
  audioData: await nodeFs.readFile("/Users/me/Music/song.mp3"),
  // ipodPath / fileName are optional — a unique ":iPod_Control:Music:Fxx:" location is generated
});

await db.save(); // iTunesDB re-written to /Volumes/IPOD/iPod_Control/iTunes/iTunesDB
```

For the higher-level transactional workflow, hand the same adapter to `Itdb`:

```ts
import {
  Itdb,
  createNodeFs,
  detectDevice,
  createNodeImageDecoder,
} from "itunesdb-ts";

using itdb = await Itdb.open(createNodeFs("/Volumes/IPOD"), {
  device: detectDevice("MB598"),
  imageDecoder: createNodeImageDecoder(),
});

const track = await itdb.addTrack(
  { title: "My Song", artist: "My Artist" },
  await nodeFs.readFile("/Users/me/Music/song.mp3")
);
await itdb.save();
```

### Browser

```ts
import {
  ITunesDB,
  createBrowserFs,
  createBrowserImageDecoder,
} from "itunesdb-ts";

// `handle` is the File System Access API directory handle for the mounted
// iPod volume (e.g. from showDirectoryPicker()).
const browserFs = createBrowserFs(ipodRootHandle);

using db = await ITunesDB.open(
  { fs: browserFs },
  { imageDecoder: createBrowserImageDecoder() }
);

// Decode artwork from a user-selected file
const decoder = createBrowserImageDecoder();
const imageFile = await artHandle.getFile();
const rawImage = await decoder.decode(
  new Uint8Array(await imageFile.arrayBuffer())
);

await db.save();
```

The same adapter feeds the higher-level `Itdb` (which also needs a `device` or `artworkFormats` to size the thumbnails):

```ts
import { Itdb, createBrowserFs, detectDevice } from "itunesdb-ts";

using itdb = await Itdb.open(createBrowserFs(ipodRootHandle), {
  device: detectDevice(ipodProductId), // or pass artworkFormats explicitly
});

const track = await itdb.addTrack(
  { title: "My Song", artist: "My Artist" },
  audioBytes,
  albumArtBytes // optional; auto-extracted from the audio when omitted
);
await itdb.save();
```

### Tauri

```ts
import { ArtworkDB, type ItdbFileSystem } from "itunesdb-ts";
import { readFile, writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";

const tauriFs: ItdbFileSystem = {
  readFile: async (path) => {
    const bytes = await readFile(path);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
  },
  writeFile: (path, data) => writeFile(path, new Uint8Array(data)),
  exists: (path) => exists(path),
  mkdir: (path) => mkdir(path, { recursive: true }),
};

using artworkDb = await ArtworkDB.open({
  fs: tauriFs,
  rootPath: "/Volumes/IPOD",
});

// Image decoding on Tauri: implement `ItdbImageDecoder` with a Tauri
// command that uses Rust's `image` crate, since neither the browser
// canvas APIs nor Node's `sharp` are available in the Tauri webview.
const thumbnails = artworkDb.prepareThumbnails(rawImage, device.artworkFormats);

await artworkDb.save(); // ArtworkDB re-written to /Volumes/IPOD/iPod_Control/Artwork/ArtworkDB
```

The same `tauriFs` adapter drives `Itdb` for a full sync workflow (add `list`/`remove`/`rename` to your adapter so `save()` can commit atomically and delete removed audio):

```ts
import { Itdb, type ItdbFileSystem } from "itunesdb-ts";
import {
  readFile,
  writeFile,
  mkdir,
  exists,
  readDir,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";

const tauriFs: ItdbFileSystem = {
  readFile: async (path) => {
    const bytes = await readFile(path);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
  },
  writeFile: (path, data) => writeFile(path, new Uint8Array(data)),
  exists: (path) => exists(path),
  mkdir: (path) => mkdir(path, { recursive: true }),
  list: async (dir) => readDir(dir).map((e) => e.name),
  remove: (path) => remove(path),
  rename: (from, to) => rename(from, to),
};

using itdb = await Itdb.open(tauriFs, {
  artworkFormats: device.artworkFormats,
});

const track = await itdb.addTrack({ title: "Song", artist: "Me" }, audioBytes);
await itdb.save();
```

## Project Structure

Code is grouped by which database it belongs to, with runtime-agnostic primitives shared by both under `common/`:

```
src/
├── common/                # Shared by both databases
│   ├── binary/            # ItdbBinaryReader, ItdbBinaryWriter
│   ├── constants/         # Mac epoch conversion, iPod path separator
│   └── fs/                # ItdbFileSystem, createMemoryFs, atomicWrite/commitTmp, root handles
├── itunesdb/              # Everything needed to read/write iTunesDB
│   ├── constants/         # Magic numbers, MHOD types, header sizes, DB file path
│   ├── track/             # ItdbTrack, ItdbDataObject, parse/write track & MHOD
│   ├── playlist/          # ItdbPlaylist, ItdbPlaylistItem, parse/write playlist
│   ├── album/             # ItdbAlbum type
│   ├── database/          # ITunesDB (interface merged with class), parseDatabase, writeDatabase
│   ├── sync/              # addTrack, removeTrack
│   ├── metadata/          # extractEmbeddedArtwork (ID3v2 APIC, MP4 covr, FLAC picture)
│   └── index.ts
├── artworkdb/             # Everything needed to read/write ArtworkDB
│   ├── constants/         # Magic numbers, header sizes, DB file path
│   ├── artwork/           # encodePixels, decodePixels, resizeImage, image decoders
│   ├── device/            # ItdbDeviceInfo, detectDevice, model database
│   ├── database/          # ArtworkDB type, parseArtworkDatabase, writeArtworkDatabase, ArtworkDB
│   ├── sync/              # prepareThumbnails, addArtworkEntry
│   └── index.ts
├── ipod/                  # High-level Itdb: both databases + fs, transactional save
└── index.ts               # Barrel export (common + itunesdb + artworkdb + ipod)
```

## Binary Data Hierarchy

Every record in an iPod database starts with a `magic` (4 ASCII chars), a
`header size` (u32), a `total size` (u32, header + children) and a `count`
(u32). All integers are little-endian. Records nest: a database is a tree of
section records, each containing list records, each containing entity records,
each containing child data objects. The full hierarchy per entity type:

### iTunesDB (`iPod_Control/iTunes/iTunesDB`)

```
iTunesDB
└── mhbd   database header (244 bytes)
    │        +0x10 language tag ("BIF1"), +0x24 library id (u64,
    │        mirrored into every track at mhit+0x124), +0x30 hashing
    │        scheme, +0x58 hash58 (20B), +0x72 hash72 (46B),
    │        +0xa0 "sing" marker
    └── mhsd  section descriptors (96 bytes), one per section type:
               +0x0c = section type
        │
        ├── type 4 → mhla list (albums)         ← Apple writes this FIRST
        │   │         mhla header (92) → count of mhia records
        │   └── mhia   album record (40 bytes)
        │              one per unique album; id allocated from the SAME
        │              counter as track ids; distinct dbid per album
        │
        ├── type 1 → mhlt list (tracks)
        │   │         mhlt header (92) → count of mhit records
        │   └── mhit   track record (624-byte header + mhod children)
        │        │
        │        └── mhod  data objects (24-byte header + body):
        │                  1 title · 2 path · 3 album · 4 artist ·
        │                  5 genre · 6 filetype · 12 composer ·
        │                  23 sort artist · etc.
        │
        ├── type 3 → mhlp list (special playlists)   ← master lives here
        │   │         mhlp header (92) → count of mhyp records
        │   └── mhyp  playlist record (header + mhod children)
        │        │     name is a mhod type 100 (PLAYLIST); smart playlists
        │        │     carry type 50/51 rules
        │        └── mhip  playlist items (8 bytes each):
        │                  u32 track id reference
        │
        ├── type 2 → mhlp list (standard playlists)  ← master ALSO here
        │   └── mhyp / mhip   (same shape as type 3)
        │
        └── type 5 → mhlp list (extra playlists)
            └── Music · Videos · Movies · TV Shows · Audiobooks · Rentals
```

Apple writes exactly five `mhsd` sections in the order **`4,1,3,2,5`**
(albums, tracks, special playlists, standard playlists, extra playlists).
libgpod 0.8.0 writes eight sections (`1,3,2,4,8,6,10,5`); Apple Music and
Finder reject that layout and ask for a restore. This library emits Apple's
five-section order.

### mhit track-record field layout

The 624-byte `mhit` header carries the track metadata at fixed offsets
(full map in `libgpod`'s `mk_mhit` / `src/itunesdb/track/writeTrack.ts`):

| Offset | Field | Notes |
| ------ | ----- | ----- |
| +0x10 | track id | from the shared library-wide counter |
| +0x14 | visible | 1 |
| +0x18 | filetype | 4-char fourcc |
| +0x1c / +0x1d | type1 / type2 | `0x00 0x01` for audio (u16 = 0x0100) |
| +0x1e / +0x1f | compilation / rating | |
| +0x20 | timestamp | Mac epoch |
| +0x24 | filesize | |
| +0x28 | tracklen | ms |
| +0x2c / +0x30 | track number / total | |
| +0x34 / +0x38 / +0x3c | year / bitrate / samplerate | |
| +0x40 → +0x4c | volume, start/stop time, soundcheck | |
| +0x50 → +0x5c | playcount, playcount2, last played, cd nr | |
| +0x60 → +0x6c | cds, drm user id, time added, bookmark | |
| +0x70 | dbid (u64) | unique per track |
| +0x78 → +0x7e | checked, app rating, BPM, artwork count, unk126 | unk126 = 0xffff |
| +0x80 → +0x8c | artwork size, unk132, samplerate2 (float), time released | |
| +0x90 | unk144 | `0x000c` for MP3/AAC audio |
| +0x92 → +0x9c | explicit flag, unk148/152, skip count | |
| +0xa0 / +0xa4 → +0xa7 | last skipped / artwork + flag bytes | |
| +0xa8 | dbid2 (u64) | libgpod sets = dbid |
| +0xb0 → +0xb3 | lyrics, movie flags, mark_unplayed, unk179 | mark_unplayed = 0x01 |
| +0xb4 → +0xcc | unk180, pregap, samplecount, postgap, unk204 | |
| +0xd0 → +0xdc | mediatype, season, episode, unk220 | |
| +0xe0 → +0xfc | gapless fields + unks | |
| +0x100 / +0x102 | gapless track / album flags | |
| +0x120 | album id | link to mhia record |
| +0x124 | library id (u64) | mirror of mhbd+0x24 |
| +0x12c | filesize (again) | libgpod writes size twice |
| +0x160 | mhii_link | artwork link, matches mhii song_id |
| +0x1e0 / +0x1f4 | artist id / composer id | from the shared counter |

### ArtworkDB (`iPod_Control/Artwork/ArtworkDB`)

```
ArtworkDB
└── mhfd   file header (132 bytes)
    └── mhii  image records (52 bytes), one per song with artwork:
         │     +song_id = the track's dbid (linked by mhit+0x160)
         └── mhod  thumbnail entries (24-byte header + body):
                   the image format id + link to the .ithmb file
                   (`:F{format}_{index}.ithmb`), offset, width,
                   height and encoded size within that file
    the raw thumbnail pixel data lives in .ithmb files under
    iPod_Control/Artwork/ (one file per format; entries are appended
    and the ArtworkDB records point at their byte offsets)
```

## Apple Compatibility Notes

Everything here was verified against real devices and Apple's own tools
(Apple Music / Finder) across this project's history. Treat it as the
ground truth when writing DBs that Apple will read:

- **Five sections, in order** — Apple writes `4,1,3,2,5` and nothing else.
  libgpod's eight-section layout, the old default, reads as "needs restore".
- **Master playlist in two sections** — the master ("Brandon James's iPod")
  appears in BOTH the type-3 (special) and type-2 (standard) playlist
  sections. Keep the duplicate; the writer emits it where `isMaster`.
- **One shared id counter** — track ids, album ids, artist ids and composer
  ids all come from ONE ascending sequence (Apple: T2343, C2347, A2349 …).
  Tightly-packed 1,2,3 ids and album-dbid/track-dbid collisions both break
  Apple's parser given the exact same content.
- **Preserved bytes win** — the parser keeps every record's raw header;
  `writeTrack`/`writeDatabase` patch only modelled fields on top. Round-trips
  of Apple-accepted DBs are byte-identical (checked to 0 diffs outside the
  checksum region) — a DB Apple wrote, re-serialized by this library, is
  accepted again. This is the strongest known-good state.
- **Fresh tracks must carry the accepted constants** — a synthesized track
  with `type1/type2` = `[01 00]`, `unk144 = 0`, `dbid2 = 0`, or a missing
  library-id mirror is flagged by Apple even though the iPod itself plays it.
  The writer now emits the table in the hierarchy section above.
- **Checksums are validated by Apple's tools, not just the firmware** —
  hash58 (device-keyed HMAC-SHA1) is required for boot on nano 3/4G and
  classic 1–3G; hash72 (46-byte AES-128-CBC signature at +0x72) is required
  by hash58-generation devices' *firmware* AND validated by Apple Music /
  Finder on macOS. A DB with a broken hash72 "plays fine on the iPod, reads
  as corrupted on the Mac" — always re-sign both.
- **The signing pair is the device's, not yours** — Apple's daemon validates
  against the (IV, random) pair in the device's `HashInfo`. Inventing a fresh
  pair each save makes the DB self-consistent but foreign. Read `HashInfo`
  first, derive from a validly-signed DB second (pure-JS AES-128-ECB in the
  browser), and only bootstrap a fresh pair when neither exists (and persist
  it back to `HashInfo` so it stays stable across syncs).

## API Reference

### Database (`src/itunesdb/database/`)

| Export                                          | Description                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `parseDatabase(buffer: ArrayBuffer): ITunesDB`  | Parse an iTunesDB binary file into an ITunesDB instance                                   |
| `writeDatabase(db: ITunesDB): ArrayBuffer`      | Serialize an ITunesDB back to binary                                                      |
| `ITunesDB.open(root, opts): Promise<...>`       | Read iTunesDB from a root handle; throws if missing                                       |
| `ITunesDB.parse(buffer)`                        | Instance class for an already-loaded buffer                                               |
| `itunesDb.getTracks() / getTrack(id)`           | Track accessors                                                                           |
| `itunesDb.addTrack(params): Promise<ItdbTrack>` | Add a track (pulls embedded art from audio metadata)                                      |
| `itunesDb.updateTrack(id, patch)`               | Patch track metadata in place                                                             |
| `itunesDb.removeTrack(id)`                      | Remove a track by ID                                                                      |
| `itunesDb.getPlaylists() / getPlaylist(id)`     | Playlist accessors                                                                        |
| `itunesDb.addPlaylist(name, trackIds)`          | Create a playlist                                                                         |
| `itunesDb.addTrackToPlaylist(id, trackId)`      | Add a track to a playlist                                                                 |
| `itunesDb.removeTrackFromPlaylist(id, trackId)` | Remove a track from a playlist                                                            |
| `itunesDb.removePlaylist(id)`                   | Remove a playlist                                                                         |
| `itunesDb.getAlbums() / getAlbum(id)`           | Album accessors                                                                           |
| `itunesDb.write(): ArrayBuffer`                 | Serialize back to binary                                                                  |
| `itunesDb.save(): Promise<void>`                | Write back to the root it was opened from                                                 |
| `ITunesDB`                                      | Data interface for a parsed database; merged with the class (fields live on the instance) |
| `ItdbTrackUpdate`                               | Mutable metadata fields for `updateTrack`                                                 |

### Track (`src/itunesdb/track/`)

| Export                                           | Description                                |
| ------------------------------------------------ | ------------------------------------------ |
| `parseTrack(reader): { track, bytesRead }`       | Parse a single MHIT record                 |
| `writeTrack(writer, track)`                      | Write a single MHIT record                 |
| `parseDataObject(reader): { object, bytesRead }` | Parse a single MHOD record                 |
| `writeDataObject(writer, obj)`                   | Write a single MHOD record                 |
| `MHOD_STRING_FIELDS`                             | Maps MHOD type IDs to track property names |
| `ItdbTrack`                                      | Track interface                            |
| `ItdbDataObject`                                 | Data object interface                      |

### Playlist (`src/itunesdb/playlist/`)

| Export                                           | Description                |
| ------------------------------------------------ | -------------------------- |
| `parsePlaylist(reader): { playlist, bytesRead }` | Parse a single MHYP record |
| `writePlaylist(writer, playlist)`                | Write a single MHYP record |
| `ItdbPlaylist`                                   | Playlist interface         |
| `ItdbPlaylistItem`                               | Playlist item interface    |

### Album (`src/itunesdb/album/`)

| Export      | Description     |
| ----------- | --------------- |
| `ItdbAlbum` | Album interface |

### Sync (`src/itunesdb/sync/`)

| Export                              | Description                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `addTrack(db, params): ItdbTrack`   | Add a track to the database (standalone)                                           |
| `removeTrack(db, trackId): boolean` | Remove a track by ID (standalone)                                                  |
| `ItdbAddTrackParams`                | Parameters for addTrack (`ipodPath`/`fileName` optional — location auto-generated) |

### Metadata (`src/itunesdb/metadata/`)

| Export                                                            | Description                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `extractEmbeddedArtwork(audioBytes): ItdbEmbeddedArtwork \| null` | Extract embedded album art (ID3v2 APIC, MP4 covr, FLAC picture) |
| `ItdbEmbeddedArtwork`                                             | `{ mimeType, data }` result                                     |

### ArtworkDB (`src/artworkdb/database/`)

| Export                                     | Description                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `parseArtworkDatabase(buffer): ArtworkDB`  | Parse an ArtworkDB binary file into an ArtworkDB instance                                  |
| `writeArtworkDatabase(db): ArrayBuffer`    | Serialize an ArtworkDB back to binary                                                      |
| `ArtworkDB.open(root): Promise<...>`       | Read ArtworkDB from a root handle; throws if missing                                       |
| `ArtworkDB.parse(buffer)`                  | Instance class for an already-loaded buffer                                                |
| `artDb.getImages() / getImage(id)`         | Image accessors                                                                            |
| `artDb.getImagesForSong(dbid)`             | Images linked to a track's dbid                                                            |
| `artDb.addArtwork(songDbid, thumbnails)`   | Add an image entry to the ArtworkDB                                                        |
| `artDb.removeImage(id)`                    | Remove an image entry                                                                      |
| `artDb.prepareThumbnails(source, formats)` | Generate device-format thumbnails                                                          |
| `artDb.write(): ArrayBuffer`               | Serialize back to binary                                                                   |
| `artDb.save(): Promise<void>`              | Write back to the root it was opened from                                                  |
| `ArtworkDB`                                | Data interface for a parsed ArtworkDB; merged with the class (fields live on the instance) |
| `ItdbImageItem`                            | Image item interface                                                                       |
| `ItdbThumbnail`                            | Thumbnail interface                                                                        |
| `ItdbFileInfo`                             | File info interface                                                                        |

### Device (`src/device/`)

| Export                                                  | Description                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `detectDevice(input: string \| number): ItdbDeviceInfo` | Detect iPod from SysInfo text, model number, or USB product ID; throws if unknown |
| `getArtworkFormatsForModel(model): ItdbArtworkFormat[]` | Get artwork formats for a model number                                            |
| `IPOD_MODELS`                                           | Full model database                                                               |
| `ItdbDeviceInfo`                                        | Device info interface                                                             |
| `ItdbGeneration`                                        | Generation type                                                                   |
| `ItdbArtworkFormat`                                     | Artwork format interface                                                          |
| `ItdbPixelFormat`                                       | Pixel format type                                                                 |

### Ipod High-Level API (`src/ipod/`)

| Export                                                                                                      | Description                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Itdb`                                                                                                      | High-level database: owns iTunesDB + ArtworkDB + fs with pending-changes save |
| `Itdb.open(fs, options)` / `Itdb.create(fs, options)`                                                       | Open an iPod, or create an empty database in memory                           |
| `itdb.addTrack(meta, audioData, artwork?, options?)`                                                        | Copy audio to the iPod, add a track (+ master playlist item)                  |
| `itdb.removeTrack(id)`                                                                                      | Remove a track; audio deleted on next save                                    |
| `itdb.setArtwork(trackId, artwork)` / `itdb.removeArtwork(trackId)` / `itdb.getArtwork(trackId, formatId?)` | Cover-art operations (scaled to every configured format)                      |
| `itdb.addPlaylist(name)` / `itdb.removePlaylist(id)`                                                        | Playlist create/delete (master is protected)                                  |
| `itdb.addTrackToPlaylist(trackId, playlistId)` / `itdb.removeTrackFromPlaylist(trackId, playlistId)`        | Playlist membership                                                           |
| `itdb.clear()` / `clearTracks()` / `clearPlaylists()` / `clearArtwork()`                                    | Bulk resets (audio queued for deletion)                                       |
| `itdb.save()`                                                                                               | Transactional unit of work: `.tmp` + atomic `rename`, iTunesDB committed last |
| `itdb.tracks` / `itdb.playlists` / `itdb.masterPlaylist`                                                    | Live model accessors                                                          |
| `[Symbol.dispose]()`                                                                                        | Disposable protocol — clears all in-memory records (`using itdb = ...` works) |
| `IpodPaths`                                                                                                 | Standard file locations (`iPod_Control/...`)                                  |
| `locationToPath(path)` / `pathToLocation(location)`                                                         | iPod `:`-location ↔ `/` path conversion                                       |
| `ItdbError`                                                                                                 | Error thrown for unknown ids / invalid operations                             |
| `ItdbOptions`, `AddTrackOptions`, `ArtworkInput`, `TrackMeta`                                               | Options and metadata types                                                    |

### Filesystem (`src/common/fs/`)

| Export                                                                 | Description                                                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ItdbFileSystem`                                                       | Filesystem adapter interface (readFile/writeFile/exists/mkdir + optional list/remove/rename) |
| `createMemoryFs()`                                                      | In-memory adapter factory (implements remove/rename for atomic saves)                        |
| `atomicWrite(fs, path, data)` / `commitTmp(fs, tmp, path, data)`       | `.tmp`-then-rename atomic file commit                                                        |
| `normalizePath(path)` / `dirname(path)`                                | iPod path helpers                                                                            |
| `FsNotFoundError`                                                      | ENOENT-style error for missing paths                                                         |
| `createBrowserFs(handle)`                                              | File System Access API adapter                                                               |
| `createNodeFs(rootDir)`                                                | Node `fs/promises` adapter (implements list/remove/rename for atomic saves and deletions)    |
| `resolveRoot(root)` / `joinRootPath(rootPath, rel)` / `ItdbRootHandle` | Root-directory handle resolution                                                             |

### Artwork (`src/artworkdb/artwork/`)

| Export                                          | Description                                              |
| ----------------------------------------------- | -------------------------------------------------------- |
| `encodePixels(rgba, w, h, format): Uint8Array`  | Encode RGBA to iPod pixel format                         |
| `decodePixels(data, w, h, format): Uint8Array`  | Decode iPod pixel format to RGBA                         |
| `resizeImage(source, w, h, crop): ItdbRawImage` | Resize with crop or fit-and-pad                          |
| `rotateImage(source, degrees): ItdbRawImage`    | Rotate by 0/90/180/270 degrees                           |
| `detectImageMimeType(data): string`             | Detect JPEG/PNG/WebP from magic bytes                    |
| `createBrowserImageDecoder(): ItdbImageDecoder` | Browser decoder (createImageBitmap; auto-detects format) |
| `createNodeImageDecoder(): ItdbImageDecoder`    | Node.js decoder (requires `sharp`; auto-detects format)  |
| `ItdbRawImage`                                  | Raw RGBA image interface                                 |
| `ItdbImageDecoder`                              | Pluggable decoder interface                              |

### Sync (`src/artworkdb/sync/`)

| Export                                                       | Description                                |
| ------------------------------------------------------------ | ------------------------------------------ |
| `prepareThumbnails(source, formats): ItdbEncodedThumbnail[]` | Generate thumbnails for all device formats |
| `addArtworkEntry(artworkDb, songDbid, thumbnails)`           | Add image entry to ArtworkDB               |

### Binary (`src/common/binary/`)

| Export             | Description                                  |
| ------------------ | -------------------------------------------- |
| `ItdbBinaryReader` | Little-endian binary reader over ArrayBuffer |
| `ItdbBinaryWriter` | Little-endian binary writer with auto-resize |

### Constants (`src/common/constants/`, `src/itunesdb/constants/`, `src/artworkdb/constants/`)

| Export                     | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `macToDate(macTime): Date` | Convert Mac timestamp to JS Date (common)                                |
| `dateToMac(date): number`  | Convert JS Date to Mac timestamp (common)                                |
| `ItdbFileSystem`           | File system adapter interface (common)                                   |
| `ItdbRootHandle`           | Root of the mount: `{ fs, rootPath? }` or `{ directoryHandle }` (common) |
| `MhodType`                 | MHOD type ID constants (itunesdb)                                        |
| `ITUNESDB_HEADER_SIZES`    | Default header sizes for iTunesDB records (itunesdb)                     |
| `ARTWORKDB_HEADER_SIZES`   | Default header sizes for ArtworkDB records (artworkdb)                   |

## Round-Trip Safety

The parser preserves raw header bytes for every record. The writer uses these preserved bytes as a base and only patches the fields it explicitly models. This means:

- Unknown/undocumented fields survive the parse→write cycle
- The output is as close to the original as possible
- New tracks/playlists get fresh headers with safe defaults


## Supported Devices

The model database covers iPod shuffle (1G–4G), mini (1G–2G), nano (1G–7G), photo, video (5G/5.5G), classic (1G–3G), and touch (1G–4G) with correct artwork format specifications for each.

## License

MIT
