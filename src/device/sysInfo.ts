/**
 * Read the iPod's on-device `SysInfo` files through an {@link ItdbFileSystem}.
 *
 * The device keeps its identity here: `ModelNumStr`/`ModelNumber` identify
 * the model, while `FireWireGUID` is the device-unique key used by the
 * iTunesDB hash58 checksum (and `SerialNumber` is the friendly identifier).
 * libgpod reads the same files when opening an iPod.
 */
import type { ItdbFileSystem } from '../common/fs/types.js';
import { normalizePath } from '../common/fs/atomic.js';

/** The on-device device-information directory (also used by libgpod's itdb). */
export const SYSTEM_DIR = '/iPod_Control/Device';

export interface ItdbSysInfo {
  /** Model number string (e.g. "MB598"). */
  modelNumber?: string;
  /** FireWire GUID (hex string). */
  firewireGuid?: string;
  /** Serial number from SysInfo. */
  serialNumber?: string;
}

function extractValue(text: string, key: string): string | null {
  const regex = new RegExp(`${key}\\s*:\\s*(.+)`, 'i');
  const match = text.match(regex);
  if (match) return match[1].trim();
  const xmlRegex = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`, 'i');
  const xmlMatch = text.match(xmlRegex);
  return xmlMatch ? xmlMatch[1].trim() : null;
}

/** Strip the leading `/` for filesystem calls, like Itdb's `fsPath`. */
function devicePath(path: string): string {
  return normalizePath(path).slice(1);
}

/**
 * Best-effort read of `SysInfo` (and `SysInfoExtended`) via `fs`.
 * Returns `null` when the files don't exist or can't be read.
 */
export async function readSysInfo(fs: ItdbFileSystem): Promise<ItdbSysInfo | null> {
  const info: ItdbSysInfo = {};
  try {
    const sysPath = devicePath(`${SYSTEM_DIR}/SysInfo`);
    if (await fs.exists(sysPath)) {
      const raw = new Uint8Array(await fs.readFile(sysPath));
      const text = new TextDecoder('utf-8').decode(raw);
      info.modelNumber =
        extractValue(text, 'ModelNumStr') ??
        extractValue(text, 'ModelNumber') ??
        undefined;
      info.firewireGuid = extractValue(text, 'FireWireGUID') ?? undefined;
      info.serialNumber = extractValue(text, 'SerialNumber') ?? undefined;
      return info;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * One-time iPod setup: write (or refresh) `FirewireGuid` and `ModelNumStr`
 * into the on-device `iPod_Control/Device/SysInfo` file, mirroring the
 * "one-time setup" step of tools like tunesreloaded (which is required
 * before an encrypted iPod — Classic 6G+, Nano 3G+ — will accept a
 * checksum-written iTunesDB; the FireWire GUID is the hash58 key).
 *
 * The FireWire GUID is the device's USB serial number: tunesreloaded writes
 * `FirewireGuid: 0x${serialNumber}` straight into SysInfo.
 *
 * Existing `FirewireGuid`/`ModelNumStr` lines are replaced in place; any
 * other lines (e.g. `SerialNumber`) are preserved. The directory is created
 * if it doesn't exist yet (all {@link ItdbFileSystem} adapters create parent
 * directories on write).
 *
 * @param fs The mounted iPod's file system.
 * @param firewireGuid The device FireWire GUID / USB serial number (with or
 *   without a leading `0x` — normalized before writing).
 * @param modelNumStr Optional model number string (e.g. "MB754"). When
 *   omitted, any existing `ModelNumStr` line is left untouched.
 * @returns The newly written `SysInfo` content.
 * @throws If the write fails (read-only fs, permission denied, ...).
 */
export async function writeSysInfo(
  fs: ItdbFileSystem,
  firewireGuid: string,
  modelNumStr?: string,
): Promise<string> {
  const sysPath = devicePath(`${SYSTEM_DIR}/SysInfo`);
  let text = '';
  if (await fs.exists(sysPath)) {
    const raw = new Uint8Array(await fs.readFile(sysPath));
    text = new TextDecoder('utf-8').decode(raw);
  }
  if (text.length > 0 && !text.endsWith('\n')) text += '\n';

  const kept: string[] = [];
  let existingModel = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/^FirewireGuid\s*:/i.test(trimmed)) continue;
    if (/^ModelNumStr\s*:/i.test(trimmed)) {
      existingModel = trimmed.slice(trimmed.indexOf(':') + 1).trim();
      continue;
    }
    kept.push(trimmed);
  }

  const lines: string[] = [...kept];

  // Normalize the GUID: strip a leading "0x"/"0X" — tunesreloaded writes
  // `0x<serial>`, libgpod stores the bare hex; the hash58 key uses bare hex.
  const hex = firewireGuid.trim().replace(/^0x/i, '');
  if (hex) lines.push(`FirewireGuid: 0x${hex}`);

  const model = modelNumStr?.trim() || existingModel;
  if (model) lines.push(`ModelNumStr: ${model}`);

  const content = lines.join('\n') + '\n';
  const encoder = new TextEncoder();
  await fs.writeFile(sysPath, encoder.encode(content).buffer);
  return content;
}
