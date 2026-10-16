/**
 * Cross-runtime binary reader that wraps a DataView over an ArrayBuffer.
 * Works in browser, Node, and Tauri environments.
 *
 * All multi-byte reads default to **little-endian** to match the iPod
 * on-disk format.  Pass `bigEndian = true` for the rare big-endian
 * sections (smart-playlist rules, mobile-phone databases).
 */
export class ItdbBinaryReader {
  private view: DataView;
  private _offset: number;
  private _littleEndian: boolean;

  constructor(buffer: ArrayBuffer, offset = 0, littleEndian = true) {
    this.view = new DataView(buffer);
    this._offset = offset;
    this._littleEndian = littleEndian;
  }

  /** Current byte position in the buffer. */
  get offset(): number {
    return this._offset;
  }

  /** Total byte length of the underlying buffer. */
  get length(): number {
    return this.view.byteLength;
  }

  /** Number of bytes remaining from the current offset. */
  get remaining(): number {
    return this.view.byteLength - this._offset;
  }

  /** Advance the offset by `n` bytes without reading. */
  skip(n: number): void {
    this._offset += n;
  }

  /** Set the offset to an absolute position. */
  seek(position: number): void {
    this._offset = position;
  }

  /** Read an unsigned 8-bit integer and advance by 1. */
  readUint8(): number {
    const v = this.view.getUint8(this._offset);
    this._offset += 1;
    return v;
  }

  /** Read a signed 8-bit integer and advance by 1. */
  readInt8(): number {
    const v = this.view.getInt8(this._offset);
    this._offset += 1;
    return v;
  }

  /** Read an unsigned 16-bit integer and advance by 2. */
  readUint16(): number {
    const v = this.view.getUint16(this._offset, this._littleEndian);
    this._offset += 2;
    return v;
  }

  /** Read a signed 16-bit integer and advance by 2. */
  readInt16(): number {
    const v = this.view.getInt16(this._offset, this._littleEndian);
    this._offset += 2;
    return v;
  }

  /** Read an unsigned 32-bit integer and advance by 4. */
  readUint32(): number {
    const v = this.view.getUint32(this._offset, this._littleEndian);
    this._offset += 4;
    return v;
  }

  /** Read a signed 32-bit integer and advance by 4. */
  readInt32(): number {
    const v = this.view.getInt32(this._offset, this._littleEndian);
    this._offset += 4;
    return v;
  }

  /** Read an unsigned 64-bit integer as a BigInt and advance by 8. */
  readUint64(): bigint {
    const v = this.view.getBigUint64(this._offset, this._littleEndian);
    this._offset += 8;
    return v;
  }

  /** Read a 32-bit IEEE 754 float and advance by 4. */
  readFloat32(): number {
    const v = this.view.getFloat32(this._offset, this._littleEndian);
    this._offset += 4;
    return v;
  }

  /** Read `n` raw bytes into a new Uint8Array and advance by `n`. */
  readBytes(n: number): Uint8Array {
    const bytes = new Uint8Array(this.view.buffer, this._offset, n);
    const copy = new Uint8Array(n);
    copy.set(bytes);
    this._offset += n;
    return copy;
  }

  /**
   * Read a 4-byte ASCII magic string (e.g. `"mhbd"`) and advance by 4.
   * Returns the decoded string.
   */
  readMagic(): string {
    const bytes = this.readBytes(4);
    return String.fromCharCode(...bytes);
  }

  /**
   * Read a UTF-16LE encoded string of `byteLength` bytes and advance.
   * Returns the decoded JS string.
   */
  readUtf16LE(byteLength: number): string {
    const bytes = new Uint8Array(this.view.buffer, this._offset, byteLength);
    const codeUnits: number[] = [];
    for (let i = 0; i < byteLength; i += 2) {
      codeUnits.push(bytes[i] | (bytes[i + 1] << 8));
    }
    this._offset += byteLength;
    return String.fromCharCode(...codeUnits);
  }

  /**
   * Read a UTF-8 encoded string of `byteLength` bytes and advance.
   * Returns the decoded JS string.
   */
  readUtf8(byteLength: number): string {
    const bytes = this.readBytes(byteLength);
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return decodeURIComponent(escape(str));
  }

  /**
   * Create a sub-reader that shares the same underlying buffer but starts
   * at the given absolute offset.
   */
  subreader(offset: number, littleEndian?: boolean): ItdbBinaryReader {
    return new ItdbBinaryReader(
      this.view.buffer as ArrayBuffer,
      offset,
      littleEndian ?? this._littleEndian,
    );
  }
}
