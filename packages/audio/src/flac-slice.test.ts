import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { frameAtTime, frameStartTime, parseFlac, sliceFlac } from "./flac-slice";

const FIXTURE = fileURLToPath(new URL("./fixtures/tone.flac", import.meta.url));
const bytes = new Uint8Array(readFileSync(FIXTURE));

/** Offset of the STREAMINFO payload: `fLaC` then a four byte block header. */
const STREAMINFO_AT = 8;

function crc8(data: Uint8Array): number {
  let c = 0;
  for (const byte of data) {
    c ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    }
  }
  return c;
}

describe("parseFlac", () => {
  it("reads the stream format and indexes every frame", () => {
    const file = parseFlac(bytes);
    expect(file).not.toBeNull();
    const { info, frameOffsets, frameCount } = file!;
    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(2);
    expect(info.bitsPerSample).toBe(16);
    expect(info.totalSamples).toBe(66150);
    expect(info.duration).toBeCloseTo(1.5, 6);
    expect(frameCount).toBe(Math.ceil(info.totalSamples / info.blockSize));
    expect(frameOffsets).toHaveLength(frameCount + 1);
  });

  it("indexes frames in order and ends at the end of the file", () => {
    const { frameOffsets, frameCount } = parseFlac(bytes)!;
    for (let i = 1; i <= frameCount; i += 1) {
      expect(frameOffsets[i]!).toBeGreaterThan(frameOffsets[i - 1]!);
    }
    expect(frameOffsets[0]!).toBeGreaterThan(STREAMINFO_AT);
    expect(frameOffsets[frameCount]!).toBe(bytes.length);
  });

  it("rejects data that is not indexable FLAC", () => {
    expect(parseFlac(new Uint8Array(0))).toBeNull();
    expect(parseFlac(new Uint8Array(64))).toBeNull();
    expect(parseFlac(bytes.subarray(0, 20))).toBeNull();
    const wrongMagic = bytes.slice();
    wrongMagic[1] = 0x00;
    expect(parseFlac(wrongMagic)).toBeNull();
  });

  it("ignores bytes inside a frame that look like a frame header", () => {
    const original = parseFlac(bytes)!;
    // A sync code with a valid CRC-8 is not proof of a frame, so plant one that declares
    // the wrong frame number and check it does not end up in the index.
    const planted = bytes.slice();
    const at = Math.floor((original.frameOffsets[1]! + original.frameOffsets[2]!) / 2);
    const header = Uint8Array.from([0xff, 0xf8, 0x19, 0x18, 0x63]);
    planted.set(header, at);
    planted[at + header.length] = crc8(header);

    const file = parseFlac(planted);
    expect(file).not.toBeNull();
    expect(file!.frameCount).toBe(original.frameCount);
    expect([...file!.frameOffsets]).toEqual([...original.frameOffsets]);
  });
});

describe("sliceFlac", () => {
  it("rebuilds the whole stream from every frame", () => {
    const file = parseFlac(bytes)!;
    const slice = sliceFlac(file, 0, file.frameCount);
    const audioBytes = bytes.length - file.frameOffsets[0]!;
    expect(slice.length).toBe(file.header.length + audioBytes);
    expect([...slice.subarray(0, 4)]).toEqual([0x66, 0x4c, 0x61, 0x43]);
    expect([...slice.subarray(file.header.length)]).toEqual([
      ...bytes.subarray(file.frameOffsets[0]!)
    ]);
  });

  /** The 36 bit sample count a window's header declares. */
  function declaredSamples(slice: Uint8Array): number {
    let value = slice[STREAMINFO_AT + 13]! & 0x0f;
    for (let i = 14; i < 18; i += 1) value = value * 256 + slice[STREAMINFO_AT + i]!;
    return value;
  }

  it("keeps the stream format", () => {
    const slice = sliceFlac(parseFlac(bytes)!, 0, 1);
    // Block sizes, frame sizes, sample rate, channels and bit depth must survive, or the
    // decoder reads the window at the wrong rate.
    for (let i = 0; i < 13; i += 1) {
      expect(slice[STREAMINFO_AT + i]).toBe(bytes[STREAMINFO_AT + i]);
    }
    expect(slice[STREAMINFO_AT + 13]! & 0xf0).toBe(bytes[STREAMINFO_AT + 13]! & 0xf0);
  });

  it("declares how many samples the window holds", () => {
    // WebKit rejects a window whose length is left unknown, so this has to be exact.
    const file = parseFlac(bytes)!;
    const { blockSize, totalSamples } = file.info;
    expect(declaredSamples(sliceFlac(file, 0, 1))).toBe(blockSize);
    expect(declaredSamples(sliceFlac(file, 2, 5))).toBe(3 * blockSize);
    expect(declaredSamples(sliceFlac(file, 0, file.frameCount))).toBe(totalSamples);
  });

  it("declares only the samples that exist in a trailing window", () => {
    // The last frame is padded, so a window running to the end holds less than its frames.
    const file = parseFlac(bytes)!;
    const { blockSize, totalSamples } = file.info;
    const last = file.frameCount - 1;
    expect(declaredSamples(sliceFlac(file, last, file.frameCount))).toBe(
      totalSamples - last * blockSize
    );
    expect(totalSamples).toBeLessThan(file.frameCount * blockSize);
  });

  it("cuts on frame boundaries so a window starts where it claims", () => {
    const file = parseFlac(bytes)!;
    const from = 2;
    const to = 5;
    const slice = sliceFlac(file, from, to);
    const expected = file.frameOffsets[to]! - file.frameOffsets[from]!;
    expect(slice.length).toBe(file.header.length + expected);
    expect(frameStartTime(file, from)).toBeCloseTo(
      (from * file.info.blockSize) / file.info.sampleRate,
      9
    );
  });

  it("clamps a window to the frames that exist", () => {
    const file = parseFlac(bytes)!;
    const all = sliceFlac(file, 0, file.frameCount);
    expect(sliceFlac(file, -5, file.frameCount + 10)).toEqual(all);
    expect(sliceFlac(file, 3, 1).length).toBe(file.header.length);
  });
});

describe("frameAtTime", () => {
  it("finds the frame holding a time, at or before it", () => {
    const file = parseFlac(bytes)!;
    const { blockSize, sampleRate } = file.info;
    expect(frameAtTime(file, 0)).toBe(0);
    expect(frameAtTime(file, -3)).toBe(0);
    const third = (2 * blockSize) / sampleRate;
    expect(frameAtTime(file, third)).toBe(2);
    expect(frameAtTime(file, third + 0.001)).toBe(2);
    expect(frameAtTime(file, third - 0.001)).toBe(1);
    expect(frameStartTime(file, frameAtTime(file, 1.0))).toBeLessThanOrEqual(1.0);
  });

  it("never points past the last frame", () => {
    const file = parseFlac(bytes)!;
    expect(frameAtTime(file, 999)).toBe(file.frameCount - 1);
  });
});
