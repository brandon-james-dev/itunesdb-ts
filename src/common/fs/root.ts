import type { ItdbFileSystem } from './types.js';
import { createBrowserFs } from './browserFs.js';

/**
 * A root directory handle for the mounted iPod volume, in one of two forms:
 * - `{ fs, rootPath? }` — a runtime-specific {@link ItdbFileSystem} adapter
 *   (Node `fs/promises`, Tauri plugin-fs, ...) plus an optional root path
 *   within it (`''` or omitted = the adapter's own root).
 * - `{ directoryHandle }` — a browser File System Access API directory
 *   handle (e.g. from `showDirectoryPicker()`), wrapped automatically.
 */
export type ItdbRootHandle =
  | { fs: ItdbFileSystem; rootPath?: string }
  | { directoryHandle: FileSystemDirectoryHandle };

export interface ItdbResolvedRoot {
  fs: ItdbFileSystem;
  rootPath: string;
}

export function resolveRoot(root: ItdbRootHandle): ItdbResolvedRoot {
  if ('directoryHandle' in root) {
    return { fs: createBrowserFs(root.directoryHandle), rootPath: '' };
  }
  return { fs: root.fs, rootPath: root.rootPath ?? '' };
}

export function joinRootPath(rootPath: string, relative: string): string {
  if (!rootPath) return relative;
  const sep = rootPath.endsWith('/') ? '' : '/';
  return `${rootPath}${sep}${relative}`;
}
