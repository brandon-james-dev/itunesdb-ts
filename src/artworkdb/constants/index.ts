/** Magic identifiers for ArtworkDB record types. */
export const ARTWORKDB_MAGIC = {
  MHFD: 'mhfd',
  MHSD: 'mhsd',
  MHLI: 'mhli',
  MHII: 'mhii',
  MHOD: 'mhod',
  MHNI: 'mhni',
  MHLF: 'mhlf',
  MHIF: 'mhif',
  MHLA: 'mhla',
  MHBA: 'mhba',
  MHIA: 'mhia',
} as const;

/** Default header sizes for ArtworkDB record types (in bytes). */
export const ARTWORKDB_HEADER_SIZES = {
  MHFD: 132,
  MHSD: 96,
  MHLI: 92,
  MHII: 52,
  MHOD: 24,
  MHNI: 76,
  MHLF: 92,
  MHIF: 124,
  MHLA: 92,
  MHBA: 100,
  MHIA: 40,
} as const;

/** Location of the ArtworkDB file relative to the device root directory. */
export const ARTWORKDB_FILE_RELATIVE_PATH = 'iPod_Control/Artwork/ArtworkDB';
