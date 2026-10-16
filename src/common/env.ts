import type { ItdbFileSystem } from './fs/types.js';
import type { ItdbImageDecoder } from '../artworkdb/artwork/decodeImage.js';
import { createBrowserImageDecoder } from '../artworkdb/artwork/browserDecoder.js';
import { createNodeImageDecoder } from '../artworkdb/artwork/nodeDecoder.js';

/** Runtime environments the library can automatically adapt to. */
export type ItdbRuntime = 'node' | 'browser' | 'tauri' | 'unknown';

/**
 * Detect the current runtime without importing any runtime-specific module.
 *
 * Order matters: `process.versions.node` covers Node (and Node-with-Tauri),
 * `__TAURI_INTERNALS__` covers Tauri webviews, and `window`/`self` covers
 * browsers (including workers).
 */
export function detectRuntime(): ItdbRuntime {
  if (typeof process !== 'undefined' && typeof process.versions?.node === 'string') return 'node';
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return 'tauri';
  if (typeof window !== 'undefined' || typeof self !== 'undefined') return 'browser';
  return 'unknown';
}

/**
 * Scan the common platform mount directories for a mounted iPod volume
 * (one that contains `iPod_Control/iTunes/iTunesDB`). Node only.
 *
 * Checks, in order: `/Volumes/*` (macOS), `/media/*`, `/run/media/*`
 * (Linux), `/mnt/*`. Returns the first match or `undefined`.
 */
export async function findIpodRoot(): Promise<string | undefined> {
  if (detectRuntime() !== 'node') return undefined;
  const { readdir, access } = await import('node:fs/promises');
  const hasDatabase = async (dir: string): Promise<boolean> => {
    try {
      await access(`${dir}/iPod_Control/iTunes/iTunesDB`);
      return true;
    } catch {
      return false;
    }
  };
  for (const base of ['/Volumes', '/media', '/run/media', '/mnt']) {
    let names: string[];
    try {
      names = await readdir(base);
    } catch {
      continue;
    }
    for (const name of names.filter(n => !n.startsWith('.'))) {
      const dir = `${base}/${name}`;
      if (await hasDatabase(dir)) return dir;
    }
  }
  return undefined;
}

/**
 * Create the appropriate {@link ItdbFileSystem} for the current runtime,
 * without requiring the developer to wire one up:
 *
 * - **Node** — a `createNodeFs` rooted at the first auto-detected iPod
 *   mount (see {@link findIpodRoot}), falling back to the working directory.
 * - **Browser** — prompts the user with `showDirectoryPicker()` to select
 *   the iPod volume (File System Access API).
 * - **Tauri** — cannot be auto-wired (the webview has no mount info); a
 *   helpful error asks for an explicit adapter.
 *
 * @throws If no file system can be inferred for this runtime.
 */
export async function createDefaultFs(): Promise<ItdbFileSystem> {
  const runtime = detectRuntime();
  switch (runtime) {
    case 'node': {
      const { createNodeFs } = await import('./fs/nodeFs.js');
      return createNodeFs((await findIpodRoot()) ?? process.cwd());
    }
    case 'browser': {
      const picker = (window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      if (typeof picker === 'function') {
        const { createBrowserFs } = await import('./fs/browserFs.js');
        return createBrowserFs(await picker.call(window));
      }
      throw new Error(
        'Browser: showDirectoryPicker() is not available (needs a secure context, https or localhost).\n' +
        'Pass an ItdbFileSystem explicitly or use createBrowserFs(handle) with your own picker.',
      );
    }
    case 'tauri':
      throw new Error(
        'Tauri: there is no auto-detectable iPod mount in the webview.\n' +
        'Pass an ItdbFileSystem explicitly (e.g. wrap @tauri-apps/plugin-fs) — see the README example.',
      );
    default:
      throw new Error('Could not infer the runtime file system; pass an ItdbFileSystem explicitly.');
  }
}

/**
 * Create the appropriate {@link ItdbImageDecoder} for the current runtime:
 *
 * - **Browser / Tauri webview** — the built-in `createImageBitmap` +
 *   `OffscreenCanvas` decoder (covers JPEG, PNG, WebP, GIF, ...).
 * - **Node** — the `sharp`-based decoder (`sharp` is imported lazily on
 *   first decode; install it with `npm install sharp`).
 *
 * @throws If no decoder can be inferred for this runtime.
 */
export function createDefaultImageDecoder(): ItdbImageDecoder {
  if (typeof createImageBitmap === 'function') {
    return createBrowserImageDecoder();
  }
  if (detectRuntime() === 'node') {
    return createNodeImageDecoder();
  }
  throw new Error('Could not infer an image decoder for this runtime; pass `imageDecoder` explicitly.');
}
