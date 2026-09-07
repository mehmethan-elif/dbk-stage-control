import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SAMPLE_RATE = 44100;

function writeWav(path, durationSec, renderSample) {
  const samples = Math.floor(durationSec * SAMPLE_RATE);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const sample = Math.max(-1, Math.min(1, renderSample(t, i)));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

function backingTone(duration, freq) {
  return (t) => {
    const env = t < 0.02 ? t / 0.02 : t > duration - 0.05 ? Math.max(0, (duration - t) / 0.05) : 1;
    return Math.sin(2 * Math.PI * freq * t) * 0.18 * env;
  };
}

function clickTrack(duration, bpm = 120) {
  const interval = 60 / bpm;
  return (t) => {
    const phase = t % interval;
    if (phase < 0.012) {
      return Math.sin(2 * Math.PI * 1000 * t) * (1 - phase / 0.012) * 0.55;
    }
    return 0;
  };
}

function musicXml(partName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>${partName}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>${partName}</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>
`;
}

function writeText(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

const songs = [
  { id: "song_001", backing: 12, click: 8, freq: 196 },
  { id: "song_002", backing: 10, click: 8, freq: 220 },
  { id: "song_004", backing: 8, click: 6, freq: 164 },
  { id: "song_005", backing: 8, click: 6, freq: 246 },
  { id: "song_006", backing: 6, click: 5, freq: 174 },
  { id: "song_007", backing: 8, click: 6, freq: 130 },
  { id: "song_008", backing: 8, click: 6, freq: 146 }
];

for (const song of songs) {
  const dir = join(ROOT, "library/songs", song.id);
  writeWav(join(dir, "backing.wav"), song.backing, backingTone(song.backing, song.freq));
  writeWav(join(dir, "click.wav"), song.click, clickTrack(song.click));
  writeWav(join(ROOT, "testdata/audio", `${song.id}_backing.wav`), song.backing, backingTone(song.backing, song.freq));
  writeWav(join(ROOT, "testdata/audio", `${song.id}_click.wav`), song.click, clickTrack(song.click));
}

const xmlSongs = {
  song_001: ["guitar", "baglama", "kaval"],
  song_002: ["guitar", "baglama", "kaval"],
  song_004: ["guitar", "baglama", "kaval"],
  song_005: ["guitar", "kaval"],
  song_006: ["guitar", "baglama", "kaval"],
  song_007: ["guitar", "baglama", "kaval"],
  song_008: ["guitar", "baglama", "kaval"]
};

const labels = { guitar: "Guitar", baglama: "Baglama", kaval: "Kaval" };

for (const [id, roles] of Object.entries(xmlSongs)) {
  for (const role of roles) {
    writeText(
      join(ROOT, "library/songs", id, `${role}.musicxml`),
      musicXml(labels[role])
    );
  }
}

const lyrics = {
  song_001: [
    { time: 0, measure: 1, beat: 1, text: "Night falls on the city" },
    { time: 4, measure: 3, beat: 1, text: "Lights along the water" },
    { time: 8, measure: 5, beat: 1, text: "We begin again" }
  ],
  song_002: [
    { time: 0, measure: 1, beat: 1, text: "Galata in the morning" },
    { time: 4, measure: 3, beat: 1, text: "The bridge is waking" },
    { time: 8, measure: 5, beat: 1, text: "Hold the line" }
  ],
  song_005: [
    { time: 0, measure: 1, beat: 1, text: "Stone and sky" },
    { time: 4, measure: 3, beat: 1, text: "Open road" }
  ],
  song_006: [
    { time: 0, measure: 1, beat: 1, text: "Eastbound at dusk" },
    { time: 3, measure: 2, beat: 3, text: "Keep the tempo" }
  ],
  song_007: [
    { time: 0, measure: 1, beat: 1, text: "Wind off the water" }
  ],
  song_008: [
    { time: 0, measure: 1, beat: 1, text: "Black sea line" }
  ]
};

for (const [id, lines] of Object.entries(lyrics)) {
  writeText(join(ROOT, "library/songs", id, "lyrics.json"), JSON.stringify({ lyrics: lines }, null, 2) + "\n");
}

console.log("Wrote fixture WAVs, MusicXML, and lyrics.");
