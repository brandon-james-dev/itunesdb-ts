/**
 * Infer per-track audio fields from the raw audio bytes when the caller does
 * not supply them (libgpod does exactly this when adding a track from a
 * file). The firmware and Apple's parser both expect these fields populated —
 * tracks with length/bitrate/sampleRate left at 0 read corrupt to Apple's
 * tools. Kept deliberately small: MP3 frame-header parsing only; everything
 * else falls through to existing defaults.
 *
 * @param data  The audio file bytes.
 * @returns     Partial track metadata to merge into the record.
 */
export function inferTrackMeta(data: Uint8Array): Partial<{
  length: number;
  bitrate: number;
  sampleRate: number;
  fileTypeString: string;
}> {
  if (!data || data.length < 4) return {};

  // ID3v2 tag at the start? Skip it so frame scanning starts at audio data.
  let offset = 0;
  if (
    data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33 // "ID3"
  ) {
    const size =
      ((data[6]! & 0x7f) << 21) |
      ((data[7]! & 0x7f) << 14) |
      ((data[8]! & 0x7f) << 7) |
      (data[9]! & 0x7f);
    offset = 10 + size;
  }

  // MPEG audio frame header (sync word 0xFF E*). Parse the first frame we
  // find to get bitrate/sample-rate and scan for the last frame offset to
  // estimate duration — the same fields libgpod fills from the decoded file.
  let frameOffset = -1;
  for (let i = offset; i + 4 <= data.length; i++) {
    if (data[i] === 0xff && (data[i + 1]! & 0xe0) === 0xe0) {
      const version = (data[i + 1]! >> 3) & 0x03;
      const layer = (data[i + 1]! >> 1) & 0x03;
      // Version bits: 3=MPEG1, 2=MPEG2, 0=2.5; 1 is reserved.
      if (version !== 1 && layer !== 0) { frameOffset = i; break; }
    }
  }
  if (frameOffset < 0) return {};
  const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const sampleTable = [44100, 48000, 32000, 0];
  const b1 = data[frameOffset + 2]!;
  const bitrateIdx = (b1 >> 4) & 0x0f;
  const sampleIdx = (b1 >> 2) & 0x03;
  const bitrate = bitrateTable[bitrateIdx] ?? 0;
  const sampleRate = sampleTable[sampleIdx] ?? 0;
  if (!bitrate || !sampleRate) return {};

  // Duration: walk frame headers (fixed maximum 100k frames / ~400MB to keep
  // the browser fast) summing frame durations.
  let frames = 0;
  let totalMs = 0;
  let pos = frameOffset;
  while (pos + 4 <= data.length && frames < 200_000) {
    if (data[pos] !== 0xff || (data[pos + 1]! & 0xe0) !== 0xe0) break;
    const lay = (data[pos + 1]! >> 1) & 0x03;
    const br = (data[pos + 2]! >> 4) & 0x0f;
    const sr = (data[pos + 2]! >> 2) & 0x03;
    if (lay === 0 || br === 0 || br === 15 || sr === 3) break;
    const kBps = bitrateTable[br]!;
    const hz = sampleTable[sr]!;
    const pad = (data[pos + 2]! >> 1) & 0x01;
    const samplePerFrame = lay === 3 ? 384 : 1152;
    const frameLen = Math.floor((samplePerFrame / 8) * kBps * 1000 / hz) + pad;
    totalMs += (samplePerFrame / hz) * 1000;
    frames++;
    pos += Math.max(frameLen, 1);
  }
  return {
    length: Math.round(totalMs),
    bitrate,
    sampleRate,
    fileTypeString: 'MPEG audio file',
  };
}
