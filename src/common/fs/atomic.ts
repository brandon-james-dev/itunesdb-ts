import type { ItdbFileSystem } from './types.js';

/**
 * Normalise an iPod path: forward slashes, single leading `/`, no trailing
 * slash, no empty or `.` segments. Rejects `..` segments.
 */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new Error(`path traversal not allowed: ${path}`);
    parts.push(seg);
  }
  return '/' + parts.join('/');
}

/** Parent directory of a normalised path (`/` for top-level entries). */
export function dirname(path: string): string {
  const p = normalizePath(path);
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/** Error raised by filesystem implementations for a missing path. */
export class FsNotFoundError extends Error {
  /** POSIX-style error code. */
  readonly code = 'ENOENT';

  /** @param path The path that was not found. */
  constructor(path: string) {
    super(`no such file or directory: ${path}`);
    this.name = 'FsNotFoundError';
  }
}

/** A file written to `<path>.tmp` that still has to be moved into place. */
export interface TmpFile {
  tmp: string;
  path: string;
  data: Uint8Array;
}

/**
 * Write `data` to `path` as safely as the filesystem allows: the bytes are
 * first written to `path + '.tmp'`, then moved over the target with
 * `fs.rename` when available. Otherwise the target is overwritten directly
 * and the temporary file removed (if `fs.remove` exists).
 *
 * @param fs Target filesystem.
 * @param path Final file path.
 * @param data File contents.
 */
export async function atomicWrite(fs: ItdbFileSystem, path: string, data: Uint8Array): Promise<void> {
  const tmp = path + '.tmp';
  await fs.writeFile(tmp, toArrayBuffer(data));
  await commitTmp(fs, tmp, path, data);
}

/**
 * Second half of {@link atomicWrite}: move an already-written temporary file
 * into place.
 *
 * @param fs Target filesystem.
 * @param tmp Path of the temporary file.
 * @param path Final path.
 * @param data Same bytes as in `tmp`; used when `fs.rename` is unavailable.
 */
export async function commitTmp(fs: ItdbFileSystem, tmp: string, path: string, data: Uint8Array): Promise<void> {
  if (fs.rename) {
    await fs.rename(tmp, path);
    return;
  }
  await fs.writeFile(path, toArrayBuffer(data));
  if (fs.remove) {
    try {
      if (await fs.exists(tmp)) await fs.remove(tmp);
    } catch {
      // Best effort: a leftover staging file is harmless.
    }
  }
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
