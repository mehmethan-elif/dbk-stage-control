import { describe, expect, it } from "vitest";
import { songForm, type ChordEvent, type PatternNote, type Song, type SongForm } from "@dbk/core";
import { chordChart, chordPlayhead, hasChordData, slotGridPlacement } from "./chord-chart";

const BAR = 2;

function note(time: number, pitch: number): PatternNote {
  return { time, pitch, numerator: 4, denominator: 4 };
}

function chord(measure: number, beat: number, text: string, notes?: PatternNote[]): ChordEvent {
  const time = (measure - 1) * BAR + ((beat - 1) * BAR) / 4;
  return { time, end: time + BAR / 4, measure, beat, text, notes };
}

/** One chord a bar, on the downbeat, from the bar number given. */
function run(from: number, names: string[]): ChordEvent[] {
  return names.map((name, index) => chord(from + index, 1, name));
}

function song(
  sections: { name: string; start: number; end: number }[],
  chords: ChordEvent[]
): Song {
  return {
    id: "s",
    version: 1,
    title: "T",
    duration: sections[sections.length - 1]?.end ?? 0,
    assets: [],
    tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
    sections,
    chords
  };
}

function chart(target: Song) {
  return chordChart(target, songForm(target, { identity: "chords" }));
}

/** A form with a block per section, the way a song whose passes never quite match reads. */
function spelledOut(target: Song): SongForm {
  const blocks = target.sections.map((section, index) => ({
    id: `form_${index}`,
    name: section.name,
    originIndex: index,
    originStart: section.start,
    originEnd: section.end,
    segno: false,
    coda: false,
    toCoda: false,
    ds: false,
    repeatStart: false,
    repeatEnd: false
  }));
  return {
    blocks,
    visits: blocks.map((block) => ({
      blockId: block.id,
      start: block.originStart,
      end: block.originEnd,
      pass: 1,
      fromJump: "none" as const
    }))
  };
}

function measures(target: Song) {
  return chart(target).rows.map((row) =>
    row.spans.map((span) => ({
      bars: span.lines.map((line) => line.map((bar) => bar.measure)),
      plays: span.plays
    }))
  );
}

describe("hasChordData", () => {
  it("is false for a song nobody has written chords for", () => {
    expect(hasChordData(song([{ name: "ARA", start: 0, end: 8 }], []))).toBe(false);
    expect(hasChordData(undefined)).toBe(false);
    expect(hasChordData(song([{ name: "ARA", start: 0, end: 8 }], [chord(1, 1, "Em")]))).toBe(true);
  });
});

describe("chordChart", () => {
  it("lays the bars out four to a line", () => {
    const target = song(
      [{ name: "ARA", start: 0, end: 12 }],
      run(1, ["Em", "D", "C", "G", "Am", "Bm"])
    );
    expect(measures(target)).toEqual([
      [
        {
          bars: [
            [1, 2, 3, 4],
            [5, 6]
          ],
          plays: 1
        }
      ]
    ]);
  });

  it("keeps two chords of one bar in that bar, on their own beats", () => {
    const target = song(
      [{ name: "ARA", start: 0, end: 4 }],
      [chord(1, 1, "Gmaj7"), chord(1, 3, "Am"), chord(2, 1, "Bm")]
    );
    const bars = chart(target).rows[0]?.spans[0]?.lines[0] ?? [];
    expect(bars.map((bar) => bar.slots.map((slot) => slot.text))).toEqual([
      ["Gmaj7", "Am"],
      ["Bm"]
    ]);
    // The second chord owns the back half of the bar, which is what the playhead picks out.
    expect(bars[0]?.slots.map((slot) => [slot.from, slot.to])).toEqual([
      [0, 0.5],
      [0.5, 1]
    ]);
  });

  it("gives Am one beat and Bm the rest of a 3/4 bar", () => {
    const waltz: Song = {
      id: "tuna",
      version: 1,
      title: "Tuna",
      duration: 16.8,
      assets: [],
      tempoMap: [{ time: 0, measure: 1, bpm: 75, numerator: 3, denominator: 4 }],
      sections: [
        { name: "COUNT", start: 0, end: 4.8 },
        { name: "ARA 1", start: 4.8, end: 16.8 }
      ],
      chords: [
        { time: 12, end: 12.8, measure: 6, beat: 1, text: "Am" },
        { time: 12.8, end: 14.4, measure: 6, beat: 2, text: "Bm" }
      ]
    };
    const bars = chart(waltz)
      .rows.flatMap((row) => row.spans.flatMap((span) => span.lines.flat()))
      .filter((bar) => bar.measure === 6);
    expect(bars[0]?.beats).toBe(3);
    expect(bars[0]?.slots.map((slot) => [slot.text, slot.from, slot.to])).toEqual([
      ["Am", 0, 1 / 3],
      ["Bm", 1 / 3, 1]
    ]);
    expect(bars[0]?.slots.map((slot) => slotGridPlacement(slot, 12))).toEqual([
      { column: 1, span: 4 },
      { column: 5, span: 8 }
    ]);
  });

  it("draws the strum on every bar", () => {
    const target = song(
      [{ name: "ARA", start: 0, end: 6 }],
      [
        chord(1, 1, "Em", [note(0, 48), note(1, 48)]),
        chord(2, 1, "Em", [note(2, 48), note(3, 48)]),
        chord(3, 1, "Am", [note(4, 48)])
      ]
    );
    const bars = chart(target).rows[0]?.spans[0]?.lines[0] ?? [];
    expect(bars.map((bar) => bar.notes.length)).toEqual([2, 2, 1]);
  });

  describe("repeat signs", () => {
    it("writes four bars played twice once, and counts a third pass", () => {
      const twice = song(
        [{ name: "ARA", start: 0, end: 16 }],
        run(1, ["Em", "D", "C", "G", "Em", "D", "C", "G"])
      );
      expect(measures(twice)).toEqual([[{ bars: [[1, 2, 3, 4]], plays: 2 }]]);

      const thrice = song(
        [{ name: "ARA", start: 0, end: 24 }],
        run(1, ["Em", "D", "C", "G", "Em", "D", "C", "G", "Em", "D", "C", "G"])
      );
      expect(measures(thrice)).toEqual([[{ bars: [[1, 2, 3, 4]], plays: 3 }]]);
    });

    it("writes a two bar figure out rather than send the band to a sign", () => {
      const target = song([{ name: "ARA", start: 0, end: 8 }], run(1, ["Em", "D", "Em", "D"]));
      expect(measures(target)).toEqual([[{ bars: [[1, 2, 3, 4]], plays: 1 }]]);
    });

    it("splits a section into what repeats and what does not", () => {
      const target = song(
        [{ name: "ARA", start: 0, end: 24 }],
        run(1, ["Em", "D", "C", "G", "Em", "D", "C", "G", "Am", "Bm", "F", "E"])
      );
      expect(measures(target)).toEqual([
        [
          { bars: [[1, 2, 3, 4]], plays: 2 },
          { bars: [[9, 10, 11, 12]], plays: 1 }
        ]
      ]);
    });

    it("holds the bars before a repeat back so the repeat starts a line", () => {
      const target = song(
        [{ name: "ARA", start: 0, end: 18 }],
        run(1, ["Am", "Em", "D", "C", "G", "Em", "D", "C", "G"])
      );
      expect(measures(target)).toEqual([
        [
          { bars: [[1]], plays: 1 },
          { bars: [[2, 3, 4, 5]], plays: 2 }
        ]
      ]);
    });

    it("counts a section that plays the section before it again", () => {
      const target = song(
        [
          { name: "ARA", start: 0, end: 8 },
          { name: "ARA", start: 8, end: 16 }
        ],
        run(1, ["Em", "D", "C", "G"]).concat(run(5, ["Em", "D", "C", "G"]))
      );
      // However the form reads it, the page holds one ARA of four bars.
      const rows = chart(target).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.spans.flatMap((span) => span.lines.flat()).map((bar) => bar.measure)).toEqual(
        [1, 2, 3, 4]
      );
    });

    it("leaves a section that plays something else alone", () => {
      const target = song(
        [
          { name: "ARA", start: 0, end: 8 },
          { name: "NAK", start: 8, end: 16 }
        ],
        run(1, ["Em", "D", "C", "G"]).concat(run(5, ["Am", "Bm", "F", "E"]))
      );
      expect(chart(target).rows.map((row) => row.heads[0]?.block.name)).toEqual(["ARA", "NAK"]);
    });
  });

  describe("where the tempo gives", () => {
    it("has nothing to say when the tempo holds", () => {
      expect(chart(song([{ name: "ARA", start: 0, end: 8 }], run(1, ["Em", "D"]))).rall).toBeNull();
    });

    it("points the rall at the bar on the page the band reads it from", () => {
      // The same four bars twice, the second pass slowing. The page holds one set of bars, so the
      // sign goes over those, and the bar it names is the one the band is playing when it gives.
      const at = (time: number, measure: number, text: string): ChordEvent => ({
        time,
        end: time + 0.5,
        measure,
        beat: 1,
        text
      });
      const target: Song = {
        ...song(
          [
            { name: "NAK", start: 0, end: 8 },
            { name: "NAK", start: 8, end: 24 }
          ],
          [
            at(0, 1, "Em"),
            at(2, 2, "D"),
            at(4, 3, "C"),
            at(6, 4, "G"),
            at(8, 5, "Em"),
            at(12, 6, "D"),
            at(16, 7, "C"),
            at(20, 8, "G")
          ]
        ),
        duration: 24,
        tempoMap: [
          { time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 },
          { time: 8, measure: 5, bpm: 60, numerator: 4, denominator: 4 }
        ]
      };
      const built = chart(target);
      expect(built.rall?.measure).toBe(5);
      expect(built.rall?.shown.measure).toBe(1);
      expect(built.rall?.shown.blockId).toBe(built.rows[0]?.heads[0]?.block.id);
    });

    it("keeps the rall on a NAK that is only written once and slowed on the return", () => {
      const at = (time: number, measure: number, text: string): ChordEvent => ({
        time,
        end: time + 0.5,
        measure,
        beat: 1,
        text
      });
      const target: Song = {
        ...song(
          [
            { name: "ARA", start: 0, end: 4 },
            { name: "NAK", start: 4, end: 12 },
            { name: "ARA", start: 12, end: 16 },
            { name: "NAK", start: 16, end: 32 }
          ],
          [
            at(0, 1, "Em"),
            at(4, 3, "C"),
            at(6, 4, "G"),
            at(8, 5, "D"),
            at(10, 6, "Am"),
            at(12, 7, "Em"),
            at(16, 9, "C"),
            at(18, 10, "G"),
            at(22, 11, "D"),
            at(28, 12, "Am")
          ]
        ),
        duration: 32,
        tempoMap: [
          { time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 },
          { time: 16, measure: 9, bpm: 60, numerator: 4, denominator: 4 }
        ]
      };
      const built = chart(target);
      expect(built.rows.map((row) => row.heads[0]?.block.name)).toEqual(["ARA", "NAK"]);
      expect(built.rall?.measure).toBe(9);
      expect(built.rall?.shown.blockId).toBe(built.rows[1]?.heads[0]?.block.id);
    });
  });

  describe("sections that play bars already on the page", () => {
    const target = song(
      [
        { name: "SAN 1", start: 0, end: 8 },
        { name: "CEV", start: 8, end: 12 },
        { name: "SAN 2", start: 12, end: 20 },
        { name: "CEV FINAL", start: 20, end: 24 }
      ],
      run(1, ["Em", "D", "C", "G"])
        .concat(run(5, ["Am", "Bm"]))
        .concat(run(7, ["Em", "D", "C", "G"]))
        .concat(run(11, ["Am", "Bm"]))
    );

    it("names the later section under those bars rather than writing them again", () => {
      const rows = chart(target).rows;
      expect(rows.map((row) => row.heads.map((head) => head.section.name))).toEqual([
        ["SAN 1", "SAN 2"],
        ["CEV", "CEV FINAL"]
      ]);
      expect(rows[0]?.spans.flatMap((span) => span.lines.flat()).map((bar) => bar.measure)).toEqual(
        [1, 2, 3, 4]
      );
    });

    it("writes a section out when its bars differ", () => {
      const other = song(
        [
          { name: "SAN 1", start: 0, end: 8 },
          { name: "SAN 2", start: 8, end: 16 }
        ],
        run(1, ["Em", "D", "C", "G"]).concat(run(5, ["Em", "Am", "F", "E"]))
      );
      expect(chart(other).rows.map((row) => row.heads.map((head) => head.section.name))).toEqual([
        ["SAN 1"],
        ["SAN 2"]
      ]);
    });

    it("stacks a name only over bars of its own family", () => {
      // Tuna Nehri plays the same four bars as NAK 2 and again as ARA 1. They are two different
      // places in the song, so one name under the other would read as one of them played twice.
      const other = song(
        [
          { name: "NAK 2", start: 0, end: 8 },
          { name: "ARA 1", start: 8, end: 16 }
        ],
        run(1, ["Em", "D", "C", "G"]).concat(run(5, ["Em", "D", "C", "G"]))
      );
      const rows = chordChart(other, spelledOut(other)).rows;
      expect(rows.map((row) => row.heads.map((head) => head.section.name))).toEqual([
        ["NAK 2"],
        ["ARA 1"]
      ]);
    });

    it("gathers every pass of a run onto one set of bars", () => {
      const other = song(
        [
          { name: "NAK 2", start: 0, end: 8 },
          { name: "NAK 3", start: 8, end: 16 },
          { name: "NAK 4", start: 16, end: 24 }
        ],
        run(1, ["Em", "D", "C", "G"])
          .concat(run(5, ["Em", "D", "C", "G"]))
          .concat(run(9, ["Em", "D", "C", "G"]))
      );
      const rows = chordChart(other, spelledOut(other)).rows;
      expect(rows.map((row) => row.heads.map((head) => head.section.name))).toEqual([
        ["NAK 2", "NAK 3", "NAK 4"]
      ]);
      expect(rows[0]?.spans[0]?.opens).toBe(true);
      expect(rows[0]?.spans[0]?.closes).toBe(3);
    });

    it("puts a repeat sign round the bars a stack of names is read from", () => {
      const rows = chart(target).rows;
      // The repeat opens at the top of the run and closes at the foot of it, so the band plays
      // SAN 1 and CEV, then reads the same bars again as SAN 2 and CEV FINAL.
      expect(rows[0]?.spans[0]?.opens).toBe(true);
      expect(rows[0]?.spans.at(-1)?.closes).toBeUndefined();
      expect(rows[1]?.spans[0]?.opens).toBeUndefined();
      expect(rows[1]?.spans.at(-1)?.closes).toBe(2);
    });

    it("writes two passes that part company at the end as one repeat with two endings", () => {
      // Kerkük's SAN A: the same bars twice, landing differently each time.
      const other = song(
        [
          { name: "SAN A", start: 0, end: 8 },
          { name: "SAN A", start: 8, end: 16 }
        ],
        run(1, ["G", "Em", "Am", "Bm"]).concat(run(5, ["G", "Em", "Am", "B"]))
      );
      const rows = chordChart(other, spelledOut(other)).rows;
      expect(rows).toHaveLength(1);
      // One name, since both passes answer to it, and the bars the passes share written once.
      expect(rows[0]?.heads.map((head) => head.section.name)).toEqual(["SAN A"]);
      expect(rows[0]?.spans.map((span) => span.lines.flat().map((bar) => bar.measure))).toEqual([
        [1, 2, 3, 4],
        [8]
      ]);
      // The repeat closes after the first ending, and each ending says which pass it is.
      expect(rows[0]?.spans[0]?.opens).toBe(true);
      expect(rows[0]?.spans[0]?.closes).toBe(2);
      expect(rows[0]?.spans[0]?.ending).toEqual({ at: 3, pass: 1 });
      expect(rows[0]?.spans[1]?.ending).toEqual({ at: 0, pass: 2 });
    });

    it("reads the second pass off the shared bars and its own ending", () => {
      const other = song(
        [
          { name: "SAN A", start: 0, end: 8 },
          { name: "SAN A", start: 8, end: 16 }
        ],
        run(1, ["G", "Em", "Am", "Bm"]).concat(run(5, ["G", "Em", "Am", "B"]))
      );
      const form = spelledOut(other);
      const built = chordChart(other, form);
      const at = (time: number) => {
        const head = chordPlayhead(built, form, time, other.tempoMap);
        return head ? head.measure : null;
      };
      // First pass: bars one to four as written. Second pass: the same three bars, then its own.
      expect([0, 2, 4, 6].map((time) => at(time))).toEqual([1, 2, 3, 4]);
      expect([8, 10, 12, 14].map((time) => at(time))).toEqual([1, 2, 3, 8]);
      // Both passes light the one name on the page.
      const name = built.rows[0]?.heads[0]?.block.id;
      expect(chordPlayhead(built, form, 10, other.tempoMap)?.playing).toBe(name);
    });

    it("keeps D.S. on a SAN D that ends two ways", () => {
      // Kerkük: the two SAN Ds share their first bars and land differently, and the second
      // sends the band back. One name, two endings, the sign still on SAN D.
      const other = song(
        [
          { name: "SAN D", start: 0, end: 8 },
          { name: "SAN D", start: 8, end: 16 }
        ],
        run(1, ["G", "Em", "Am", "Bm"]).concat(run(5, ["G", "Em", "Am", "B"]))
      );
      const form = spelledOut(other);
      const marked = {
        ...form,
        blocks: form.blocks.map((block, index) =>
          index === 1 ? { ...block, ds: true, toCoda: true } : block
        )
      };
      const rows = chordChart(other, marked).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.heads.map((head) => head.section.name)).toEqual(["SAN D"]);
      expect(rows[0]?.heads[0]?.block.ds).toBe(true);
      expect(rows[0]?.heads[0]?.block.toCoda).toBe(true);
      expect(rows[0]?.spans[0]?.ending).toEqual({ at: 3, pass: 1 });
      expect(rows[0]?.spans[1]?.ending).toEqual({ at: 0, pass: 2 });
    });

    it("writes both passes out when they part company early", () => {
      const other = song(
        [
          { name: "SAN A", start: 0, end: 8 },
          { name: "SAN A", start: 8, end: 16 }
        ],
        run(1, ["G", "Em", "Am", "Bm"]).concat(run(5, ["G", "C", "F", "E"]))
      );
      expect(chordChart(other, spelledOut(other)).rows.map((row) => row.spans.length)).toEqual([
        1, 1
      ]);
    });

    it("leaves a section that shares its bars with something further up written out", () => {
      const other = song(
        [
          { name: "ARA", start: 0, end: 8 },
          { name: "SAN", start: 8, end: 16 },
          { name: "NAK", start: 16, end: 24 }
        ],
        run(1, ["Em", "D", "C", "G"])
          .concat(run(5, ["Am", "Bm", "F", "E"]))
          .concat(run(9, ["Em", "D", "C", "G"]))
      );
      expect(chart(other).rows.map((row) => row.heads.map((head) => head.section.name))).toEqual([
        ["ARA"],
        ["SAN"],
        ["NAK"]
      ]);
    });

    it("writes an ending out, so the sign that sends the band there has bars to land on", () => {
      const other = song(
        [
          { name: "ARA", start: 0, end: 8 },
          { name: "FINAL", start: 8, end: 16 }
        ],
        run(1, ["Em", "D", "C", "G"]).concat(run(5, ["Em", "D", "C", "G"]))
      );
      expect(chart(other).rows.map((row) => row.heads.map((head) => head.section.name))).toEqual([
        ["ARA"],
        ["FINAL"]
      ]);
    });

    it("writes a run that comes round under the same names out, having nothing new to say", () => {
      // Kerkük Zindanı is written like this: a form that spells every pass out in full.
      const other = song(
        [
          { name: "ARA", start: 0, end: 8 },
          { name: "NAK", start: 8, end: 16 },
          { name: "ARA", start: 16, end: 24 },
          { name: "NAK", start: 24, end: 32 }
        ],
        run(1, ["Em", "D", "C", "G"])
          .concat(run(5, ["Am", "Bm", "F", "E"]))
          .concat(run(9, ["Em", "D", "C", "G"]))
          .concat(run(13, ["Am", "Bm", "F", "E"]))
      );
      const rows = chordChart(other, spelledOut(other)).rows;
      expect(rows.map((row) => row.heads.map((head) => head.section.name))).toEqual([
        ["ARA"],
        ["NAK"],
        ["ARA"],
        ["NAK"]
      ]);
    });

    it("writes a run out when only part of it comes round under a new name", () => {
      // Tuna Nehri reads like this: the run comes round, but only its last section is renamed,
      // so folding it would leave the band nothing to read the second pass from.
      const other = song(
        [
          { name: "ARA", start: 0, end: 8 },
          { name: "NAK 1", start: 8, end: 16 },
          { name: "ARA", start: 16, end: 24 },
          { name: "NAK 2", start: 24, end: 32 }
        ],
        run(1, ["Em", "D", "C", "G"])
          .concat(run(5, ["Am", "Bm", "F", "E"]))
          .concat(run(9, ["Em", "D", "C", "G"]))
          .concat(run(13, ["Am", "Bm", "F", "E"]))
      );
      const rows = chordChart(other, spelledOut(other)).rows;
      expect(rows.map((row) => row.heads.map((head) => head.section.name))).toEqual([
        ["ARA"],
        ["NAK 1"],
        ["ARA"],
        ["NAK 2"]
      ]);
    });

    it("lights the name of the pass being played, and the name read next", () => {
      const form = songForm(target, { identity: "chords" });
      const built = chordChart(target, form);
      const [san, cev] = built.rows;
      const head = (time: number) => chordPlayhead(built, form, time, target.tempoMap);
      expect(head(1)).toMatchObject({
        measure: 1,
        playing: san?.heads[0]?.block.id
      });
      // Bar 7 belongs to SAN 2, and is read off bar 1.
      expect(head(13)).toMatchObject({
        measure: 1,
        playing: san?.heads[1]?.block.id
      });
      expect(head(19)).toMatchObject({
        next: { measure: 5 },
        nextPlaying: cev?.heads[1]?.block.id
      });
    });
  });

  it("narrows the name bar of a section shorter than a line", () => {
    const target = song([{ name: "ARA", start: 0, end: 4 }], run(1, ["Em", "D"]));
    expect(chart(target).rows[0]?.width).toBe(0.5);
    const full = song(
      [{ name: "ARA", start: 0, end: 12 }],
      run(1, ["Em", "D", "C", "G", "Am", "Bm"])
    );
    expect(chart(full).rows[0]?.width).toBe(1);
  });
});

describe("chordPlayhead", () => {
  const target = song(
    [
      { name: "ARA", start: 0, end: 16 },
      { name: "NAK", start: 16, end: 24 }
    ],
    run(1, ["Em", "D", "C", "G", "Em", "D", "C", "G"]).concat(run(9, ["Am", "Bm", "F", "E"]))
  );
  const form = songForm(target, { identity: "chords" });
  const built = chordChart(target, form);
  const head = (time: number) => chordPlayhead(built, form, time, target.tempoMap);

  it("leaves ordinary following bars unlit", () => {
    expect(head(0)).toMatchObject({ measure: 1, next: null });
    expect(head(5)).toMatchObject({ measure: 3, next: null });
  });

  it("lights the written bars again on the second pass of a repeat", () => {
    // Bar 6 of the song is the second pass, and bar 2 is where it is written.
    expect(head(11)).toMatchObject({ measure: 2 });
  });

  it("sends the band back to the top of the repeat, not down the page", () => {
    expect(head(7.5)).toMatchObject({ measure: 4, next: { measure: 1 } });
  });

  it("leaves the repeat for the next section once it has been played out", () => {
    const out = head(15.5);
    expect(out?.measure).toBe(4);
    expect(out?.next?.measure).toBe(9);
  });

  it("knows how far through a bar the band is", () => {
    expect(head(0)?.phase).toBeCloseTo(0, 5);
    expect(head(1)?.phase).toBeCloseTo(0.5, 5);
    // A bar of the second pass reads its phase off the bar being played, not the one drawn.
    expect(head(9)?.phase).toBeCloseTo(0.5, 5);
  });

  it("stays on the last bar when a section is written a hair long", () => {
    // The export can leave a section ending a few milliseconds past its last bar line.
    const long = song([{ name: "ARA", start: 0, end: 8.01 }], run(1, ["Em", "D", "C", "G"]));
    const longForm = songForm(long, { identity: "chords" });
    const built = chordChart(long, longForm);
    expect(chordPlayhead(built, longForm, 8.005, long.tempoMap)).toMatchObject({
      measure: 4
    });
  });

  it("is nothing before the song and nothing after it", () => {
    expect(head(-1)).toBeNull();
    expect(head(60)).toBeNull();
  });

  it("lights a 1. or 2. ending when that bar is next", () => {
    const volta = song(
      [
        { name: "SAN A", start: 0, end: 8 },
        { name: "SAN A", start: 8, end: 16 }
      ],
      run(1, ["G", "Em", "Am", "Bm"]).concat(run(5, ["G", "Em", "Am", "B"]))
    );
    const form = spelledOut(volta);
    const built = chordChart(volta, form);
    const at = (time: number) => chordPlayhead(built, form, time, volta.tempoMap);
    expect(at(2)).toMatchObject({ measure: 2, next: null });
    expect(at(4)).toMatchObject({ measure: 3, next: { measure: 4 } });
    expect(at(12)).toMatchObject({ measure: 3, next: { measure: 8 } });
  });
});
