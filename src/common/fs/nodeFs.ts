import type { ItdbFileSystem } from './types.js';

/**
 * Wrap a root directory (Node.js) as an {@link ItdbFileSystem},
 * resolving `/`-separated paths relative to the given root.
 *
 * Implements `list`/`remove`/`rename` so transactional saves
 * (`commitTmp`) and pending-track deletions work.
 *
 * The `node:*` builtins are loaded lazily, per adapter, via dynamic
 * `import()` — never at module load. That keeps this module safe to
 * import from a browser bundle (e.g. through the package barrel),
 * where bundlers externalize `node:fs/promises` and throw at the top
 * of a module that statically imports it (Vite error: "Module
 * node:fs/promises has been externalized for browser compatibility").
 * The dynamic import is only ever evaluated in a real Node runtime,
 * so browser consumers of `Itdb` / `createBrowserFs` never touch it.
 *
 * @param root Absolute path of the iPod mount (or any directory).
 */
export function createNodeFs(root: string): ItdbFileSystem {
  const fsPromisesP = import('node:fs/promises');
  const nodeFsP = import('node:fs');
  const nodePathP = import('node:path');

  const resolvePath = async (path: string): Promise<string> => {
    const { join } = await nodePathP;
    return join(root, path);
  };

  return {
    async readFile(path: string): Promise<ArrayBuffer> {
      const { readFile } = await fsPromisesP;
      const buf = await readFile(await resolvePath(path));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    async writeFile(path: string, data: ArrayBuffer): Promise<void> {
      const [full, { mkdir, writeFile }, { dirname }] = await Promise.all([resolvePath(path), fsPromisesP, nodePathP]);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, Buffer.from(data));
    },
    async exists(path: string): Promise<boolean> {
      const [full, { promises }] = await Promise.all([resolvePath(path), nodeFsP]);
      try {
        await promises.access(full);
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(path: string): Promise<void> {
      const [full, { mkdir }] = await Promise.all([resolvePath(path), fsPromisesP]);
      await mkdir(full, { recursive: true });
    },
    async list(path: string): Promise<string[]> {
      const [full, { promises }] = await Promise.all([resolvePath(path), nodeFsP]);
      const entries = await promises.readdir(full, { withFileTypes: true });
      return entries.map(e => e.name);
    },
    async remove(path: string): Promise<void> {
      const [full, { rm }] = await Promise.all([resolvePath(path), fsPromisesP]);
      await rm(full, { force: true, recursive: true });
    },
    async rename(from: string, to: string): Promise<void> {
      const [source, target, fsPromises, nodePath] = await Promise.all([resolvePath(from), resolvePath(to), fsPromisesP, nodePathP]);
      await fsPromises.mkdir(nodePath.dirname(target), { recursive: true });
      await fsPromises.rename(source, target);
    },
  };
}
