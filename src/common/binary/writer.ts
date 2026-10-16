/**
 * Cross-runtime binary writer that builds an ArrayBuffer incrementally.
 *
 * Uses a resizable internal buffer. All multi-byte writes default to
 * **little-endian** to match the iPod on-disk format.
 */
export class ItdbBinaryWriter {
  private _buffer: ArrayBuffer;
  private view: DataView;
  private _offset: number;
  private _littleEndian: boolean;

  constructor(initialCapacity = 4096, littleEndian = true) {
    this._buffer = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this._buffer);
    this._offset = 0;
    this._littleEndian = littleEndian;
  }

  /** Current write position. */
  get offset(): number {
    return this._offset;
  }

  /** Set the write position to an absolute offset. */
  seek(position: number): void {
    this._offset = position;
  }

  /** Advance the write position by `n` bytes (writes zeros). */
  skip(n: number): void {
    this.ensureCapacity(this._offset + n);
    this._offset += n;
  }

  /**
   * Return the written portion of the buffer as a new ArrayBuffer,
   * trimmed to the current offset.
   */
  finalize(): ArrayBuffer {
    return this._buffer.slice(0, this._offset);
  }

  /** Write an unsigned 8-bit integer and advance by 1. */
  writeUint8(value: number): void {
    this.ensureCapacity(this._offset + 1);
    this.view.setUint8(this._offset, value);
    this._offset += 1;
  }

  /** Write a signed 8-bit integer and advance by 1. */
  writeInt8(value: number): void {
    this.ensureCapacity(this._offset + 1);
    this.view.setInt8(this._offset, value);
    this._offset += 1;
  }

  /** Write an unsigned 16-bit integer and advance by 2. */
  writeUint16(value: number): void {
    this.ensureCapacity(this._offset + 2);
    this.view.setUint16(this._offset, value, this._littleEndian);
    this._offset += 2;
  }

  /** Write a signed 16-bit integer and advance by 2. */
  writeInt16(value: number): void {
    this.ensureCapacity(this._offset + 2);
    this.view.setInt16(this._offset, value, this._littleEndian);
    this._offset += 2;
  }

  /** Write an unsigned 32-bit integer and advance by 4. */
  writeUint32(value: number): void {
    this.ensureCapacity(this._offset + 4);
    this.view.setUint32(this._offset, value, this._littleEndian);
    this._offset += 4;
  }

  /** Write a signed 32-bit integer and advance by 4. */
  writeInt32(value: number): void {
    this.ensureCapacity(this._offset + 4);
    this.view.setInt32(this._offset, value, this._littleEndian);
    this._offset += 4;
  }

  /** Write an unsigned 64-bit integer as a BigInt and advance by 8. */
  writeUint64(value: bigint): void {
    this.ensureCapacity(this._offset + 8);
    this.view.setBigUint64(this._offset, value, this._littleEndian);
    this._offset += 8;
  }

  /** Write a 32-bit IEEE 754 float and advance by 4. */
  writeFloat32(value: number): void {
    this.ensureCapacity(this._offset + 4);
    this.view.setFloat32(this._offset, value, this._littleEndian);
    this._offset += 4;
  }

  /** Write a raw byte array and advance by its length. */
  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(this._offset + bytes.length);
    new Uint8Array(this._buffer).set(bytes, this._offset);
    this._offset += bytes.length;
  }

  /** Write a 4-byte ASCII magic string (e.g. `"mhbd"`) and advance by 4. */
  writeMagic(magic: string): void {
    for (let i = 0; i < 4; i++) {
      this.writeUint8(magic.charCodeAt(i));
    }
  }

  /**
   * Encode a JS string as UTF-16LE bytes, write them, and advance.
   * Returns the number of bytes written.
   */
  writeUtf16LE(str: string): number {
    const byteLen = str.length * 2;
    this.ensureCapacity(this._offset + byteLen);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      this.view.setUint8(this._offset, code & 0xff);
      this.view.setUint8(this._offset + 1, (code >> 8) & 0xff);
      this._offset += 2;
    }
    return byteLen;
  }

  /**
   * Encode a JS string as UTF-8 bytes, write them, and advance.
   * Returns the number of bytes written.
   */
  writeUtf8(str: string): number {
    const utf8 = unescape(encodeURIComponent(str));
    const bytes = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) {
      bytes[i] = utf8.charCodeAt(i);
    }
    this.writeBytes(bytes);
    return bytes.length;
  }

  /**
   * Write a uint32 at the given absolute offset without moving the
   * write cursor. Useful for back-patching size fields.
   */
  patchUint32(offset: number, value: number): void {
    this.ensureCapacity(offset + 4);
    this.view.setUint32(offset, value, this._littleEndian);
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this._buffer.byteLength) return;
    let newSize = this._buffer.byteLength;
    while (newSize < needed) newSize *= 2;
    const newBuf = new ArrayBuffer(newSize);
    new Uint8Array(newBuf).set(new Uint8Array(this._buffer));
    this._buffer = newBuf;
    this.view = new DataView(this._buffer);
  }
}
