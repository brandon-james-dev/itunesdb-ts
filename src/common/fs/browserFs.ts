import type { ItdbFileSystem } from './types.js';

async function getDirHandle(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(p => p.length > 0);
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function getFileHandle(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<FileSystemFileHandle> {
  const parts = path.split('/').filter(p => p.length > 0);
  const dir = await getDirHandle(root, parts.slice(0, -1).join('/'), create);
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

/**
 * Wrap a File System Access API directory handle (browser) as an
 * {@link ItdbFileSystem}, resolving `/`-separated paths relative
 * to the given root directory.
 *
 * The browser cannot atomically replace an existing file: there is no
 * `rename` here, so {@link atomicWrite} writes the final target directly
 * (after staging the bytes in a `.tmp` file) and removes the staging file
 * when {@link FileSystemFileHandle.remove} is supported (Chromium 122+).
 * This is the intended browser mode — `FileSystemFileHandle.move` cannot
 * overwrite an existing destination and is not permitted in this context,
 * so it is deliberately not used for commits. Corruption protection comes
 * from the pre-write `.bak` backups and the self-validation in `Itdb.save`.
 */
export function createBrowserFs(root: FileSystemDirectoryHandle): ItdbFileSystem {
  const proto = typeof FileSystemFileHandle !== 'undefined' ? FileSystemFileHandle.prototype : undefined;
  const removeFile = (proto as unknown as { remove?: unknown })?.remove;
  return {
    async readFile(path: string): Promise<ArrayBuffer> {
      const handle = await getFileHandle(root, path, false);
      const file = await handle.getFile();
      return file.arrayBuffer();
    },
    async writeFile(path: string, data: ArrayBuffer): Promise<void> {
      const handle = await getFileHandle(root, path, true);
      const writable = await handle.createWritable();
      try {
        await writable.write(data);
      } finally {
        await writable.close();
      }
    },
    async exists(path: string): Promise<boolean> {
      try {
        const handle = await getFileHandle(root, path, false);
        await handle.getFile();
        return true;
      } catch {
        // A missing parent directory or a missing file both mean "not present".
        return false;
      }
    },
    async mkdir(path: string): Promise<void> {
      await getDirHandle(root, path, true);
    },
    async remove(path: string): Promise<void> {
      if (typeof removeFile !== 'function') return Promise.reject(new Error('remove is not supported by this browser'));
      const handle = await getFileHandle(root, path, false);
      await (handle as FileSystemFileHandle & { remove: () => Promise<void> }).remove();
    },
  };
}
