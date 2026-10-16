/**
 * Port of libgpod's `itdb_hash72.c` (the HASH72 checksum) to TypeScript.
 *
 * Devices using the HASH72 checksum scheme (nano 3G/4G, classic) carry a
 * 46-byte `hash72` signature in the mhbd header (offset 0x72). The
 * signature is an AES-128-CBC encryption of `SHA1(iTunesDB) || random` keyed
 * by a scheme-level constant key and the device's (IV, random) pair:
 *
 *   signature = 0x01 0x00 || random[12] || AES-128-CBC(USER_KEY,
 *                                                       SHA1(db) || random)
 *
 * where `USER_KEY` is a fixed 16-byte constant in libgpod:
 *   61 8c a1 0d c7 f5 7f d3 b4 72 3e 08 15 74 63 d7
 *
 * The SHA1 is computed over the whole DB with db_id (0x18), hash58 (0x58)
 * and hash72 (0x72) zeroed (libgpod's `itdb_hash72_compute_itunesdb_sha1`).
 *
 * The (IV, random) pair is device-specific. libgpod stores it in the
 * device's `iPod_Control/iTunes/HashInfo` file (header "HASHv0" + 20-byte
 * hex UUID + random[12] + IV[16]) and can also *recover* it from any
 * validly-signed DB (`hash_extract`) since the signature carries the
 * random bytes and the IV is recoverable from the first AES block.
 *
 * Apple's tools (Music, Finder) validate the DB against this signature;
 * the device firmware and libgpod do not check it, which is why a DB with
 * an invalid/missing hash72 still works on the device but reads as
 * "corrupted" on macOS.
 */

/** AES-128 key from libgpod's itdb_hash72.c. */
export const HASH72_AES_KEY = new Uint8Array([
  0x61, 0x8c, 0xa1, 0x0d, 0xc7, 0xf5, 0x7f, 0xd3,
  0xb4, 0x72, 0x3e, 0x08, 0x15, 0x74, 0x63, 0xd7,
]);

/** Where the 46-byte hash72 signature lives in the mhbd header. */
export const MHBD_HASH72_OFFSET = 0x72;

/** The hashing_scheme value Apple writes for HASH72 nano/classic DBs. */
export const HASH72_SCHEME = 3;

/**
 * AES-128-CBC encryption (no padding) via node:crypto (Node/Tauri) or
 * SubtleCrypto (browser). WebCrypto is async, so the hash72 helpers are
 * async throughout.
 */
async function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const g = globalThis as Record<string, unknown>;
  if (typeof process !== 'undefined' && process.versions?.node) {
    const c = await import('node:crypto');
    const enc = c.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
    enc.setAutoPadding(false);
    return new Uint8Array(Buffer.concat([enc.update(Buffer.from(plaintext)), enc.final()]));
  }
  const subtle = (g.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Error('No AES available: node:crypto and SubtleCrypto both missing');
  const k = await subtle.importKey('raw', key as unknown as BufferSource, { name: 'AES-CBC' }, false, ['encrypt']);
  const out = await subtle.encrypt({ name: 'AES-CBC', iv: iv as unknown as BufferSource }, k, plaintext as unknown as BufferSource);
  // WebCrypto's AES-CBC *always* appends a PKCS#7 padding block. Truncating
  // the ciphertext back to the plaintext length is exactly the unpadded CBC
  // result (each plaintext block encrypts independently in CBC mode), giving
  // Node-identical output without a padding block — the browser crash was a
  // 48-byte padded block copied into the 46-byte hash72 signature.
  return new Uint8Array(out, 0, plaintext.length);
}

/**
 * AES-128-ECB decryption of a single 16-byte block (node:crypto only, used
 * for IV recovery during extraction).
 */
async function aesEcbDecryptBlock(cipher: Buffer): Promise<Uint8Array> {
  if (typeof process === 'undefined' || !process.versions?.node) {
    // Browser: compact pure-JS AES-128 ECB single-block decrypt
    // (reference implementation; FIPS-197 verified).
    return decryptBlockJs(cipher);
  }
  const c = await import('node:crypto');
  const d = c.createDecipheriv('aes-128-ecb', Buffer.from(HASH72_AES_KEY), null);
  d.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([d.update(cipher), d.final()]));
}

/* ---- Pure-TS AES-128 block decrypt (browser) ---- */

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

// Inverse MixColumns matrix constants {14,11,13,9, 9,14,11,13, 13,9,14,11, 11,13,9,14}.
const IM = [14, 11, 13, 9, 9, 14, 11, 13, 13, 9, 14, 11, 11, 13, 9, 14];

function gm(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

// Rcon for AES-128 key expansion (word-rounds 1..10).
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function aesExpand(w: Uint8Array, key: Uint8Array): void {
  let i, j, t;
  for (i = 0; i < 16; i++) w[i] = key[i];
  for (i = 16; i < 176; i += 4) {
    // Copy previous word
    for (j = 0; j < 4; j++) w[i + j] = w[i + j - 4];
    if (i % 16 === 0) {
      // RotWord
      t = w[i];
      w[i] = w[i + 1];
      w[i + 1] = w[i + 2];
      w[i + 2] = w[i + 3];
      w[i + 3] = t;
      // SubWord
      for (j = 0; j < 4; j++) w[i + j] = SBOX[w[i + j]];
      w[i] ^= RCON[i / 16 - 1];
    }
    for (j = 0; j < 4; j++) w[i + j] ^= w[i + j - 16];
  }
}

function decryptBlockJs(cipher: Buffer, key: Uint8Array = HASH72_AES_KEY): Uint8Array {
  const w = new Uint8Array(176);
  aesExpand(w, key);
  const s = new Uint8Array(cipher.subarray(0, 16));
  for (let i = 0; i < 16; i++) s[i] ^= w[160 + i];

  for (let round = 9; round >= 1; round--) {
    // InvShiftRows
    const t = new Uint8Array(16);
    t[0] = s[0]; t[1] = s[13]; t[2] = s[10]; t[3] = s[7];
    t[4] = s[4]; t[5] = s[1]; t[6] = s[14]; t[7] = s[11];
    t[8] = s[8]; t[9] = s[5]; t[10] = s[2]; t[11] = s[15];
    t[12] = s[12]; t[13] = s[9]; t[14] = s[6]; t[15] = s[3];
    // InvSubBytes
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[t[i]];
    // AddRoundKey (round 1..13 keys)
    for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
    // InvMixColumns — FIPS layout: column c = CONTIGUOUS bytes 4c..4c+3.
    for (let c = 0; c < 4; c++) {
      const o = c * 4;
      const a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
      s[o] = gm(a0, IM[0]) ^ gm(a1, IM[1]) ^ gm(a2, IM[2]) ^ gm(a3, IM[3]);
      s[o + 1] = gm(a0, IM[4]) ^ gm(a1, IM[5]) ^ gm(a2, IM[6]) ^ gm(a3, IM[7]);
      s[o + 2] = gm(a0, IM[8]) ^ gm(a1, IM[9]) ^ gm(a2, IM[10]) ^ gm(a3, IM[11]);
      s[o + 3] = gm(a0, IM[12]) ^ gm(a1, IM[13]) ^ gm(a2, IM[14]) ^ gm(a3, IM[15]);
    }
  }
  // Final round: InvShiftRows + InvSubBytes + AddRoundKey(round 0)
  const t = new Uint8Array(16);
  t[0] = s[0]; t[1] = s[13]; t[2] = s[10]; t[3] = s[7];
  t[4] = s[4]; t[5] = s[1]; t[6] = s[14]; t[7] = s[11];
  t[8] = s[8]; t[9] = s[5]; t[10] = s[2]; t[11] = s[15];
  t[12] = s[12]; t[13] = s[9]; t[14] = s[6]; t[15] = s[3];
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = INV_SBOX[t[i]] ^ w[i];
  return out;
}

/**
 * Compute the SHA1 of an iTunesDB buffer used by hash72
 * (libgpod's `itdb_hash72_compute_itunesdb_sha1`): db_id, hash58 and
 * hash72 are zeroed; unk_0x32 is NOT zeroed (unlike the hash58 SHA1).
 */
export async function hash72DbSha1(itdb: Uint8Array): Promise<Uint8Array> {
  const d = new Uint8Array(itdb);
  d.fill(0, 0x18, 0x20);     // db_id
  d.fill(0, 0x58, 0x6c);     // hash58
  d.fill(0, 0x72, 0xa0);     // hash72 (46 bytes)
  if (typeof process !== 'undefined' && process.versions?.node) {
    const c = await import('node:crypto');
    const sha1 = c.createHash('sha1').update(Buffer.from(d)).digest();
    return new Uint8Array(sha1);
  }
  const subtle = (globalThis as Record<string, unknown>).crypto as Crypto | undefined;
  const subtleCrypto = subtle?.subtle;
  if (!subtleCrypto) throw new Error('No SHA1 available in this runtime');
  const buf = await subtleCrypto.digest('SHA-1', d as unknown as BufferSource);
  return new Uint8Array(buf);
}

/**
 * Build the 46-byte hash72 signature for a DB SHA1 (libgpod's
 * `hash_generate`): returns `01 00 || random[12] || AES-CBC(iv, sha1||random)`.
 */
export async function generateHash72Signature(
  sha1: Uint8Array,
  iv: Uint8Array,
  random: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = new Uint8Array(32);
  plaintext.set(sha1.subarray(0, 20), 0);
  plaintext.set(random, 20);
  const enc = await aesCbcEncrypt(HASH72_AES_KEY, iv, plaintext);
  const sig = new Uint8Array(46);
  sig[0] = 0x01;
  sig[1] = 0x00;
  sig.set(random, 2);
  sig.set(enc, 14);
  return sig;
}

/**
 * Recover the (IV, random) pair from a validly-signed iTunesDB
 * (libgpod's `hash_extract`, done correctly): random comes straight from
 * the signature; the IV is recovered from the first AES block via
 * `IV = D(C1) XOR sha1[0..16]`. Returns null when the DB is not
 * validly signed (prefix != 01 00 or the recovered pair fails a full
 * re-sign round-trip against the second AES block).
 */
export async function extractHash72IvRandom(itdb: Uint8Array): Promise<{ iv: Uint8Array; random: Uint8Array } | null> {
  if (itdb.length < 0xa0) return null;
  if (itdb[MHBD_HASH72_OFFSET] !== 0x01 || itdb[MHBD_HASH72_OFFSET + 1] !== 0x00) return null;
  const sha1 = await hash72DbSha1(itdb);
  const c1 = itdb.subarray(MHBD_HASH72_OFFSET + 14, MHBD_HASH72_OFFSET + 30);
  const c2 = itdb.subarray(MHBD_HASH72_OFFSET + 30, MHBD_HASH72_OFFSET + 46);
  const random = itdb.subarray(MHBD_HASH72_OFFSET + 2, MHBD_HASH72_OFFSET + 14);
  const iv = new Uint8Array(16);
  const dec1 = await aesEcbDecryptBlock(Buffer.from(c1));
  for (let i = 0; i < 16; i++) iv[i] = dec1[i] ^ sha1[i];
  // Validate via the second block: P2 = D(C2) XOR C1 must be sha1[16..20] || random.
  const dec2 = await aesEcbDecryptBlock(Buffer.from(c2));
  const p2 = new Uint8Array(16);
  for (let i = 0; i < 16; i++) p2[i] = dec2[i] ^ c1[i];
  for (let i = 0; i < 4; i++) if (p2[i] !== sha1[16 + i]) return null;
  for (let i = 0; i < 12; i++) if (p2[4 + i] !== random[i]) return null;
  return { iv, random: new Uint8Array(random) };
}

/**
 * Apply the hash72 signature to a serialized iTunesDB, returning a patched
 * copy. Sets hashing_scheme@0x70 = HASH72_SCHEME and writes the 46-byte
 * signature at 0x72. The original buffer is not modified.
 *
 * @param itdb   - Full iTunesDB bytes ("mhbd" magic, >= 0xa0 bytes).
 * @param iv     - Device IV (16 bytes) from HashInfo or extraction.
 * @param random - Device random nonce (12 bytes).
 * @returns The patched copy.
 */
export async function applyHash72(itdb: Uint8Array, iv: Uint8Array, random: Uint8Array): Promise<Uint8Array> {
  if (itdb.length < 0xa0) throw new Error('iTunesDB buffer too small to write hash72');
  const out = new Uint8Array(itdb);
  // Set hashing_scheme BEFORE computing the SHA1: extraction (and Apple's
  // validation) computes the SHA1 over the on-disk header, which carries the
  // scheme byte. Signing and verifying must see the same bytes.
  new DataView(out.buffer).setUint16(0x70, HASH72_SCHEME, true);
  const sha1 = await hash72DbSha1(out);
  const sig = await generateHash72Signature(sha1, iv, random);
  out.set(sig, 0x72);
  return out;
}

/**
 * Serialize the device's HashInfo file contents ("HASHv0" + 20-byte hex
 * UUID + random[12] + IV[16]), matching libgpod's `Hash78Info`.
 */
export function buildHashInfo(uuidHex: string, iv: Uint8Array, random: Uint8Array): Uint8Array {
  const hdr = new TextEncoder().encode('HASHv0');
  const uuid = new Uint8Array(20);
  const hex = uuidHex.replace(/[^0-9a-fA-F]/g, '');
  for (let i = 0; i + 1 < hex.length && i < 40; i += 2) {
    uuid[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  const out = new Uint8Array(6 + 20 + 12 + 16);
  out.set(hdr, 0);
  out.set(uuid, 6);
  out.set(random, 26);
  out.set(iv, 38);
  return out;
}
