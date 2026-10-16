import type { ItdbDeviceInfo, ItdbArtworkFormat } from './types.js';
import { IPOD_MODELS } from './models.js';

/**
 * USB product IDs reported by iPods when connected to a host.
 * Maps a device's `productId` (hex, e.g. `0x120f`) to the model-number
 * key of one of its entries in {@link IPOD_MODELS}.
 *
 * Sources: The Apple Wiki "USB Product IDs" (normal-mode PIDs) and the
 * canonical USB ID database. A product ID identifies the device
 * generation, so it resolves to a representative SKU of that
 * generation.
 */
export const IPOD_USB_PRODUCT_IDS: Record<string, string> = {
  '1204': 'MA002', // iPod Photo / color
  '1205': 'MA004', // iPod mini (1G/2G)
  '1209': 'MA446', // iPod with video (5th gen)
  '120A': 'MA099', // iPod nano (1st gen)
  '1260': 'MA477', // iPod nano (2nd gen)
  '1261': 'MB029', // iPod classic (6th gen)
  '1262': 'MB261', // iPod nano (3rd gen)
  '1263': 'MB598', // iPod nano (4th gen)
  '1265': 'MC027', // iPod nano (5th gen)
  '1266': 'MC525', // iPod nano (6th gen)
  '1267': 'MD480', // iPod nano (7th gen)
  '1300': 'MA350', // iPod shuffle (1st gen)
  '1301': 'MB225', // iPod shuffle (2nd gen)
};

function normalizeModelNumber(modelNumber: string): string {
  return modelNumber.trim().toUpperCase();
}

function looksLikeSysInfo(text: string): boolean {
  return /ModelNumStr\s*:|ModelNumber\s*:|<key>\s*(ModelNumStr|ModelNumber)/i.test(text);
}

/** Parse a USB product ID from a number or a 1–4 digit hex string. */
function parseUsbProductId(input: string | number): number | null {
  if (typeof input === 'number') return input;
  const hex = input.trim().match(/^(?:0x|0X)?([0-9a-fA-F]{1,4})$/);
  if (!hex) return null;
  const value = parseInt(hex[1], 16);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function lookupUsbProductId(pid: number): string {
  const pidKey = pid.toString(16).toUpperCase().padStart(4, '0');
  const model = IPOD_USB_PRODUCT_IDS[pidKey];
  if (!model) throw new Error(`Unknown iPod USB product ID: 0x${pidKey}`);
  return model;
}

/**
 * Detect an iPod device from a SysInfo/SysInfoExtended string, a model
 * number string (e.g. `"MB598"`), or a USB product ID (e.g. `0x1263`).
 *
 * - A SysInfo string is read for `ModelNumStr`/`ModelNumber` and used
 *   to look up the device (FireWire GUID / serial are carried over).
 * - A model number string is normalized (trimmed, upper-cased) and
 *   looked up directly in the model database.
 * - A USB product ID (as a number, or a hex string like `"0x1263"` /
 *   `"1263"`) is resolved to its device generation.
 *
 * @param input - The SysInfo text, model number, or USB product ID.
 * @returns An {@link ItdbDeviceInfo} object.
 * @throws If the input cannot be resolved to a known model.
 */
export function detectDevice(input: string | number): ItdbDeviceInfo {
  let modelNumber: string | undefined;
  let sysInfoText: string | null = null;

  if (typeof input === 'string') {
    if (looksLikeSysInfo(input)) {
      sysInfoText = input;
      modelNumber = extractValue(input, 'ModelNumStr') ?? extractValue(input, 'ModelNumber') ?? undefined;
      if (!modelNumber) throw new Error('No iPod model number found in the provided input');
    } else {
      const pid = parseUsbProductId(input);
      modelNumber = pid !== null ? lookupUsbProductId(pid) : normalizeModelNumber(input);
    }
  } else {
    modelNumber = lookupUsbProductId(input);
  }

  modelNumber = normalizeModelNumber(modelNumber);
  const entry = IPOD_MODELS[modelNumber];
  if (!entry) {
    throw new Error(`Unknown iPod model number: ${modelNumber}`);
  }

  return {
    modelNumber,
    name: entry.name,
    shortName: entry.shortName,
    generation: entry.generation,
    capacityGB: entry.capacityGB,
    color: entry.color,
    artworkFormats: entry.artworkFormats,
    firewireGuid: sysInfoText ? extractValue(sysInfoText, 'FireWireGUID') ?? undefined : undefined,
    serialNumber: sysInfoText ? extractValue(sysInfoText, 'SerialNumber') ?? undefined : undefined,
  };
}

/**
 * Look up artwork formats for a given model number string.
 *
 * Returns the list of {@link ItdbArtworkFormat} entries supported by
 * the device, which determines what thumbnail sizes and pixel
 * encodings to write into `.ithmb` files.
 *
 * @param modelNumber - The model number string (e.g. "MB598").
 * @returns Array of supported artwork formats, empty if model is unknown.
 */
export function getArtworkFormatsForModel(modelNumber: string): ItdbArtworkFormat[] {
  return IPOD_MODELS[normalizeModelNumber(modelNumber)]?.artworkFormats ?? [];
}

function extractValue(text: string, key: string): string | null {
  const regex = new RegExp(`${key}:\\s*(.+)`, 'i');
  const match = text.match(regex);
  if (match) return match[1].trim();
  const xmlRegex = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`, 'i');
  const xmlMatch = text.match(xmlRegex);
  return xmlMatch ? xmlMatch[1].trim() : null;
}
