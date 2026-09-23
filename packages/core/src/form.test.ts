import { describe, expect, it } from "vitest";
import { formAt, formNextAt, formRepeats, songForm } from "./form.js";
import type { Song } from "./models.js";

function song(sections: { name: string; start: number; end: number }[]): Song {
  return {
    id: "s",
    version: 1,
    title: "T",
    duration: sections[sections.length - 1]?.end ?? 0,
    assets: [],
    tempoMap: [{ time: 0, measure: 1, bpm: 120, numerator: 4, denominator: 4 }],
    sections
  };
}

const biz = song([
  { name: "COUNT", start: 0, end: 2 },
  { name: "ARA", start: 2, end: 16 },
  { name: "ARA", start: 16, end: 30 },
  { name: "SAN", start: 30, end: 56 },
  { name: "CEV", start: 56, end: 60 },
  { name: "SAN", start: 60, end: 86 },
  { name: "CEV", start: 86, end: 90 },
  { name: "ARA", start: 90, end: 104 },
  { name: "ARA", start: 104, end: 118 },
  { name: "SAN", start: 118, end: 144 },
  { name: "CEV", start: 144, end: 148 },
  { name: "SAN", start: 148, end: 170 },
  { name: "FINAL", start: 170, end: 174 }
]);

describe("songForm", () => {
  it("does not hang a coda on a section named FINAL", () => {
    const form = songForm(
      song([
        { name: "ARA C", start: 0, end: 8 },
        { name: "FINAL", start: 8, end: 16 }
      ])
    );
    expect(form.blocks.find((block) => block.name === "ARA C")?.toCoda).toBe(false);
    expect(form.blocks.find((block) => block.name === "FINAL")?.coda).toBe(false);
  });

  it("does not mark a section named CODA as a jump", () => {
    const form = songForm(
      song([
        { name: "ARA", start: 0, end: 8 },
        { name: "CODA", start: 8, end: 16 }
      ])
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["ARA", "CODA"]);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("writes consecutive same-name sections separately and jumps later visits back", () => {
    const form = songForm(biz);
    expect(form.blocks.map((block) => block.name)).toEqual(["COUNT", "ARA", "ARA", "SAN", "CEV", "FINAL"]);
    expect(formRepeats(form, "form_1")).toBe(2);
    expect(formRepeats(form, "form_2")).toBe(2);
    const [firstAra, secondAra] = form.blocks.filter((block) => block.name === "ARA");
    const cev = form.blocks.find((block) => block.name === "CEV");
    const san = form.blocks.find((block) => block.name === "SAN");
    const final = form.blocks.find((block) => block.name === "FINAL");
    expect(firstAra?.segno).toBe(true);
    expect(firstAra?.repeatStart).toBe(false);
    expect(firstAra?.repeatEnd).toBe(false);
    expect(secondAra?.segno).toBe(false);
    expect(secondAra?.repeatStart).toBe(false);
    expect(secondAra?.repeatEnd).toBe(false);
    expect(san?.repeatStart).toBe(true);
    expect(san?.repeatEnd).toBe(false);
    expect(cev?.repeatStart).toBe(false);
    expect(cev?.repeatEnd).toBe(true);
    expect(cev?.ds).toBe(true);
    expect(san?.toCoda).toBe(false);
    expect(final?.coda).toBe(false);
  });

  it("keeps the last pass on the written bars when its first chord lands a hair early", () => {
    const chord = (time: number, text: string) => ({
      time,
      text,
      measure: 1,
      notes: [{ time, pitch: 50, numerator: 4, denominator: 4 }]
    });
    const form = songForm(
      {
        ...song([
          { name: "COUNT", start: 0, end: 2 },
          { name: "ARA", start: 2, end: 16 },
          { name: "SAN", start: 16, end: 30 },
          { name: "CEV", start: 30, end: 34 },
          { name: "ARA", start: 34, end: 48 },
          { name: "SAN", start: 48, end: 62 },
          { name: "CEV", start: 62, end: 66 }
        ]),
        chords: [chord(30 - 1e-13, "Dm"), chord(62, "Dm")]
      },
      { identity: "chords" }
    );

    expect(form.blocks.filter((block) => block.name === "CEV")).toHaveLength(1);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("puts D.S. on a mid-song FINAL instead of a coda when the form then goes back", () => {
    const form = songForm(
      song([
        { name: "COUNT", start: 0, end: 2 },
        { name: "INTRO", start: 2, end: 6 },
        { name: "ARA", start: 6, end: 10 },
        { name: "NAK", start: 10, end: 14 },
        { name: "NAK", start: 14, end: 18 },
        { name: "FINAL", start: 18, end: 20 },
        { name: "INTRO", start: 20, end: 24 },
        { name: "ARA", start: 24, end: 28 },
        { name: "NAK", start: 28, end: 32 },
        { name: "NAK", start: 32, end: 36 },
        { name: "FINAL", start: 36, end: 38 }
      ])
    );

    expect(form.blocks.map((block) => block.name)).toEqual([
      "COUNT",
      "INTRO",
      "ARA",
      "NAK",
      "NAK",
      "FINAL"
    ]);
    expect(form.blocks.find((block) => block.name === "INTRO")?.segno).toBe(true);
    expect(form.blocks.find((block) => block.name === "FINAL")?.ds).toBe(true);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("reads a second cycle as D.S. when its notes land a millisecond later", () => {
    const note = (time: number) => ({ time, pitch: 60, numerator: 4, denominator: 4 });
    const chord = (time: number, text: string, drift = 0) => ({
      time,
      text,
      measure: 1,
      notes: [note(time + drift)]
    });
    const form = songForm(
      {
        ...song([
          { name: "COUNT", start: 0, end: 2 },
          { name: "ARA", start: 2, end: 6 },
          { name: "SAN A", start: 6, end: 10 },
          { name: "SAN D", start: 10, end: 14 },
          { name: "ARA", start: 14, end: 18 },
          { name: "SAN A", start: 18, end: 22 },
          { name: "SAN D", start: 22, end: 26 },
          { name: "FINAL", start: 26, end: 30 }
        ]),
        chords: [
          chord(2, "Em"),
          chord(6, "G"),
          chord(10, "Bm"),
          chord(14, "Em", 0.019),
          chord(18, "G", 0.019),
          chord(22, "Bm", 0.019),
          chord(26, "C")
        ]
      },
      { identity: "chords" }
    );

    expect(form.blocks.map((block) => block.name)).toEqual([
      "COUNT",
      "ARA",
      "SAN A",
      "SAN D",
      "FINAL"
    ]);
    expect(form.blocks.find((block) => block.name === "ARA")?.segno).toBe(true);
    expect(form.blocks.find((block) => block.name === "SAN D")?.ds).toBe(true);
    expect(form.blocks.find((block) => block.name === "SAN D")?.toCoda).toBe(false);
    expect(form.blocks.find((block) => block.name === "FINAL")?.coda).toBe(false);
  });

  it("keeps a second-cycle ARA on the first when a hit sits on the bar line", () => {
    const note = (time: number) => ({ time, pitch: 60, numerator: 4, denominator: 4 });
    const form = songForm(
      {
        ...song([
          { name: "COUNT", start: 0, end: 2 },
          { name: "ARA", start: 2, end: 6 },
          { name: "ARA", start: 6, end: 10 },
          { name: "SAN D", start: 10, end: 14 },
          { name: "ARA", start: 14, end: 18 },
          { name: "ARA", start: 18, end: 22 },
          { name: "SAN D", start: 22, end: 26 },
          { name: "FINAL", start: 26, end: 28 }
        ]),
        chords: [
          { time: 2, text: "Em", measure: 2, notes: [note(2)] },
          { time: 3.765, text: "C", measure: 2, notes: [note(4)] },
          { time: 6, text: "D", measure: 4, notes: [note(6)] },
          { time: 10, text: "Bm", measure: 6, notes: [note(10)] },
          { time: 14, text: "Em", measure: 8, notes: [note(14)] },
          { time: 15.765, text: "C", measure: 8, notes: [note(16 - 0.01)] },
          { time: 18, text: "D", measure: 10, notes: [note(18)] },
          { time: 22, text: "Bm", measure: 12, notes: [note(22)] },
          { time: 26, text: "C", measure: 14, notes: [note(26)] }
        ]
      },
      { identity: "chords" }
    );
    expect(form.blocks.map((block) => block.name)).toEqual([
      "COUNT",
      "ARA",
      "ARA",
      "SAN D",
      "FINAL"
    ]);
    expect(form.blocks.find((block) => block.name === "ARA")?.segno).toBe(true);
    expect(form.blocks.find((block) => block.name === "SAN D")?.ds).toBe(true);
  });

  it("maps a later ARA pass onto the matching written ARA", () => {
    const form = songForm(biz);
    const first = formAt(form, 96);
    expect(first?.block.name).toBe("ARA");
    expect(first?.block.originStart).toBe(2);
    expect(first?.visit.pass).toBe(2);
    expect(first?.visit.fromJump).toBe("ds");
    expect(first?.originTime).toBeCloseTo(8, 5);
    const second = formAt(form, 110);
    expect(second?.block.name).toBe("ARA");
    expect(second?.block.originStart).toBe(16);
    expect(second?.originTime).toBeCloseTo(22, 5);
  });

  it("writes consecutive same-name sections separately even when the groove matches", () => {
    const form = songForm({
      ...biz,
      patterns: [
        { text: "SURMAT", time: 2, end: 16, length: 14, measure: 2, numerator: 4, denominator: 4, notes: [] },
        { text: "SURMAT", time: 16, end: 30, length: 14, measure: 10, numerator: 4, denominator: 4, notes: [] }
      ]
    });
    const aras = form.blocks.filter((block) => block.name === "ARA");
    expect(aras).toHaveLength(2);
    expect(aras[0]?.repeatStart).toBe(false);
    expect(aras[0]?.repeatEnd).toBe(false);
    expect(aras[1]?.repeatStart).toBe(false);
    expect(aras[1]?.repeatEnd).toBe(false);
    expect(aras[0]?.originStart).toBe(2);
    expect(aras[1]?.originStart).toBe(16);
  });

  it("keeps same-name sections with different grooves as separate written blocks", () => {
    const form = songForm({
      ...biz,
      patterns: [
        { text: "TUS", time: 2, end: 16, length: 14, measure: 2, numerator: 4, denominator: 4, notes: [] },
        { text: "SURMAT", time: 16, end: 30, length: 14, measure: 10, numerator: 4, denominator: 4, notes: [] },
        { text: "TUS", time: 90, end: 104, length: 14, measure: 50, numerator: 4, denominator: 4, notes: [] },
        { text: "SURMAT", time: 104, end: 118, length: 14, measure: 58, numerator: 4, denominator: 4, notes: [] }
      ]
    });
    expect(form.blocks.map((block) => block.name)).toEqual(["COUNT", "ARA", "ARA", "SAN", "CEV", "FINAL"]);
    expect(formAt(form, 96)?.block.originStart).toBe(2);
    expect(formAt(form, 110)?.block.originStart).toBe(16);
  });

  it("writes repeated section pairs separately when the leading groove changes", () => {
    const pattern = (text: string, time: number, end: number) => ({
      text,
      time,
      end,
      length: end - time,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: []
    });
    const form = songForm({
      ...biz,
      patterns: [
        pattern("DISCO", 30, 56),
        pattern("DISCO", 56, 58),
        pattern("SENKOP", 58, 60),
        pattern("SURMAT", 60, 86),
        pattern("DISCO", 86, 88),
        pattern("SENKOP", 88, 90),
        pattern("DISCO", 118, 144),
        pattern("DISCO", 144, 146),
        pattern("SENKOP", 146, 148),
        pattern("SURMAT", 148, 170)
      ]
    });

    expect(form.blocks.filter((block) => block.name === "SAN").map((block) => block.originStart)).toEqual([
      30,
      60
    ]);
    expect(form.blocks.filter((block) => block.name === "CEV").map((block) => block.originStart)).toEqual([
      56,
      86
    ]);
    expect(form.blocks.some((block) => block.repeatStart || block.repeatEnd)).toBe(false);
    expect(formAt(form, 120)?.block.originStart).toBe(30);
    expect(formAt(form, 145)?.block.originStart).toBe(56);
    expect(formAt(form, 150)?.block.originStart).toBe(60);
  });

  it("writes the last of a same-name pair separately when it ends on a rallentando", () => {
    const pattern = (text: string, time: number, end: number) => ({
      text,
      time,
      end,
      length: end - time,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: []
    });
    const form = songForm(
      {
        ...song([
          { name: "COUNT", start: 0, end: 2 },
          { name: "ARA", start: 2, end: 16 },
          { name: "NAK", start: 16, end: 30 },
          { name: "NAK", start: 30, end: 44 },
          { name: "ARA", start: 44, end: 58 },
          { name: "NAK", start: 58, end: 72 },
          { name: "NAK", start: 72, end: 90 }
        ]),
        patterns: [
          pattern("ROCK", 2, 16),
          pattern("ZILLER", 16, 30),
          pattern("ROCK", 30, 44),
          pattern("ROCK", 44, 58),
          pattern("ZILLER", 58, 72),
          // The song ends on a rallentando the earlier pass does not play.
          pattern("ROCK", 72, 80),
          pattern("SLOW", 80, 86),
          pattern("TUS", 86, 90)
        ]
      },
      { identity: "drums" }
    );

    const naks = form.blocks.filter((block) => block.name === "NAK");
    expect(naks.map((block) => block.originStart)).toEqual([16, 30, 72]);
    expect(formAt(form, 84)?.block.originStart).toBe(72);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("does not hang a coda on a mid-song SAN that only adds a drum layer after D.S.", () => {
    const pattern = (text: string, time: number, end: number) => ({
      text,
      time,
      end,
      length: end - time,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: []
    });
    const form = songForm(
      {
        ...song([
          { name: "COUNT", start: 0, end: 2 },
          { name: "ARA", start: 2, end: 10 },
          { name: "SAN A", start: 10, end: 18 },
          { name: "NAK", start: 18, end: 26 },
          { name: "ARA", start: 26, end: 34 },
          { name: "SAN A", start: 34, end: 42 },
          { name: "NAK", start: 42, end: 50 }
        ]),
        patterns: [
          pattern("HALAY TOM", 2, 4),
          pattern("TUS", 10, 12),
          pattern("TERS KICK", 12, 14),
          pattern("HALAY TOM", 18, 20),
          pattern("HALAY TOM", 26, 28),
          pattern("TUS", 34, 36),
          pattern("TERS KICK", 36, 38),
          pattern("TERS KICK LATIN", 36, 38),
          pattern("HALAY TOM", 42, 44)
        ]
      },
      { identity: "drums" }
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["COUNT", "ARA", "SAN A", "NAK"]);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("keeps a last NAK on the written bars when only the rall stretches its chords", () => {
    const chord = (time: number, text: string) => ({
      time,
      text,
      measure: 1,
      notes: [{ time, pitch: 48, numerator: 4, denominator: 4 }]
    });
    const form = songForm(
      {
        ...song([
          { name: "COUNT", start: 0, end: 2 },
          { name: "ARA", start: 2, end: 6 },
          { name: "SAN B", start: 6, end: 10 },
          { name: "NAK", start: 10, end: 16 },
          { name: "ARA", start: 16, end: 20 },
          { name: "SAN B", start: 20, end: 24 },
          { name: "NAK", start: 24, end: 31 }
        ]),
        chords: [
          chord(2, "Em"),
          chord(6, "G"),
          chord(10, "E"),
          chord(12, "Am"),
          chord(14, "Bm"),
          chord(16, "Em"),
          chord(20, "G"),
          chord(24, "E"),
          chord(26.2, "Am"),
          chord(28.8, "Bm")
        ]
      },
      { identity: "chords" }
    );

    expect(form.blocks.map((block) => block.name)).toEqual(["COUNT", "ARA", "SAN B", "NAK"]);
    expect(form.blocks.find((block) => block.name === "ARA")?.segno).toBe(true);
    expect(form.blocks.find((block) => block.name === "NAK")?.ds).toBe(true);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("does not write new sections after D.S. when the return pass uses a different groove", () => {
    const pattern = (text: string, time: number, end: number) => ({
      text,
      time,
      end,
      length: end - time,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: []
    });
    const form = songForm({
      ...song([
        { name: "COUNT", start: 0, end: 2 },
        { name: "ARA", start: 2, end: 16 },
        { name: "ARA", start: 16, end: 30 },
        { name: "SAN", start: 30, end: 56 },
        { name: "CEV", start: 56, end: 60 },
        { name: "SAN", start: 60, end: 86 },
        { name: "CEV+ FINAL", start: 86, end: 90 },
        { name: "ARA", start: 90, end: 104 },
        { name: "ARA", start: 104, end: 118 },
        { name: "SAN", start: 118, end: 144 },
        { name: "CEV", start: 144, end: 148 },
        { name: "SAN", start: 148, end: 174 },
        { name: "CEV+ FINAL", start: 174, end: 178 }
      ]),
      patterns: [
        pattern("DISCO", 30, 56),
        pattern("SURMAT", 60, 86),
        pattern("SURMAT", 118, 144),
        pattern("SURMAT", 148, 174)
      ]
    });

    expect(form.blocks.map((block) => block.name)).toEqual([
      "COUNT",
      "ARA",
      "ARA",
      "SAN",
      "CEV",
      "SAN",
      "CEV+ FINAL"
    ]);
    expect(form.blocks.find((block) => block.name === "CEV+ FINAL")?.ds).toBe(true);
    expect(form.blocks.filter((block) => block.ds)).toHaveLength(1);
    expect(formAt(form, 120)?.block.originStart).toBe(30);
    expect(formAt(form, 150)?.block.originStart).toBe(60);
    expect(formAt(form, 175)?.block.name).toBe("CEV+ FINAL");
  });

  it("can compact sections by name for a chord chart despite drum-groove changes", () => {
    const form = songForm(
      {
        ...biz,
        patterns: [
          { text: "DISCO", time: 30, end: 56, length: 26, measure: 1, numerator: 4, denominator: 4, notes: [] },
          { text: "SURMAT", time: 60, end: 86, length: 26, measure: 1, numerator: 4, denominator: 4, notes: [] }
        ]
      },
      { identity: "names" }
    );

    expect(form.blocks.filter((block) => block.name === "SAN")).toHaveLength(1);
    expect(form.blocks.filter((block) => block.name === "CEV")).toHaveLength(1);
    expect(form.blocks.find((block) => block.name === "SAN")?.repeatStart).toBe(true);
    expect(form.blocks.find((block) => block.name === "CEV")?.repeatEnd).toBe(true);
  });

  it("keeps same-name chord sections separate when their notes differ", () => {
    const form = songForm(
      {
        ...song([
          { name: "SAN", start: 0, end: 4 },
          { name: "CEV", start: 4, end: 8 },
          { name: "SAN", start: 8, end: 12 },
          { name: "CEV", start: 12, end: 16 }
        ]),
        chords: [
          {
            time: 0,
            measure: 1,
            text: "Dm",
            notes: [{ time: 0, pitch: 50, numerator: 4, denominator: 4 }]
          },
          { time: 4, measure: 3, text: "A" },
          {
            time: 8,
            measure: 5,
            text: "Dm",
            notes: [{ time: 8, pitch: 52, numerator: 4, denominator: 4 }]
          },
          { time: 12, measure: 7, text: "A" }
        ]
      },
      { identity: "chords" }
    );

    expect(form.blocks.map((block) => block.name)).toEqual(["SAN", "CEV", "SAN", "CEV"]);
    expect(form.blocks.some((block) => block.repeatStart || block.repeatEnd)).toBe(false);
  });

  it("reuses a written chord section when a later visit is its shortened prefix", () => {
    const form = songForm(
      {
        ...song([
          { name: "SAN", start: 0, end: 6 },
          { name: "CEV", start: 6, end: 10 },
          { name: "SAN", start: 10, end: 14 },
          { name: "FINAL", start: 14, end: 16 }
        ]),
        chords: [
          { time: 0, measure: 1, text: "Dm" },
          { time: 2, measure: 2, text: "Gm" },
          { time: 4, measure: 3, text: "A" },
          { time: 6, measure: 4, text: "Dm" },
          { time: 10, measure: 6, text: "Dm" },
          { time: 12, measure: 7, text: "Gm" },
          { time: 14, measure: 8, text: "Bb" }
        ]
      },
      { identity: "chords" }
    );

    expect(form.blocks.map((block) => block.name)).toEqual(["SAN", "CEV", "FINAL"]);
    expect(formAt(form, 12)?.block.originStart).toBe(0);
    const san = form.blocks.find((block) => block.name === "SAN");
    expect(san?.toCoda).toBe(false);
    expect(form.blocks.find((block) => block.name === "FINAL")?.coda).toBe(false);
  });

  it("folds a 4+4 inner repeat only when the view enables it", () => {
    const repeated = {
      ...song([{ name: "ARA", start: 0, end: 16 }]),
      chords: [
        {
          time: 0,
          end: 2,
          measure: 1,
          text: "Dm",
          notes: [
            { time: 0, end: 0.25, pitch: 50, numerator: 4, denominator: 4 }
          ]
        },
        { time: 2, end: 4, measure: 2, text: "Dm" },
        { time: 4, end: 6, measure: 3, text: "G" },
        { time: 6, end: 8, measure: 4, text: "Dm" },
        {
          time: 8,
          end: 10,
          measure: 5,
          text: "Dm",
          notes: [
            { time: 8, end: 8.25, pitch: 50, numerator: 4, denominator: 4 }
          ]
        },
        { time: 10, end: 12, measure: 6, text: "Dm" },
        { time: 12, end: 14, measure: 7, text: "G" },
        { time: 14, end: 16, measure: 8, text: "Dm" }
      ]
    };
    const form = songForm(repeated);
    const ara = form.blocks[0];
    expect(ara?.repeatStart).toBe(false);
    expect(ara?.repeatEnd).toBe(false);
    expect(ara?.originEnd).toBe(16);
    expect(formAt(form, 10)?.originTime).toBeCloseTo(10, 5);

    const chordForm = songForm(repeated, { foldInnerRepeats: true });
    const foldedAra = chordForm.blocks[0];
    expect(foldedAra?.repeatStart).toBe(true);
    expect(foldedAra?.repeatEnd).toBe(true);
    expect(foldedAra?.originEnd).toBe(8);
    expect(formAt(chordForm, 10)?.originTime).toBeCloseTo(2, 5);
  });

  it("keeps SAN, SAN A, and SAN B as separate written drum sections", () => {
    const pattern = (text: string, time: number, end: number) => ({
      text,
      time,
      end,
      length: end - time,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: [
        {
          time,
          end: time + 0.1,
          pitch: 48,
          channel: 0,
          velocity: 96,
          measure: 1,
          beat: 1,
          numerator: 4,
          denominator: 4
        }
      ]
    });
    const form = songForm(
      {
        ...song([
          { name: "SAN A", start: 0, end: 4 },
          { name: "SAN B", start: 4, end: 8 },
          { name: "SAN", start: 8, end: 12 },
          { name: "SAN A", start: 12, end: 16 }
        ]),
        patterns: [
          pattern("ZILLER", 0, 4),
          pattern("SLOW", 4, 8),
          pattern("DISCO", 8, 12),
          pattern("DISCO", 12, 16)
        ]
      },
      { identity: "drums" }
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["SAN A", "SAN B", "SAN", "SAN A"]);
  });

  it("puts segno on a repeating ARA / SAN A / NAK cycle when drum grids match", () => {
    const hit = (time: number) => ({
      time,
      end: time + 0.1,
      pitch: 48,
      channel: 0,
      velocity: 96,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4
    });
    const pattern = (text: string, time: number, end: number) => ({
      text,
      time,
      end,
      length: end - time,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: [hit(time)]
    });
    const form = songForm(
      {
        ...song([
          { name: "COUNT", start: 0, end: 2 },
          { name: "ARA", start: 2, end: 6 },
          { name: "SAN A", start: 6, end: 10 },
          { name: "NAK", start: 10, end: 14 },
          { name: "ARA", start: 14, end: 18 },
          { name: "SAN A", start: 18, end: 22 },
          { name: "NAK", start: 22, end: 26 }
        ]),
        patterns: [
          pattern("SLOW", 2, 6),
          pattern("ZILLER", 6, 10),
          pattern("SLOW", 10, 14),
          pattern("SLOW", 14, 18),
          pattern("ZILLER", 18, 22),
          pattern("SLOW", 22, 26)
        ]
      },
      { identity: "drums" }
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["COUNT", "ARA", "SAN A", "NAK"]);
    expect(form.blocks.find((block) => block.name === "ARA")?.segno).toBe(true);
    expect(form.blocks.find((block) => block.name === "SAN A")?.segno).toBe(false);
    expect(form.blocks.find((block) => block.name === "NAK")?.ds).toBe(true);
  });

  it("puts the segno on the first ARA when the repeat opens on the second ARA's drums", () => {
    const hit = (time: number, step: number) => ({
      time: time + step * 0.25,
      end: time + step * 0.25 + 0.1,
      pitch: 48,
      channel: 0,
      velocity: 96,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4
    });
    const pattern = (text: string, time: number, steps: number[]) => ({
      text,
      time,
      end: time + 4,
      length: 4,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: steps.map((step) => hit(time, step))
    });
    const form = songForm(
      {
        ...song([
          { name: "ARA", start: 0, end: 4 },
          { name: "ARA", start: 4, end: 8 },
          { name: "SAN", start: 8, end: 12 },
          { name: "NAK", start: 12, end: 16 },
          { name: "ARA", start: 16, end: 20 },
          { name: "ARA", start: 20, end: 24 },
          { name: "SAN", start: 24, end: 28 },
          { name: "NAK", start: 28, end: 32 }
        ]),
        patterns: [
          pattern("HALAY", 0, [0, 2]),
          pattern("HALAY", 4, [1, 3]),
          pattern("KICK", 8, [0]),
          pattern("HALAY", 12, [0]),
          pattern("HALAY", 16, [1, 3]),
          pattern("HALAY", 20, [0, 2]),
          pattern("KICK", 24, [0]),
          pattern("HALAY", 28, [0])
        ]
      },
      { identity: "drums" }
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["ARA", "ARA", "SAN", "NAK"]);
    expect(form.blocks[0]?.segno).toBe(true);
    expect(form.blocks[1]?.segno).toBe(false);
    expect(form.blocks.find((block) => block.name === "NAK")?.ds).toBe(true);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("keeps Lorke's repeat as a D.S. when the sticking changes", () => {
    const hit = (time: number, step: number) => ({
      time: time + step * 0.25,
      end: time + step * 0.25 + 0.1,
      pitch: 48,
      channel: 0,
      velocity: 96,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4
    });
    const pattern = (text: string, time: number, steps: number[]) => ({
      text,
      time,
      end: time + 4,
      length: 4,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: steps.map((step) => hit(time, step))
    });
    const form = songForm(
      {
        ...song([
          { name: "ARA", start: 0, end: 4 },
          { name: "ARA", start: 4, end: 8 },
          { name: "SAN", start: 8, end: 12 },
          { name: "NAK", start: 12, end: 16 },
          { name: "NAK", start: 16, end: 20 },
          { name: "ARA", start: 20, end: 24 },
          { name: "ARA", start: 24, end: 28 },
          { name: "SAN", start: 28, end: 32 },
          { name: "NAK", start: 32, end: 36 },
          { name: "NAK", start: 36, end: 40 }
        ]),
        patterns: [
          pattern("HALAY TOM II", 0, [0, 2]),
          pattern("HALAY TOM II", 4, [0, 2]),
          pattern("KICK", 8, [0]),
          pattern("HALAY TOM II", 12, [1, 3]),
          pattern("HALAY TOM II", 16, [1, 3]),
          pattern("HALAY TOM II", 20, [1, 3]),
          pattern("HALAY TOM II", 24, [1, 3]),
          pattern("KICK", 28, [0]),
          pattern("HALAY TOM II", 32, [0, 4]),
          pattern("HALAY TOM II", 36, [2, 6])
        ]
      },
      { identity: "drums" }
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["ARA", "ARA", "SAN", "NAK", "NAK"]);
    expect(form.blocks[0]?.segno).toBe(true);
    expect(form.blocks[1]?.segno).toBe(false);
    expect(form.blocks.find((block) => block.name === "NAK" && block.ds)?.ds).toBe(true);
    expect(form.blocks.filter((block) => block.name === "NAK").map((block) => block.ds)).toEqual([
      false,
      true
    ]);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("writes a second pass when the same section names have different drum grids", () => {
    const hit = (time: number, pitch: number) => ({
      time,
      end: time + 0.1,
      pitch,
      channel: 0,
      velocity: 96,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4
    });
    const pattern = (text: string, time: number, end: number, pitch: number) => ({
      text,
      time,
      end,
      length: end - time,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes: [hit(time, pitch)]
    });
    const form = songForm(
      {
        ...song([
          { name: "ARA", start: 0, end: 4 },
          { name: "SAN", start: 4, end: 8 },
          { name: "NAK", start: 8, end: 12 },
          { name: "ARA", start: 12, end: 16 },
          { name: "SAN", start: 16, end: 20 },
          { name: "NAK", start: 20, end: 24 }
        ]),
        patterns: [
          pattern("ZILLER", 0, 4, 48),
          pattern("DISCO", 4, 8, 48),
          pattern("SLOW", 8, 12, 48),
          pattern("DISCO", 12, 16, 50),
          pattern("DISCO", 16, 20, 48),
          pattern("SLOW", 20, 24, 48)
        ]
      },
      { identity: "drums" }
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["ARA", "SAN", "NAK", "ARA", "SAN", "NAK"]);
    expect(form.blocks.some((block) => block.segno || block.ds)).toBe(false);
  });

  it("does not write a coda when a later NAK only moves the FILL", () => {
    const hit = (time: number) => ({
      time,
      end: time + 0.1,
      pitch: 48,
      channel: 0,
      velocity: 96,
      measure: 1,
      beat: 1,
      numerator: 4,
      denominator: 4
    });
    const pattern = (text: string, time: number, end: number, notes: ReturnType<typeof hit>[]) => ({
      text,
      time,
      end,
      length: end - time,
      measure: 1,
      numerator: 4,
      denominator: 4,
      notes
    });
    const form = songForm(
      {
        ...song([
          { name: "ARA", start: 0, end: 4 },
          { name: "NAK", start: 4, end: 22 },
          { name: "ARA", start: 22, end: 26 },
          { name: "NAK", start: 26, end: 44.5 }
        ]),
        patterns: [
          pattern("TUS", 0, 2, [hit(0)]),
          pattern("ROCK", 4, 6, [hit(4)]),
          pattern("FILL", 20, 22, []),
          pattern("TUS", 22, 24, [hit(22)]),
          pattern("ROCK", 26, 28, [hit(26)]),
          pattern("FILL", 36, 38, [])
        ]
      },
      { identity: "drums" }
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["ARA", "NAK"]);
    expect(form.blocks.some((block) => block.coda || block.toCoda)).toBe(false);
  });

  it("marks the first return as senyo, not every repeated section", () => {
    const form = songForm(
      song([
        { name: "BOS", start: 0, end: 2 },
        { name: "ARA 1", start: 2, end: 14 },
        { name: "A 1", start: 14, end: 26 },
        { name: "NAK", start: 26, end: 38 },
        { name: "ARA 1", start: 38, end: 50 },
        { name: "A 1", start: 50, end: 62 }
      ])
    );
    expect(form.blocks.map((block) => block.name)).toEqual(["BOS", "ARA 1", "A 1", "NAK"]);
    expect(form.blocks.find((block) => block.name === "ARA 1")?.segno).toBe(true);
    expect(form.blocks.find((block) => block.name === "A 1")?.segno).toBe(false);
    expect(form.blocks.find((block) => block.name === "NAK")?.ds).toBe(true);
  });

  it("sends next from the CEV repeat back to SAN, then D.S. to the first ARA", () => {
    const form = songForm(biz);
    const afterRepeat = formNextAt(form, 58, 60);
    expect(afterRepeat?.block.name).toBe("SAN");
    expect(afterRepeat?.block.originStart).toBe(30);
    expect(afterRepeat?.visit.fromJump).toBe("repeat");
    const afterDs = formNextAt(form, 88, 90);
    expect(afterDs?.block.name).toBe("ARA");
    expect(afterDs?.block.originStart).toBe(2);
    expect(afterDs?.visit.fromJump).toBe("ds");
  });

  it("does not wrap next inside a section that used to be a 4+4 fold", () => {
    const form = songForm({
      ...song([{ name: "ARA", start: 0, end: 16 }]),
      chords: [
        { time: 0, end: 2, measure: 1, text: "Dm" },
        { time: 2, end: 4, measure: 2, text: "Dm" },
        { time: 4, end: 6, measure: 3, text: "G" },
        { time: 6, end: 8, measure: 4, text: "Dm" },
        { time: 8, end: 10, measure: 5, text: "Dm" },
        { time: 10, end: 12, measure: 6, text: "Dm" },
        { time: 12, end: 14, measure: 7, text: "G" },
        { time: 14, end: 16, measure: 8, text: "Dm" }
      ]
    });
    const next = formNextAt(form, 7, 8);
    expect(next?.block.name).toBe("ARA");
    expect(next?.originTime).toBeCloseTo(8, 5);
    const nearEnd = formNextAt(form, 7.4, 7.99);
    expect(nearEnd?.originTime).toBeCloseTo(7.99, 5);
  });
});
