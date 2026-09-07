import { readFileSync } from "node:fs";
import { publishClientLibrary } from "../host/src/publish-client-library.ts";

const gigsPath = process.argv[2];
let gigs = [];
if (gigsPath) {
  const raw = JSON.parse(readFileSync(gigsPath, "utf8"));
  gigs = Array.isArray(raw) ? raw : (raw.gigs ?? []);
}
const result = publishClientLibrary(gigs);
console.log(
  `[DBK] Published ${result.songs} songs, ${result.files} files, ${result.gigs} gigs → ${result.root}`
);
