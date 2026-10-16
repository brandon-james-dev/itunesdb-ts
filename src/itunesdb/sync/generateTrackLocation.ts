import type { ItdbTrack } from '../track/types.js';

/** Number of `F00`..`Fnn` music folders to spread tracks over. */
export const MUSIC_FOLDER_COUNT = 20;

/** iPod music location prefix (`:iPod_Control:Music:`). */
export const MUSIC_LOCATION_PREFIX = ':iPod_Control:Music:';

/**
 * Detect the audio file extension from magic bytes.
 * Returns `.m4a`, `.mp3`, `.wav`, `.aif`, or `undefined` when unknown.
 */
export function sniffAudio(data: Uint8Array): string | undefined {
  const s = (o: number, n: number) => String.fromCharCode(...data.subarray(o, o + n));
  if (data.length >= 12 && s(4, 4) === 'ftyp') return '.m4a';
  if (data.length >= 3 && s(0, 3) === 'ID3') return '.mp3';
  if (data.length >= 2 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) return '.mp3';
  if (data.length >= 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return '.wav';
  if (data.length >= 12 && s(0, 4) === 'FORM') return '.aif';
  return undefined;
}

/** Map an audio location to the iPod file-type fourcc. */
export function detectFiletype(location: string): number {
  const lower = location.toLowerCase();
  if (lower.endsWith('.mp3')) return 0x4D503320;
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 0x4D344120;
  if (lower.endsWith('.wav')) return 0x57415620;
  if (lower.endsWith('.aiff') || lower.endsWith('.aif')) return 0x41494646;
  return 0x4D503320;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/[. ]+$/g, '').trim();
  return cleaned || 'Track';
}

/**
 * Generate a unique iPod track location (e.g. `:iPod_Control:Music:F03:Song.mp3`).
 *
 * The directory (`F00`..`F19`) and, when no explicit file name is given,
 * the file name itself are generated automatically. Uniqueness is checked
 * against the locations already used by `existing` tracks.
 *
 * @param existing  - Tracks already in the database (for uniqueness).
 * @param audioData - Optional audio bytes; used to sniff the extension.
 * @param fileName  - Optional explicit file name (extension optional).
 * @returns A location string for the new track.
 */
export function generateTrackLocation(existing: readonly ItdbTrack[], audioData?: Uint8Array, fileName?: string): string {
  const used = new Set<string>();
  for (const t of existing) if (t.path) used.add(t.path.toUpperCase());

  const hasExt = fileName !== undefined && /\.[A-Za-z0-9]{1,5}$/.test(fileName);
  const ext = hasExt ? '' : (audioData ? sniffAudio(audioData) : undefined) ?? '.mp3';
  const base = sanitizeFileName(fileName ?? `Track${existing.length + 1}`);
  const folder = `F${String(existing.length % MUSIC_FOLDER_COUNT).padStart(2, '0')}`;

  const candidate = (n: number) => {
    const name = n === 0 ? base : `${base}_${n}`;
    return `${MUSIC_LOCATION_PREFIX}${folder}:${name}${ext}`;
  };

  for (let n = 0; n < 1000; n++) {
    const loc = candidate(n);
    if (!used.has(loc.toUpperCase())) return loc;
  }
  return candidate(Date.now() % 1000);
}
