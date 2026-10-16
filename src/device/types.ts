/**
 * Pixel format for artwork thumbnails stored in `.ithmb` files.
 */
export type ItdbPixelFormat =
  | 'RGB565_LE'
  | 'RGB565_BE'
  | 'RGB555_LE'
  | 'RGB555_BE'
  | 'REC_RGB555_LE'
  | 'RGB888_LE'
  | 'UYVY_LE'
  | 'UYVY_BE'
  | 'I420_LE';

/**
 * Describes one artwork format supported by a device.
 * Each format corresponds to a unique `.ithmb` file containing
 * thumbnails at that resolution and pixel encoding.
 */
export interface ItdbArtworkFormat {
  formatId: number;
  width: number;
  height: number;
  pixelFormat: ItdbPixelFormat;
  crop: boolean;
  padding: number;
  rotation: number;
}

/**
 * iPod model generation identifier.
 */
export type ItdbGeneration =
  | 'CLASSIC_1' | 'CLASSIC_2' | 'CLASSIC_3'
  | 'MINI_1' | 'MINI_2'
  | 'NANO_1' | 'NANO_2' | 'NANO_3' | 'NANO_4' | 'NANO_5' | 'NANO_6' | 'NANO_7'
  | 'PHOTO' | 'VIDEO_1' | 'VIDEO_2'
  | 'SHUFFLE_1' | 'SHUFFLE_2' | 'SHUFFLE_3' | 'SHUFFLE_4'
  | 'TOUCH_1' | 'TOUCH_2' | 'TOUCH_3' | 'TOUCH_4'
  | 'IPHONE_1' | 'IPHONE_2' | 'IPHONE_3'
  | 'MOBILE'
  | 'UNKNOWN';

/**
 * Information about a detected iPod device.
 */
export interface ItdbDeviceInfo {
  /** Model number string from SysInfo (e.g. "MA446"). */
  modelNumber: string;
  /** Human-readable device name (e.g. "iPod nano (4th generation)"). */
  name: string;
  /** Short name (e.g. "Nano 4G"). */
  shortName: string;
  /** Device generation identifier. */
  generation: ItdbGeneration;
  /** Storage capacity in GB. */
  capacityGB: number;
  /** Device color if known (e.g. "Silver", "Black", "Blue"). */
  color?: string;
  /** Artwork formats supported by this device. */
  artworkFormats: ItdbArtworkFormat[];
  /** FireWire GUID from SysInfo. */
  firewireGuid?: string;
  /** Serial number from SysInfo. */
  serialNumber?: string;
}
