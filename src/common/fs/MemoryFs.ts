import type { ItdbFileSystem } from './types.js';
import { FsNotFoundError, dirname, normalizePath } from './atomic.js';

/**
 * An {@link ItdbFileSystem} backed by a `Map`, mirroring the factory shape
 * of {@link createNodeFs} / {@link createBrowserFs}. Files are stored as
 * copies. Implements `remove` and `rename`, so transactional saves exercise
 * the atomic `*.tmp` → rename path.
 *
 * @param initial Optional initial files (`path → bytes`).
 */
export function createMemoryFs(
  initial?: Record<string, Uint8Array> | Map<string, Uint8Array>,
): ItdbFileSystem & { files: Map<string, Uint8Array>; dirs: Set<string> } {
  /** File contents keyed by normalised path. */
  const files = new Map<string, Uint8Array>();
  /** Known directories (normalised paths). */
  const dirs = new Set<string>(['/']);

  function addDirs(dir: string): void {
    let d = normalizePath(dir);
    while (!dirs.has(d)) {
      dirs.add(d);
      d = dirname(d);
    }
  }

  function writeSync(path: string, data: Uint8Array): void {
    const p = normalizePath(path);
    if (dirs.has(p)) throw new Error(`is a directory: ${p}`);
    addDirs(dirname(p));
    files.set(p, data.slice());
  }

  if (initial) {
    const entries = initial instanceof Map ? initial.entries() : Object.entries(initial);
    for (const [p, d] of entries) writeSync(p, d);
  }

  const fs: ItdbFileSystem = {
    async readFile(path: string): Promise<ArrayBuffer> {
      const d = files.get(normalizePath(path));
      if (!d) throw new FsNotFoundError(path);
      return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
    },

    async writeFile(path: string, data: ArrayBuffer): Promise<void> {
      writeSync(path, new Uint8Array(data));
    },

    async exists(path: string): Promise<boolean> {
      const p = normalizePath(path);
      return files.has(p) || dirs.has(p);
    },

    async list(dir: string): Promise<string[]> {
      const prefix = normalizePath(dir) === '/' ? '/' : normalizePath(dir) + '/';
      const names = new Set<string>();
      for (const p of files.keys()) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length);
          const name = rest.slice(0, rest.indexOf('/') === -1 ? rest.length : rest.indexOf('/'));
          if (name) names.add(name);
        }
      }
      // nodeFs lists directory entries too (including empty directories);
      // MemoryFs tracks known dirs, so surface the same view.
      for (const d of dirs) {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          const name = rest.slice(0, rest.indexOf('/') === -1 ? rest.length : rest.indexOf('/'));
          if (name) names.add(name);
        }
      }
      return [...names];
    },

    async mkdir(dir: string): Promise<void> {
      addDirs(dir);
    },

    /**
     * Matches nodeFs semantics: recursive removal of files and directories,
     * and no error when the path does not exist (nodeFs `rm(force: true)`).
     */
    async remove(path: string): Promise<void> {
      const p = normalizePath(path);
      if (dirs.has(p)) {
        // Recursive directory removal — remove every file and subdir under it.
        for (const fp of files.keys()) {
          if (fp === p || fp.startsWith(p + '/')) files.delete(fp);
        }
        for (const dp of [...dirs]) {
          if (dp === p || dp.startsWith(p + '/')) dirs.delete(dp);
        }
        dirs.add('/'); // the virtual root always exists
        return;
      }
      // force:true — a missing path is a silent no-op, not an error.
      files.delete(p);
    },

    async rename(from: string, to: string): Promise<void> {
      const f = normalizePath(from);
      const t = normalizePath(to);
      const data = files.get(f);
      if (!data) throw new FsNotFoundError(from);
      writeSync(t, data);
      files.delete(f);
    },
  };

  return Object.assign(fs, { files, dirs });
}
