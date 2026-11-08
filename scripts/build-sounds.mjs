// Convertit les sons enregistrés de assets-source/sounds (voir import-assets.sh) en fichiers légers pour le web,
// d'après le catalogue packages/client/src/audio/samples.json : public/sounds/<groupe>_<n>.m4a.
// Chaque son est passé en mono, ramené au même niveau de crête, puis encodé en AAC (lu par tous les navigateurs).
// Usage : node scripts/build-sounds.mjs (outil requis : afconvert, fourni avec macOS)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "assets-source/sounds");
const OUT = path.join(ROOT, "packages/client/public/sounds");
const CATALOG = path.join(ROOT, "packages/client/src/audio/samples.json");

const SAMPLE_RATE = 44100;
// Niveau de crête visé (un peu sous le maximum), et gain maximal appliqué à un son très faible.
const PEAK = 0.9;
const MAX_GAIN = 20;
const BITRATE = 96000;

// Musiques, gardées en stéréo et mieux encodées. Le jeu boucle sur la durée indiquée dans public/music/index.json :
// la durée d'origine pour une boucle faite pour s'enchaîner, ou la fin du son pour un morceau complet
// (trim : le silence final est coupé, le morceau reprend aussitôt).
const MUSIC = {
  lastEncounter: { source: "music/The Last Encounter Long Loop.wav" },
  woodlandFantasy: { source: "music/Woodland Fantasy.mp3", trim: true },
};
// Seuil sous lequel la fin d'un morceau est considérée comme du silence.
const SILENCE = 0.002;
const MUSIC_OUT = path.join(ROOT, "packages/client/public/music");
const MUSIC_BITRATE = 160000;

const { groups } = JSON.parse(readFileSync(CATALOG, "utf8"));
const work = mkdtempSync(path.join(tmpdir(), "arena-sounds-"));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let total = 0;
let count = 0;
// Nombre de variantes de chaque groupe, lu par le jeu (public/sounds/index.json).
const index = {};
for (const [id, group] of Object.entries(groups)) {
  const files = group.files.flatMap(expand);
  if (!files.length) throw new Error(`${id} : aucun fichier pour ${group.files.join(", ")}`);
  files.forEach((file, i) => {
    const wav = path.join(work, "in.wav");
    const normalized = path.join(work, "normalized.wav");
    const target = path.join(OUT, `${id}_${i}.m4a`);
    execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "1", file, wav]);
    normalize(wav, normalized);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", String(BITRATE), normalized, target]);
    total += statSync(target).size;
    count++;
  });
  index[id] = files.length;
  console.log(`${id.padEnd(20)} ${files.length} variante(s)`);
}
rmSync(work, { recursive: true, force: true });
writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`${count} fichiers, ${(total / 1024 / 1024).toFixed(2)} Mo`);

rmSync(MUSIC_OUT, { recursive: true, force: true });
mkdirSync(MUSIC_OUT, { recursive: true });
const musicIndex = {};
for (const [id, { source, trim }] of Object.entries(MUSIC)) {
  const input = path.join(ROOT, "assets-source", source);
  const info = execFileSync("afinfo", [input]).toString();
  const duration = trim ? soundEnd(input) : Number(/estimated duration: ([\d.]+)/.exec(info)[1]);
  const target = path.join(MUSIC_OUT, `${id}.m4a`);
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", String(MUSIC_BITRATE), input, target]);
  musicIndex[id] = { duration };
  console.log(`musique ${id} : ${duration.toFixed(2)} s, ${(statSync(target).size / 1024 / 1024).toFixed(2)} Mo`);
}
writeFileSync(path.join(MUSIC_OUT, "index.json"), JSON.stringify(musicIndex, null, 2) + "\n");

// Instant où le son se termine vraiment, avant le silence final (en secondes).
function soundEnd(input) {
  const work = mkdtempSync(path.join(tmpdir(), "arena-music-"));
  const wav = path.join(work, "music.wav");
  execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "1", input, wav]);
  const buffer = readFileSync(wav);
  const { offset, length } = dataChunk(buffer);
  let last = offset;
  for (let i = offset; i < offset + length; i += 2) if (Math.abs(buffer.readInt16LE(i)) > SILENCE * 32768) last = i;
  rmSync(work, { recursive: true, force: true });
  return (last - offset) / 2 / SAMPLE_RATE + 0.05;
}

// Motif "dossier/nom*.ext" : les fichiers du dossier qui correspondent, triés.
function expand(pattern) {
  const dir = path.join(SOURCE, path.dirname(pattern));
  const regex = new RegExp(`^${path.basename(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return readdirSync(dir)
    .filter((name) => regex.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(dir, name));
}

// Ramène la crête d'un WAV 16 bits mono à PEAK.
function normalize(input, output) {
  const buffer = readFileSync(input);
  const { offset, length } = dataChunk(buffer);
  let peak = 1;
  for (let i = offset; i < offset + length; i += 2) peak = Math.max(peak, Math.abs(buffer.readInt16LE(i)));
  const gain = Math.min(MAX_GAIN, (PEAK * 32767) / peak);
  for (let i = offset; i < offset + length; i += 2) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buffer.readInt16LE(i) * gain))), i);
  }
  writeFileSync(output, buffer);
}

// Position et taille des échantillons dans un fichier WAV (bloc "data").
function dataChunk(buffer) {
  let position = 12;
  while (position < buffer.length) {
    const name = buffer.toString("ascii", position, position + 4);
    const size = buffer.readUInt32LE(position + 4);
    if (name === "data") return { offset: position + 8, length: size };
    position += 8 + size + (size % 2);
  }
  throw new Error("WAV sans données");
}
