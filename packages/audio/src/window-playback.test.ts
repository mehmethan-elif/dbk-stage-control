import { emptyMixerBank, type LoadedBuffers, type Song } from "@dbk/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { FlacFile } from "./flac-slice";
import { WebAudioEngine, WebAudioDeck } from "./web-audio-engine";

const WINDOW = 15;
const LEAD = 7;
const RATE = 44100;
const BLOCK = 4096;

/**
 * A FLAC file of the right shape and length. The bytes are never decoded here, so they do
 * not have to be real audio - `flac-slice.test.ts` covers the parsing itself.
 */
function fakeFlac(seconds: number): FlacFile {
  const totalSamples = Math.round(seconds * RATE);
  const frameCount = Math.ceil(totalSamples / BLOCK);
  const frameOffsets = new Uint32Array(frameCount + 1);
  for (let i = 0; i <= frameCount; i += 1) frameOffsets[i] = i * 100;
  return {
    info: {
      sampleRate: RATE,
      channels: 2,
      bitsPerSample: 16,
      blockSize: BLOCK,
      totalSamples,
      duration: totalSamples / RATE
    },
    frameOffsets,
    frameCount,
    bytes: new Uint8Array(frameCount * 100),
    header: new Uint8Array(42)
  };
}

interface Started {
  when: number;
  offset: number;
  duration: number | undefined;
}

/**
 * Song time a window's decoded buffer begins at. Windows are cut on frame boundaries, so
 * the buffer starts at or just before the window, and the offset into it makes up the rest.
 */
function bufferStart(index: number): number {
  return (Math.floor((index * WINDOW * RATE) / BLOCK) * BLOCK) / RATE;
}

/** Scheduling a window runs through a decode promise chain, so let it drain fully. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started: Started | null = null;
  stopped = false;

  start(when: number, offset: number, duration?: number): void {
    this.started = { when, offset, duration };
  }
  stop(): void {
    this.stopped = true;
  }
  connect(): void {}
  disconnect(): void {}
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = RATE;
  readonly sources: FakeSource[] = [];
  /** Set to hold decodes open so a late arrival can be simulated. */
  manual = false;
  private readonly waiting: (() => void)[] = [];
  decodes = 0;

  decodeAudioData(bytes: ArrayBuffer): Promise<unknown> {
    this.decodes += 1;
    const decoded = { duration: WINDOW, numberOfChannels: 2, sampleRate: RATE, length: 1 };
    if (!this.manual) return Promise.resolve(decoded);
    return new Promise((resolve) => {
      this.waiting.push(() => resolve(decoded));
    });
  }

  /** Lets every held decode finish, then lets the resulting scheduling run. */
  async flush(): Promise<void> {
    for (const resolve of this.waiting.splice(0)) resolve();
    await settle();
  }

  createGain() {
    return { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
  }
  createStereoPanner() {
    return { pan: { value: 0 }, connect: () => undefined, disconnect: () => undefined };
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

function song(): Song {
  return { id: "s1", title: "Song", assets: [], sections: [], tempoMap: [] } as unknown as Song;
}

function loaded(seconds: number, stems = 1): LoadedBuffers {
  return {
    tracks: Array.from({ length: stems }, (_, i) => ({
      id: `t${i}`,
      asset: { id: `t${i}`, kind: "audio", path: `Drums${i}.flac` },
      duration: seconds,
      payload: fakeFlac(seconds)
    })) as LoadedBuffers["tracks"]
  };
}

let ctx: FakeContext;
let deck: WebAudioDeck;
/** Whether the engine would open the output gate, which follows the deck being live. */
let gateOpen: boolean;

function makeDeck(): WebAudioDeck {
  ctx = new FakeContext();
  gateOpen = false;
  const engine = {
    context: ctx,
    getContextTime: () => ctx.currentTime,
    mixerInput: () => ({ connect: () => undefined, disconnect: () => undefined }),
    songMix: () => emptyMixerBank(),
    syncTransportGate: () => {
      gateOpen = deck.hasLiveSources();
    },
    logger: undefined
  } as unknown as WebAudioEngine;
  return new WebAudioDeck("A" as WebAudioDeck["id"], engine);
}

/** Windows that were handed to the audio clock, in the order they were scheduled. */
function scheduled(): Started[] {
  return ctx.sources.filter((s) => s.started !== null).map((s) => s.started!);
}

beforeEach(() => {
  deck = makeDeck();
});

describe("windowed playback", () => {
  it("decodes only the opening window when a song loads", async () => {
    await deck.load(song(), loaded(90, 3));
    // Three stems, one window each - not three whole songs.
    expect(ctx.decodes).toBe(3);
    expect(scheduled()).toEqual([]);
    expect(deck.isLoaded).toBe(true);
  });

  it("reports the length of the song without decoding it", async () => {
    await deck.load(song(), loaded(90));
    deck.play(0);
    expect(deck.longestEndsAt).toBe(90);
  });

  it("starts the opening window at the time it is asked for", async () => {
    await deck.load(song(), loaded(90));
    deck.play(10);
    expect(scheduled()).toEqual([{ when: 10, offset: 0, duration: WINDOW }]);
  });

  it("arms the next window once the playhead comes within the lead", async () => {
    await deck.load(song(), loaded(90));
    deck.play(0);
    expect(scheduled()).toHaveLength(1);

    ctx.currentTime = WINDOW - LEAD - 0.1;
    deck.poll(ctx.currentTime);
    await settle();
    expect(scheduled()).toHaveLength(1);

    ctx.currentTime = WINDOW - LEAD;
    deck.poll(ctx.currentTime);
    await settle();
    expect(scheduled()).toHaveLength(2);
    const next = scheduled()[1]!;
    expect(next.when).toBe(WINDOW);
    expect(next.offset).toBeCloseTo(WINDOW - bufferStart(1), 9);
    expect(next.duration).toBeCloseTo(WINDOW, 9);
  });

  it("arms each window only once however often it is polled", async () => {
    await deck.load(song(), loaded(90));
    deck.play(0);
    ctx.currentTime = WINDOW - LEAD;
    for (let i = 0; i < 5; i += 1) {
      deck.poll(ctx.currentTime);
      await settle();
    }
    expect(scheduled()).toHaveLength(2);
  });

  it("trims the last window to the end of the song", async () => {
    const seconds = 2 * WINDOW + 4;
    await deck.load(song(), loaded(seconds));
    deck.play(0);
    for (let at = 0; at < seconds; at += 1) {
      ctx.currentTime = at;
      deck.poll(at);
      await settle();
    }
    const last = scheduled().at(-1)!;
    expect(scheduled()).toHaveLength(3);
    expect(last.when).toBe(2 * WINDOW);
    expect(last.duration).toBeCloseTo(4, 6);
  });

  it("skips the part of a window that arrives after its slot", async () => {
    await deck.load(song(), loaded(90));
    deck.play(0);
    ctx.manual = true;
    ctx.currentTime = WINDOW - LEAD;
    deck.poll(ctx.currentTime);
    // The decode comes back two seconds after the window was due to start.
    ctx.currentTime = WINDOW + 2;
    await ctx.flush();

    const late = scheduled()[1]!;
    expect(late.when).toBe(WINDOW + 2);
    expect(late.offset).toBeCloseTo(WINDOW + 2 - bufferStart(1), 9);
    expect(late.duration).toBeCloseTo(WINDOW - 2, 9);
  });

  it("drops a window that finishes decoding after the deck stopped", async () => {
    await deck.load(song(), loaded(90));
    deck.play(0);
    ctx.manual = true;
    ctx.currentTime = WINDOW - LEAD;
    deck.poll(ctx.currentTime);
    deck.stop();
    await ctx.flush();
    // Only the opening window ever started, and stopping halted it.
    expect(scheduled()).toHaveLength(1);
    expect(ctx.sources[0]!.stopped).toBe(true);
  });

  it("keeps the opening window so replaying does not decode again", async () => {
    await deck.load(song(), loaded(90));
    const afterLoad = ctx.decodes;
    deck.play(0);
    deck.stop();
    deck.play(0);
    expect(ctx.decodes).toBe(afterLoad);
    expect(scheduled()).toHaveLength(2);
  });

  it("stays live while the window a seek needs is still decoding", async () => {
    await deck.load(song(), loaded(90));
    deck.play(0);
    expect(gateOpen).toBe(true);

    // Seeking past the opening window has to wait for a decode. The deck is still playing,
    // so the output must not be gated off in the meantime or the rest of the song is silent.
    ctx.manual = true;
    ctx.currentTime = 5;
    deck.seek(35);
    expect(gateOpen).toBe(true);

    await ctx.flush();
    expect(gateOpen).toBe(true);
    expect(scheduled()).toHaveLength(2);
  });

  it("plays from a seek position within the window holding it", async () => {
    await deck.load(song(), loaded(90));
    deck.seek(4);
    deck.play(0);
    expect(scheduled()).toEqual([{ when: 0, offset: 4, duration: WINDOW - 4 }]);
  });
});
