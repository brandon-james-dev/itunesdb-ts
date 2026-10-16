/**
 * A file-system adapter that the sync engine uses to read/write files.
 *
 * Implementations are provided per-runtime (Node `fs`, browser
 * File System Access API, Tauri `fs` plugin). The sync engine itself
 * is runtime-agnostic.
 *
 * Paths are `/`-separated and rooted at the iPod mount point, e.g.
 * `iPod_Control/iTunes/iTunesDB` (a leading `/` is also accepted and
 * normalised away).
 */
export interface ItdbFileSystem {
  /** Read a file at the given path and return its contents as an ArrayBuffer. */
  readFile(path: string): Promise<ArrayBuffer>;
  /** Write an ArrayBuffer to the given path, creating parent directories as needed. */
  writeFile(path: string, data: ArrayBuffer): Promise<void>;
  /** Check whether a file or directory exists at the given path. */
  exists(path: string): Promise<boolean>;
  /** Create a directory (and parents) if it does not already exist. */
  mkdir(path: string): Promise<void>;
  /** Names (not paths) of the entries directly inside a directory. Optional; used for discovery, not for saving. */
  list?(dir: string): Promise<string[]>;
  /** Delete a file. Optional; if absent, removed tracks leave their audio files behind. */
  remove?(path: string): Promise<void>;
  /**
   * Move a file, replacing `to` if it exists. Optional; used by
   * transactional saves for atomic `*.tmp` → final renames. Without it,
   * saves fall back to write-tmp, overwrite-target, delete-tmp.
   */
  rename?(from: string, to: string): Promise<void>;
}
