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
    expect(san?.toCoda).toBe(true);
    expect(final?.coda).toBe(true);
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
    expect(san?.toCoda).toBe(true);
    expect(san?.toCodaAt).toBe(4);
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
