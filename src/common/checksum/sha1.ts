/**
 * SHA-1 and HMAC-SHA1, implemented from the spec (RFC 3174 / RFC 2104).
 * Used by the iPod iTunesDB hash58 checksum (libgpod's itdb_hash58.c
 * re-implements HMAC-SHA1 manually via GChecksum, which is standard
 * HMAC). Verified against the published test vectors.
 */

const K0 = 0x5a827999;
const K1 = 0x6ed9eba1;
const K2 = 0x8f1bbcdc;
const K3 = 0xca62c1d6;

function rotl(n: number, b: number): number {
  return ((n << b) | (n >>> (32 - b))) >>> 0;
}

/**
 * Compute the SHA-1 digest of `data`.
 * @returns 20-byte digest.
 */
export function sha1(data: Uint8Array): Uint8Array {
  const ml = data.length * 8;
  const padded = new Uint8Array((data.length + 8 + 64) & ~63);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, ml >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(ml / 0x100000000) >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number; let k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = K0; }
      else if (i < 40) { f = b ^ c ^ d; k = K1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = K2; }
      else { f = b ^ c ^ d; k = K3; }
      const tmp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const od = new DataView(out.buffer);
  od.setUint32(0, h0); od.setUint32(4, h1);
  od.setUint32(8, h2); od.setUint32(12, h3);
  od.setUint32(16, h4);
  return out;
}

/**
 * Compute HMAC-SHA1 (RFC 2104) of `data` with `key`.
 * @returns 20-byte MAC. Keys longer than 64 bytes are hashed first.
 */
export function hmacSha1(key: Uint8Array, data: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > 64) k = sha1(k);
  const block = new Uint8Array(64);
  block.set(k.subarray(0, 64));

  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }

  const innerMsg = new Uint8Array(inner.length + data.length);
  innerMsg.set(inner);
  innerMsg.set(data, inner.length);
  const innerHash = sha1(innerMsg);

  const outerMsg = new Uint8Array(outer.length + innerHash.length);
  outerMsg.set(outer);
  outerMsg.set(innerHash, outer.length);
  return sha1(outerMsg);
}

/** Format bytes as lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Parse a hex string (optional `0x` prefix) into bytes. */
export function fromHex(hex: string, outSize?: number): Uint8Array {
  let s = hex.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
  const bytes = new Uint8Array(Math.ceil(s.length / 2));
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < s.length; i += 2) {
    dv.setUint8(i / 2, parseInt(s.slice(i, i + 2), 16));
  }
  if (outSize !== undefined && outSize > bytes.length) {
    const padded = new Uint8Array(outSize);
    padded.set(bytes);
    return padded;
  }
  return bytes;
}
