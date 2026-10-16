/**
 * iTunesDB checksum types, ported from libgpod's
 * `itdb_device_get_checksum_type()` (src/itdb_device.c).
 *
 * The iPod firmware for newer generations verifies the iTunesDB at boot
 * with a device-keyed checksum stored in the mhbd header. Writing a DB
 * without the correct checksum for these devices makes them reject (or
 * rebuild) the library — the failure mode behind "corrupted" iPods.
 */
import type { ItdbDeviceInfo, ItdbGeneration } from '../../device/types.js';

/** Which checksum a device generation requires (libgpod's ItdbChecksumType). */
export type ItdbChecksumType = 'none' | 'hash58' | 'hash72' | 'hashAB';

/**
 * Map a device generation to its required iTunesDB checksum, exactly as
 * libgpod's `itdb_device_get_checksum_type` does (generation fallback).
 */
export function checksumTypeForGeneration(generation: ItdbGeneration): ItdbChecksumType {
  switch (generation) {
    case 'CLASSIC_1':
    case 'CLASSIC_2':
    case 'CLASSIC_3':
    case 'NANO_3':
    case 'NANO_4':
      return 'hash58';
    case 'NANO_5':
    case 'TOUCH_1':
    case 'TOUCH_2':
    case 'TOUCH_3':
    case 'IPHONE_1':
    case 'IPHONE_2':
    case 'IPHONE_3':
      return 'hash72';
    case 'TOUCH_4':
    case 'NANO_6':
      return 'hashAB';
    default:
      // FIRST..FOURTH, PHOTO, MINI_1/2, SHUFFLE_1..4, VIDEO_1/2,
      // NANO_1/2, MOBILE, UNKNOWN — no checksum required.
      return 'none';
  }
}

/**
 * Checksum type for a device. A missing/unknown device falls back to
 * `'none'` (matching libgpod's NULL-device behavior) — so databases
 * written without device detection remain compatible with legacy iPods.
 */
export function checksumTypeForDevice(device?: ItdbDeviceInfo | null): ItdbChecksumType {
  if (!device) return 'none';
  return checksumTypeForGeneration(device.generation);
}
