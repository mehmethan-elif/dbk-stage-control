/**
 * Reads enough of a FLAC container to decode it a window at a time.
 *
 * Decoded audio is uncompressed: one song of stems is several hundred megabytes as
 * AudioBuffers but only tens of megabytes as FLAC. Holding the compressed bytes and
 * decoding just the part about to play keeps the whole show inside the memory a web view
 * is allowed, and it also means a song no longer has to be decoded before it can start.
 *
 * FLAC frames carry no state from one to the next, so a valid stream can be built from the
 * file's own header plus any run of frames. Decoding that gives back exactly the samples
 * the original has at that position.
 */

const SYNC_HIGH = 0xff;
const SYNC_LOW_MASK = 0xfe;
const SYNC_LOW = 0xf8;
const STREAMINFO_SIZE = 34;

const CRC8 = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let bit = 0; bit < 8; bit += 1) {
    c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  CRC8[i] = c;
}

function crc8(data: Uint8Array, from: number, to: number): number {
  let c = 0;
  for (let i = from; i < to; i += 1) c = CRC8[c ^ data[i]!]!;
  return c;
}

export interface FlacStreamInfo {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  /** Samples per frame. Only a fixed block size can be indexed by frame number. */
  readonly blockSize: number;
  readonly totalSamples: number;
  readonly duration: number;
}

export interface FlacFile {
  readonly info: FlacStreamInfo;
  /** Byte offset of every frame, plus a final entry for the end of the audio. */
  readonly frameOffsets: Uint32Array;
  readonly frameCount: number;
  readonly bytes: Uint8Array;
  /** `fLaC` and a STREAMINFO block with an unknown sample count, ready to prepend. */
  readonly header: Uint8Array;
}

/** A decoded number that FLAC stores in a UTF-8-like variable width coding. */
function readCodedNumber(data: Uint8Array, at: number): { value: number; next: number } | null {
  const first = data[at];
  if (first === undefined) return null;
  if (first < 0x80) return { value: first, next: at + 1 };
  let width = 0;
  while (first & (0x80 >> width)) width += 1;
  if (width < 2 || width > 7) return null;
  let value = first & (0x7f >> width);
  let p = at + 1;
  for (let i = 1; i < width; i += 1, p += 1) {
    const byte = data[p];
    if (byte === undefined || (byte & 0xc0) !== 0x80) return null;
    value = value * 64 + (byte & 0x3f);
  }
  return { value, next: p };
}

/**
 * Length of the frame header at `at` and the frame number it declares, or null when this
 * is not actually a frame header.
 */
function readFrameHeader(data: Uint8Array, at: number): { length: number; number: number } | null {
  if (at + 5 > data.length) return null;
  if (data[at] !== SYNC_HIGH || (data[at + 1]! & SYNC_LOW_MASK) !== SYNC_LOW) return null;

  const blockSizeCode = data[at + 2]! >> 4;
  const sampleRateCode = data[at + 2]! & 0x0f;
  if (blockSizeCode === 0 || sampleRateCode === 0x0f) return null;

  const channelCode = data[at + 3]! >> 4;
  const sampleSizeCode = (data[at + 3]! >> 1) & 0x07;
  if (channelCode > 0x0a || sampleSizeCode === 0x03 || sampleSizeCode === 0x07) return null;

  const coded = readCodedNumber(data, at + 4);
  if (!coded) return null;

  let p = coded.next;
  if (blockSizeCode === 6) p += 1;
  else if (blockSizeCode === 7) p += 2;
  if (sampleRateCode === 12) p += 1;
  else if (sampleRateCode === 13 || sampleRateCode === 14) p += 2;

  if (p >= data.length || crc8(data, at, p) !== data[p]) return null;
  return { length: p + 1 - at, number: coded.value };
}

function readStreamInfo(block: Uint8Array): FlacStreamInfo | null {
  if (block.length < STREAMINFO_SIZE) return null;
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const blockSize = view.getUint16(2);
  const minBlockSize = view.getUint16(0);
  // A variable block size gives frames no fixed relationship to sample positions, so it
  // cannot be indexed this way. Nothing in the library uses it, but be explicit.
  if (blockSize === 0 || blockSize !== minBlockSize) return null;

  const high = view.getUint32(10);
  const low = view.getUint32(14);
  const sampleRate = high >>> 12;
  const channels = ((high >>> 9) & 0x07) + 1;
  const bitsPerSample = ((high >>> 4) & 0x1f) + 1;
  // 36 bits of sample count: 4 low bits of `high`, then all of `low`.
  const totalSamples = (high & 0x0f) * 2 ** 32 + low;
  if (sampleRate === 0) return null;

  return {
    sampleRate,
    channels,
    bitsPerSample,
    blockSize,
    totalSamples,
    duration: totalSamples / sampleRate
  };
}

/** Sample count field: the low nibble of STREAMINFO byte 13, then four whole bytes. */
const SAMPLE_COUNT_AT = 8 + 13;

/** How many samples a window really delivers, which its header has to declare. */
function windowSamples(file: FlacFile, from: number, to: number): number {
  if (to <= from) return 0;
  const through = Math.min(to * file.info.blockSize, file.info.totalSamples);
  return Math.max(0, through - from * file.info.blockSize);
}

/**
 * Declares the length of a window. WebKit refuses to decode a stream whose sample count is
 * "unknown", because the result has to be a buffer of a definite size, so this cannot be
 * left at zero. The field is 36 bits, hence the arithmetic rather than bit shifts.
 */
function writeSampleCount(header: Uint8Array, samples: number): void {
  const high = Math.floor(samples / 2 ** 32) & 0x0f;
  const low = samples % 2 ** 32;
  header[SAMPLE_COUNT_AT] = (header[SAMPLE_COUNT_AT]! & 0xf0) | high;
  header[SAMPLE_COUNT_AT + 1] = Math.floor(low / 2 ** 24) & 0xff;
  header[SAMPLE_COUNT_AT + 2] = Math.floor(low / 2 ** 16) & 0xff;
  header[SAMPLE_COUNT_AT + 3] = Math.floor(low / 2 ** 8) & 0xff;
  header[SAMPLE_COUNT_AT + 4] = low & 0xff;
}

/** `fLaC` plus a STREAMINFO marked as the last block, with the sample count cleared. */
function buildHeader(streamInfo: Uint8Array): Uint8Array {
  const header = new Uint8Array(8 + STREAMINFO_SIZE);
  header.set([0x66, 0x4c, 0x61, 0x43], 0); // "fLaC"
  header[4] = 0x80; // last metadata block, type STREAMINFO
  header[5] = 0;
  header[6] = 0;
  header[7] = STREAMINFO_SIZE;
  header.set(streamInfo.subarray(0, STREAMINFO_SIZE), 8);
  // Cleared here and filled in per window by `sliceFlac`.
  header[SAMPLE_COUNT_AT]! &= 0xf0;
  for (let i = SAMPLE_COUNT_AT + 1; i < SAMPLE_COUNT_AT + 5; i += 1) header[i] = 0;
  return header;
}

/**
 * Indexes every frame so a window can be spliced out later. A header with a valid CRC-8 is
 * not proof by itself, because audio data can contain bytes that look like a sync code;
 * requiring each frame to declare the next number in sequence rejects those.
 */
function indexFrames(bytes: Uint8Array, audioStart: number, expected: number): Uint32Array | null {
  const offsets = new Uint32Array(expected + 1);
  let count = 0;
  let p = audioStart;
  while (p < bytes.length - 4) {
    if (bytes[p] === SYNC_HIGH && (bytes[p + 1]! & SYNC_LOW_MASK) === SYNC_LOW) {
      const header = readFrameHeader(bytes, p);
      if (header && header.number === count) {
        if (count >= expected) return null;
        offsets[count] = p;
        count += 1;
        p += header.length;
        continue;
      }
    }
    p += 1;
  }
  if (count !== expected) return null;
  offsets[count] = bytes.length;
  return offsets;
}

/**
 * Parses `data` far enough to splice windows out of it, or returns null when it is not
 * FLAC this can index. Callers fall back to decoding the file in one piece.
 */
export function parseFlac(data: ArrayBuffer | Uint8Array): FlacFile | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 8 + STREAMINFO_SIZE) return null;
  if (bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null;

  let p = 4;
  let streamInfo: Uint8Array | null = null;
  for (;;) {
    if (p + 4 > bytes.length) return null;
    const last = bytes[p]! >> 7;
    const type = bytes[p]! & 0x7f;
    const length = (bytes[p + 1]! << 16) | (bytes[p + 2]! << 8) | bytes[p + 3]!;
    if (type === 0) streamInfo = bytes.subarray(p + 4, p + 4 + length);
    p += 4 + length;
    if (last) break;
  }
  if (!streamInfo || p > bytes.length) return null;

  const info = readStreamInfo(streamInfo);
  if (!info || info.totalSamples === 0) return null;

  const frameCount = Math.ceil(info.totalSamples / info.blockSize);
  const frameOffsets = indexFrames(bytes, p, frameCount);
  if (!frameOffsets) return null;

  return { info, frameOffsets, frameCount, bytes, header: buildHeader(streamInfo) };
}

/** First frame holding `time`, so a window can start at or before it. */
export function frameAtTime(file: FlacFile, time: number): number {
  const sample = Math.max(0, time) * file.info.sampleRate;
  const frame = Math.floor(sample / file.info.blockSize);
  return Math.min(frame, file.frameCount - 1);
}

/** Start time of `frame`, which is where a spliced window's samples begin. */
export function frameStartTime(file: FlacFile, frame: number): number {
  return (frame * file.info.blockSize) / file.info.sampleRate;
}

/**
 * A decodable stream holding frames `[from, to)`. Windows are cut on frame boundaries, so
 * the result starts exactly at `frameStartTime(file, from)`.
 */
export function sliceFlac(file: FlacFile, from: number, to: number): Uint8Array {
  const first = Math.max(0, Math.min(from, file.frameCount));
  const last = Math.max(first, Math.min(to, file.frameCount));
  const start = file.frameOffsets[first]!;
  const end = file.frameOffsets[last]!;
  const out = new Uint8Array(file.header.length + (end - start));
  out.set(file.header, 0);
  writeSampleCount(out, windowSamples(file, first, last));
  out.set(file.bytes.subarray(start, end), file.header.length);
  return out;
}
