import type { ItdbRawImage } from '../../artworkdb/artwork/types.js';

/**
 * Parameters for adding a song to an iPod database.
 */
export interface ItdbAddTrackParams {
  /**
   * Optional pre-assigned track id (from the library-wide id counter).
   * Apple draws trackIds and albumIds from one shared ascending sequence;
   * passing the counter's value keeps the id in that space and unique
   * across tracks AND albums.
   */
  trackId?: number;
  /**
   * Destination location on the iPod (e.g. `:iPod_Control:Music:F00:song.mp3`).
   * Optional — when omitted, a unique location (and file name) is generated
   * automatically; pass `fileName` to keep a specific file name.
   */
  ipodPath?: string;
  /**
   * Optional explicit file name (e.g. `"Closing Time.mp3"`). The music
   * directory is still chosen automatically. Ignored when `ipodPath` is set.
   */
  fileName?: string;
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
  year?: number;
  composer?: string;
  albumArtist?: string;
  /**
   * Override artwork image as RGBA pixel data.
   * When omitted the caller should extract album art from
   * the audio file's metadata before calling addTrack.
   */
  artworkOverride?: ItdbRawImage;
  /**
   * Raw bytes of the audio file. When provided (and no
   * `artworkOverride` is set), the instance-class `addTrack`
   * automatically extracts embedded album art from the audio
   * metadata and uses it. Ignored by the standalone function.
   */
  audioData?: Uint8Array;
}
