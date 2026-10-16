/**
 * Seconds between the Mac epoch (1904-01-01) and the Unix epoch (1970-01-01).
 * Used for converting iPod timestamps to/from JS Date objects.
 */
export const MAC_EPOCH_OFFSET = 2082844800;

/** Convert a Mac timestamp (seconds since 1904) to a JS Date. */
export const macToDate = (macTime: number): Date => new Date((macTime - MAC_EPOCH_OFFSET) * 1000);

/** Convert a JS Date to a Mac timestamp (seconds since 1904). */
export const dateToMac = (date: Date): number => Math.floor(date.getTime() / 1000) + MAC_EPOCH_OFFSET;

/** iPod filesystem path separator (colon for HFS+/Mac layout). */
export const IPOD_PATH_SEPARATOR = ':';
