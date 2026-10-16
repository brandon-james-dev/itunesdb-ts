/** Magic identifiers for iTunesDB record types. */
export const ITUNESDB_MAGIC = {
  MHBD: 'mhbd',
  MHSD: 'mhsd',
  MHLT: 'mhlt',
  MHIT: 'mhit',
  MHOD: 'mhod',
  MHLP: 'mhlp',
  MHYP: 'mhyp',
  MHIP: 'mhip',
  MHLA: 'mhla',
  MHIA: 'mhia',
} as const;

/**
 * MHOD type identifiers for iTunesDB string/data objects.
 * Values 1–31 are UTF-16LE (or UTF-8) string types.
 */
export const MhodType = {
  TITLE:               1,
  PATH:                2,
  ALBUM:               3,
  ARTIST:              4,
  GENRE:               5,
  FILETYPE:            6,
  COMMENT:             8,
  CATEGORY:            9,
  COMPOSER:           12,
  GROUPING:           13,
  DESCRIPTION:        14,
  PODCAST_URL:        15,
  PODCAST_RSS:        16,
  THMB:               18,
  TV_SHOW:            19,
  TV_EPISODE:         20,
  TV_NETWORK:         21,
  ALBUM_ARTIST:       22,
  SORT_ARTIST:        23,
  KEYWORDS:           24,
  SORT_TITLE:         27,
  SORT_ALBUM:         28,
  SORT_ALBUM_ARTIST:  29,
  SORT_COMPOSER:      30,
  SORT_TV_SHOW:       31,
  SMART_PLAYLIST_PREF:  50,
  SMART_PLAYLIST_RULES: 51,
  LIBRARY_PLAYLIST_IDX: 52,
  LIBRARY_PLAYLIST_JUMP: 53,
  PLAYLIST:           100,
  ALBUM_ALBUM:        200,
  ALBUM_ARTIST_NAME:  201,
  ALBUM_SORT_ARTIST:  202,
  ALBUM_ARTIST_MHII:  300,
} as const;

/** Default header sizes for iTunesDB record types (in bytes). */
export const ITUNESDB_HEADER_SIZES = {
  MHBD: 244,
  MHSD: 96,
  MHLT: 92,
  MHIT: 624,
  MHOD: 24,
  MHLP: 92,
  MHYP: 184,
  MHIP: 76,
  MHLA: 92,
  MHIA: 88,
} as const;

/** Default iTunesDB version to write (iTunes 7.4 = 0x19). */
export const DEFAULT_DB_VERSION = 0x19;

/** Location of the iTunesDB file relative to the device root directory. */
export const ITUNESDB_FILE_RELATIVE_PATH = 'iPod_Control/iTunes/iTunesDB';

/** MHOD type IDs that represent simple strings (1–31 range). */
export const isStringMhodType = (type: number): boolean => type >= 1 && type <= 31 && type !== 7 && type !== 10 && type !== 11 && type !== 18;

/** MHOD type IDs for podcast URLs that use raw UTF-8 (no sub-header). */
export const isPodcastMhodType = (type: number): boolean => type === 15 || type === 16;
