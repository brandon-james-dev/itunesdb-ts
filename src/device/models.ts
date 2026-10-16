import type { ItdbGeneration, ItdbArtworkFormat } from './types.js';

interface ModelEntry {
  name: string;
  shortName: string;
  generation: ItdbGeneration;
  capacityGB: number;
  color?: string;
  artworkFormats: ItdbArtworkFormat[];
}

const NANO_1G_FORMATS: ItdbArtworkFormat[] = [
  { formatId: 1031, width: 42, height: 42, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1027, width: 100, height: 100, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
];

/**
 * Nano 2G shares the Nano 1G cover-art formats (libgpod
 * `ipod_nano_cover_art_info`: 1031@42 + 1027@100).
 */
const NANO_2G_FORMATS: ItdbArtworkFormat[] = [
  { formatId: 1031, width: 42, height: 42, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1027, width: 100, height: 100, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
];

/**
 * Nano 3G + Classic 1-3G (libgpod `ipod_classic_1_cover_art_info`:
 * 1061@56, 1055@128, 1068@128, 1060@320).
 */
const CLASSIC_FORMATS: ItdbArtworkFormat[] = [
  { formatId: 1061, width: 56, height: 56, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1055, width: 128, height: 128, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1068, width: 128, height: 128, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1060, width: 320, height: 320, pixelFormat: 'RGB565_LE', crop: false, padding: 0, rotation: 0 },
];

/**
 * Nano 4G (Apple Music / iTunes on-device ground truth: 1055@128,
 * 1078@80, 1071@240, 1074@50 — confirmed against an iTunes-synced iPod
 * nano 4G; libgpod's 6-format `ipod_nano4g_cover_art_info` is not what
 * iTunes writes for this device).
 */
const NANO_4G_FORMATS: ItdbArtworkFormat[] = [
  { formatId: 1055, width: 128, height: 128, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1078, width: 80, height: 80, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1071, width: 240, height: 240, pixelFormat: 'RGB565_LE', crop: false, padding: 0, rotation: 0 },
  { formatId: 1074, width: 50, height: 50, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
];

/**
 * Nano 5G (libgpod `ipod_nano5g_cover_art_info`: 1056@128, 1078@80,
 * 1073@240, 1074@50).
 */
const NANO_5G_FORMATS: ItdbArtworkFormat[] = [
  { formatId: 1056, width: 128, height: 128, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1078, width: 80, height: 80, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1073, width: 240, height: 240, pixelFormat: 'RGB565_LE', crop: false, padding: 0, rotation: 0 },
  { formatId: 1074, width: 50, height: 50, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
];

const VIDEO_FORMATS: ItdbArtworkFormat[] = [
  { formatId: 1028, width: 100, height: 100, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1029, width: 200, height: 200, pixelFormat: 'RGB565_LE', crop: false, padding: 0, rotation: 0 },
];

const PHOTO_FORMATS: ItdbArtworkFormat[] = [
  { formatId: 1009, width: 42, height: 30, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1015, width: 130, height: 88, pixelFormat: 'RGB565_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 1013, width: 220, height: 176, pixelFormat: 'RGB565_BE', crop: false, padding: 0, rotation: 90 },
  { formatId: 1019, width: 720, height: 480, pixelFormat: 'UYVY_BE', crop: false, padding: 0, rotation: 0 },
];

/**
 * Touch 1-3G + iPhone 1-3G (libgpod `ipod_touch_1_cover_art_info`).
 */
const TOUCH_FORMATS: ItdbArtworkFormat[] = [
  { formatId: 3001, width: 256, height: 256, pixelFormat: 'REC_RGB555_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 3002, width: 128, height: 128, pixelFormat: 'REC_RGB555_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 3003, width: 64, height: 64, pixelFormat: 'REC_RGB555_LE', crop: true, padding: 0, rotation: 0 },
  { formatId: 3005, width: 320, height: 320, pixelFormat: 'RGB555_LE', crop: false, padding: 0, rotation: 0 },
  { formatId: 3006, width: 56, height: 56, pixelFormat: 'RGB555_LE', crop: true, padding: 8192, rotation: 0 },
  { formatId: 3007, width: 88, height: 88, pixelFormat: 'RGB555_LE', crop: true, padding: 16384, rotation: 0 },
];

/**
 * Maps Apple model number prefixes (e.g. "MA446", "MB261") to
 * iPod model information and supported artwork formats.
 *
 * Source: libgpod itdb_device.c and Apple SysInfo documentation.
 */
export const IPOD_MODELS: Record<string, ModelEntry> = {
  'MA350': { name: 'iPod shuffle (1st generation)', shortName: 'Shuffle 1G', generation: 'SHUFFLE_1', capacityGB: 0.5, color: 'White', artworkFormats: [] },
  'MA564': { name: 'iPod shuffle (1st generation)', shortName: 'Shuffle 1G', generation: 'SHUFFLE_1', capacityGB: 1, color: 'White', artworkFormats: [] },
  'MB225': { name: 'iPod shuffle (2nd generation)', shortName: 'Shuffle 2G', generation: 'SHUFFLE_2', capacityGB: 1, color: 'Silver', artworkFormats: [] },
  'MB518': { name: 'iPod shuffle (3rd generation)', shortName: 'Shuffle 3G', generation: 'SHUFFLE_3', capacityGB: 4, color: 'Silver', artworkFormats: [] },
  'MC249': { name: 'iPod shuffle (4th generation)', shortName: 'Shuffle 4G', generation: 'SHUFFLE_4', capacityGB: 2, color: 'Silver', artworkFormats: [] },
  'MA004': { name: 'iPod mini (1st generation)', shortName: 'Mini 1G', generation: 'MINI_1', capacityGB: 4, color: 'Silver', artworkFormats: PHOTO_FORMATS },
  'MA005': { name: 'iPod mini (1st generation)', shortName: 'Mini 1G', generation: 'MINI_1', capacityGB: 4, color: 'Blue', artworkFormats: PHOTO_FORMATS },
  'MA006': { name: 'iPod mini (1st generation)', shortName: 'Mini 1G', generation: 'MINI_1', capacityGB: 4, color: 'Pink', artworkFormats: PHOTO_FORMATS },
  'MA007': { name: 'iPod mini (1st generation)', shortName: 'Mini 1G', generation: 'MINI_1', capacityGB: 4, color: 'Green', artworkFormats: PHOTO_FORMATS },
  'MA107': { name: 'iPod mini (2nd generation)', shortName: 'Mini 2G', generation: 'MINI_2', capacityGB: 4, color: 'Silver', artworkFormats: PHOTO_FORMATS },
  'MA428': { name: 'iPod mini (2nd generation)', shortName: 'Mini 2G', generation: 'MINI_2', capacityGB: 6, color: 'Silver', artworkFormats: PHOTO_FORMATS },
  'MA099': { name: 'iPod nano (1st generation)', shortName: 'Nano 1G', generation: 'NANO_1', capacityGB: 1, color: 'White', artworkFormats: NANO_1G_FORMATS },
  'MA005B': { name: 'iPod nano (1st generation)', shortName: 'Nano 1G', generation: 'NANO_1', capacityGB: 2, color: 'Black', artworkFormats: NANO_1G_FORMATS },
  'MA477': { name: 'iPod nano (2nd generation)', shortName: 'Nano 2G', generation: 'NANO_2', capacityGB: 2, color: 'Silver', artworkFormats: NANO_2G_FORMATS },
  'MA487': { name: 'iPod nano (2nd generation)', shortName: 'Nano 2G', generation: 'NANO_2', capacityGB: 4, color: 'Silver', artworkFormats: NANO_2G_FORMATS },
  'MA497': { name: 'iPod nano (2nd generation)', shortName: 'Nano 2G', generation: 'NANO_2', capacityGB: 8, color: 'Black', artworkFormats: NANO_2G_FORMATS },
  'MB261': { name: 'iPod nano (3rd generation)', shortName: 'Nano 3G', generation: 'NANO_3', capacityGB: 4, color: 'Silver', artworkFormats: CLASSIC_FORMATS },
  'MB253': { name: 'iPod nano (3rd generation)', shortName: 'Nano 3G', generation: 'NANO_3', capacityGB: 8, color: 'Silver', artworkFormats: CLASSIC_FORMATS },
  'MB598': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 8, color: 'Silver', artworkFormats: NANO_4G_FORMATS },
  'MB654': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 8, color: 'Black', artworkFormats: NANO_4G_FORMATS },
  'MB735': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 8, color: 'Purple', artworkFormats: NANO_4G_FORMATS },
  'MB742': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 8, color: 'Blue', artworkFormats: NANO_4G_FORMATS },
  'MB745': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 8, color: 'Green', artworkFormats: NANO_4G_FORMATS },
  'MB748': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 8, color: 'Orange', artworkFormats: NANO_4G_FORMATS },
  'MB754': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 8, color: 'Black', artworkFormats: NANO_4G_FORMATS },
  'MB903': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 16, color: 'Silver', artworkFormats: NANO_4G_FORMATS },
  'MB907': { name: 'iPod nano (4th generation)', shortName: 'Nano 4G', generation: 'NANO_4', capacityGB: 16, color: 'Black', artworkFormats: NANO_4G_FORMATS },
  'MC027': { name: 'iPod nano (5th generation)', shortName: 'Nano 5G', generation: 'NANO_5', capacityGB: 8, color: 'Silver', artworkFormats: NANO_5G_FORMATS },
  'MC031': { name: 'iPod nano (5th generation)', shortName: 'Nano 5G', generation: 'NANO_5', capacityGB: 8, color: 'Black', artworkFormats: NANO_5G_FORMATS },
  'MC040': { name: 'iPod nano (5th generation)', shortName: 'Nano 5G', generation: 'NANO_5', capacityGB: 8, color: 'Purple', artworkFormats: NANO_5G_FORMATS },
  'MC050': { name: 'iPod nano (5th generation)', shortName: 'Nano 5G', generation: 'NANO_5', capacityGB: 8, color: 'Blue', artworkFormats: NANO_5G_FORMATS },
  'MC060': { name: 'iPod nano (5th generation)', shortName: 'Nano 5G', generation: 'NANO_5', capacityGB: 8, color: 'Green', artworkFormats: NANO_5G_FORMATS },
  'MC062': { name: 'iPod nano (5th generation)', shortName: 'Nano 5G', generation: 'NANO_5', capacityGB: 8, color: 'Orange', artworkFormats: NANO_5G_FORMATS },
  'MC525': { name: 'iPod nano (6th generation)', shortName: 'Nano 6G', generation: 'NANO_6', capacityGB: 8, color: 'Silver', artworkFormats: NANO_5G_FORMATS },
  'MC688': { name: 'iPod nano (6th generation)', shortName: 'Nano 6G', generation: 'NANO_6', capacityGB: 8, color: 'Graphite', artworkFormats: NANO_5G_FORMATS },
  'MD480': { name: 'iPod nano (7th generation)', shortName: 'Nano 7G', generation: 'NANO_7', capacityGB: 16, color: 'Slate', artworkFormats: NANO_5G_FORMATS },
  'MD481': { name: 'iPod nano (7th generation)', shortName: 'Nano 7G', generation: 'NANO_7', capacityGB: 16, color: 'Silver', artworkFormats: NANO_5G_FORMATS },
  'MA002': { name: 'iPod photo', shortName: 'Photo', generation: 'PHOTO', capacityGB: 30, color: 'White', artworkFormats: PHOTO_FORMATS },
  'MA079': { name: 'iPod photo', shortName: 'Photo', generation: 'PHOTO', capacityGB: 60, color: 'White', artworkFormats: PHOTO_FORMATS },
  'MA446': { name: 'iPod (5th generation)', shortName: 'Video 5G', generation: 'VIDEO_1', capacityGB: 30, color: 'White', artworkFormats: VIDEO_FORMATS },
  'MA448': { name: 'iPod (5th generation)', shortName: 'Video 5G', generation: 'VIDEO_1', capacityGB: 60, color: 'White', artworkFormats: VIDEO_FORMATS },
  'MA450': { name: 'iPod (5th generation)', shortName: 'Video 5G', generation: 'VIDEO_1', capacityGB: 30, color: 'Black', artworkFormats: VIDEO_FORMATS },
  'MA444': { name: 'iPod (5th generation enhanced)', shortName: 'Video 5.5G', generation: 'VIDEO_2', capacityGB: 30, color: 'White', artworkFormats: VIDEO_FORMATS },
  'MA146': { name: 'iPod (5th generation enhanced)', shortName: 'Video 5.5G', generation: 'VIDEO_2', capacityGB: 80, color: 'Black', artworkFormats: VIDEO_FORMATS },
  'MB029': { name: 'iPod classic (1st generation)', shortName: 'Classic 1G', generation: 'CLASSIC_1', capacityGB: 80, color: 'Silver', artworkFormats: CLASSIC_FORMATS },
  'MB147': { name: 'iPod classic (1st generation)', shortName: 'Classic 1G', generation: 'CLASSIC_1', capacityGB: 160, color: 'Silver', artworkFormats: CLASSIC_FORMATS },
  'MB150': { name: 'iPod classic (1st generation)', shortName: 'Classic 1G', generation: 'CLASSIC_1', capacityGB: 160, color: 'Black', artworkFormats: CLASSIC_FORMATS },
  'MB562': { name: 'iPod classic (2nd generation)', shortName: 'Classic 2G', generation: 'CLASSIC_2', capacityGB: 120, color: 'Silver', artworkFormats: CLASSIC_FORMATS },
  'MC293': { name: 'iPod classic (3rd generation)', shortName: 'Classic 3G', generation: 'CLASSIC_3', capacityGB: 160, color: 'Silver', artworkFormats: CLASSIC_FORMATS },
  'MC297': { name: 'iPod classic (3rd generation)', shortName: 'Classic 3G', generation: 'CLASSIC_3', capacityGB: 160, color: 'Black', artworkFormats: CLASSIC_FORMATS },
  'MA627': { name: 'iPod touch (1st generation)', shortName: 'Touch 1G', generation: 'TOUCH_1', capacityGB: 8, artworkFormats: TOUCH_FORMATS },
  'MA623': { name: 'iPod touch (1st generation)', shortName: 'Touch 1G', generation: 'TOUCH_1', capacityGB: 16, artworkFormats: TOUCH_FORMATS },
  'MA625': { name: 'iPod touch (1st generation)', shortName: 'Touch 1G', generation: 'TOUCH_1', capacityGB: 32, artworkFormats: TOUCH_FORMATS },
  'MB528': { name: 'iPod touch (2nd generation)', shortName: 'Touch 2G', generation: 'TOUCH_2', capacityGB: 8, artworkFormats: TOUCH_FORMATS },
  'MB531': { name: 'iPod touch (2nd generation)', shortName: 'Touch 2G', generation: 'TOUCH_2', capacityGB: 16, artworkFormats: TOUCH_FORMATS },
  'MB533': { name: 'iPod touch (2nd generation)', shortName: 'Touch 2G', generation: 'TOUCH_2', capacityGB: 32, artworkFormats: TOUCH_FORMATS },
  'MC008': { name: 'iPod touch (3rd generation)', shortName: 'Touch 3G', generation: 'TOUCH_3', capacityGB: 32, artworkFormats: TOUCH_FORMATS },
  'MC011': { name: 'iPod touch (3rd generation)', shortName: 'Touch 3G', generation: 'TOUCH_3', capacityGB: 64, artworkFormats: TOUCH_FORMATS },
  'MC540': { name: 'iPod touch (4th generation)', shortName: 'Touch 4G', generation: 'TOUCH_4', capacityGB: 8, artworkFormats: TOUCH_FORMATS },
  'MC544': { name: 'iPod touch (4th generation)', shortName: 'Touch 4G', generation: 'TOUCH_4', capacityGB: 32, artworkFormats: TOUCH_FORMATS },
  'MC547': { name: 'iPod touch (4th generation)', shortName: 'Touch 4G', generation: 'TOUCH_4', capacityGB: 64, artworkFormats: TOUCH_FORMATS },
};
