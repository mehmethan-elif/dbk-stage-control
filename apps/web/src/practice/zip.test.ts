import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { entriesFromZip } from "./zip";

describe("practice zip", () => {
  it("imports song folders and ignores stems", () => {
    const bytes = zipSync({
      "Biz/song.json": strToU8('{"id":"Biz","title":"Biz"}'),
      "Biz/Master.mp3": new Uint8Array([1, 2, 3]),
      "Biz/Bass.flac": new Uint8Array([9]),
      "Biz/Click.flac": new Uint8Array([8])
    });
    const entries = entriesFromZip(bytes);
    expect(entries.map((entry) => `${entry.folder}/${entry.path}`).sort()).toEqual([
      "Biz/Master.mp3",
      "Biz/song.json"
    ]);
  });

  it("keeps Turkish folder names composed", () => {
    const nfd = "Evvel Zaman İçinde";
    const bytes = zipSync({
      [`${nfd}/song.json`]: strToU8('{"id":"evvel_zaman_i_c_inde","title":"Evvel Zaman İçinde"}'),
      [`${nfd}/Master.mp3`]: new Uint8Array([1, 2, 3])
    });
    const entries = entriesFromZip(bytes);
    expect(entries.every((entry) => entry.folder === "Evvel Zaman İçinde")).toBe(true);
  });
});
