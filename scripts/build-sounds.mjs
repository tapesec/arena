// Convertit les sons enregistrés de assets-source/sounds (voir import-assets.sh) en fichiers légers pour le web,
// d'après le catalogue packages/client/src/audio/samples.json : public/sounds/<groupe>_<n>.m4a.
// Chaque son est passé en mono, ramené au même niveau de crête, puis encodé en AAC (lu par tous les navigateurs).
// Usage : node scripts/build-sounds.mjs (outil requis : afconvert, fourni avec macOS)
//         node scripts/build-sounds.mjs --tuned : seulement les sons des pistes de compétences réglées (public/sounds/tuned),
//         sans réencoder le reste (l'encodeur ne donne pas deux fois exactement le même fichier).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
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
// Fondu de sortie d'un son coupé par maxDuration (en secondes).
const TRIM_FADE = 0.2;

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
// Sons du catalogue utilisés par les pistes des compétences réglées (animationTuning.json, page de réglage) :
// public/sounds/tuned/<nom>.m4a, lus par AudioManager.playTrack. Mono, au volume d'origine (tel qu'écouté et réglé
// sur la page de réglage) ; un morceau d'une piste découpée est coupé à sa portion ; un son « intact » (licence
// CC BY-ND) est seulement changé de format (ni mono, ni découpe).
const tuning = JSON.parse(readFileSync(path.join(ROOT, "packages/client/src/game/animationTuning.json"), "utf8"));
const soundCatalog = JSON.parse(readFileSync(path.join(ROOT, "packages/client/src/audio/soundCatalog.json"), "utf8"));
const used = new Set();
for (const entries of Object.values(tuning)) {
  for (const entry of Object.values(entries)) {
    const tracks = [entry.effects, entry.projectile?.effects, entry.impact?.effects, entry.status, entry.zone];
    for (const effect of tracks.flat()) if (effect?.type === "sound" && !effect.recipe.startsWith("jeu:")) used.add(effect.recipe);
  }
}
// Et les sons du catalogue choisis à la place des sons communs (onglet « Sons communs », commonSounds.json).
const commonSounds = JSON.parse(readFileSync(path.join(ROOT, "packages/client/src/audio/commonSounds.json"), "utf8"));
// Un son retiré (recette vide) n'a pas de fichier.
// Variantes comprises.
for (const choice of Object.values(commonSounds)) {
  for (const recipe of [choice.recipe, ...(choice.variants ?? [])]) if (recipe && !recipe.startsWith("jeu:")) used.add(recipe);
}
// Vérifiés avant de toucher à quoi que ce soit (un nom inconnu arrêterait sinon le script à mi-chemin).
for (const name of used) {
  if (!soundCatalog.some((s) => s.name === name)) throw new Error(`Son de compétence introuvable dans le catalogue : ${name}`);
}

const TUNED_ONLY = process.argv.includes("--tuned");
if (!TUNED_ONLY) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let total = 0;
let count = 0;
// Nombre de variantes de chaque groupe, lu par le jeu (public/sounds/index.json).
const index = {};
for (const [id, group] of TUNED_ONLY ? [] : Object.entries(groups)) {
  const files = group.files.flatMap(expand);
  if (!files.length) throw new Error(`${id} : aucun fichier pour ${group.files.join(", ")}`);
  files.forEach((file, i) => {
    const wav = path.join(work, "in.wav");
    const normalized = path.join(work, "normalized.wav");
    const target = path.join(OUT, `${id}_${i}.m4a`);
    execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "1", file, wav]);
    normalize(wav, normalized, group.maxDuration);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", String(BITRATE), normalized, target]);
    total += statSync(target).size;
    count++;
  });
  index[id] = files.length;
  console.log(`${id.padEnd(20)} ${files.length} variante(s)`);
}
const TUNED_OUT = path.join(OUT, "tuned");
rmSync(TUNED_OUT, { recursive: true, force: true });
mkdirSync(TUNED_OUT, { recursive: true });
// Sons dont la licence demande d'empêcher leur extraction : réunis dans un seul conteneur brouillé
// (tuned/protected.bin), décodé en mémoire par AudioManager, au lieu de fichiers séparés.
const protectedParts = [];
for (const name of used) {
  const sound = soundCatalog.find((s) => s.name === name);
  const input = path.join(SOURCE, sound.file);
  const target = sound.protected ? path.join(work, "protected.m4a") : path.join(TUNED_OUT, `${name}.m4a`);
  if (sound.intact) {
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "128000", input, target]);
  } else {
    // Mono, au volume d'origine (comme l'écoute de la page de réglage, où son volume a été réglé).
    const wav = path.join(work, "tuned.wav");
    execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "1", input, wav]);
    if (sound.parent) slice(wav, sound.start, sound.end);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", String(BITRATE), wav, target]);
  }
  total += statSync(target).size;
  count++;
  if (sound.protected) protectedParts.push({ name, data: readFileSync(target) });
  console.log(`son de compétence ${name}${sound.protected ? " (protégé)" : ""}`);
}
if (protectedParts.length) {
  // En-tête « ARSP », taille de l'index, puis index { nom: [début, longueur] } et sons, le tout brouillé.
  let offset = 0;
  const index = {};
  for (const part of protectedParts) {
    index[part.name] = [offset, part.data.length];
    offset += part.data.length;
  }
  const indexBytes = Buffer.from(JSON.stringify(index), "utf8");
  const body = Buffer.concat([indexBytes, ...protectedParts.map((part) => part.data)]);
  scramble(body);
  const head = Buffer.alloc(8);
  head.write("ARSP", 0, "ascii");
  head.writeUInt32LE(indexBytes.length, 4);
  writeFileSync(path.join(TUNED_OUT, "protected.bin"), Buffer.concat([head, body]));
  console.log(`conteneur protégé : ${protectedParts.length} son(s)`);
}

rmSync(work, { recursive: true, force: true });
if (!TUNED_ONLY) writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
if (TUNED_ONLY) {
  console.log(`${count} son(s) de compétence, ${(total / 1024).toFixed(0)} Ko`);
  process.exit(0);
}
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

// Clé du conteneur des sons protégés : VITE_SOUND_KEY, dans packages/client/.env.local (non versionné : le dépôt est
// public) ou dans l'environnement.
function soundKey() {
  const envFile = path.join(ROOT, "packages/client/.env.local");
  const value = process.env.VITE_SOUND_KEY ?? (existsSync(envFile) ? /^VITE_SOUND_KEY=(.*)$/m.exec(readFileSync(envFile, "utf8"))?.[1] : undefined);
  const key = Number(value?.trim().replace(/^(["'])(.*)\1$/, "$2"));
  if (!Number.isInteger(key) || key <= 0 || key > 0xffffffff) throw new Error("Clé des sons protégés absente ou invalide : VITE_SOUND_KEY dans packages/client/.env.local");
  return key;
}

// Brouille (ou débrouille : même opération) les octets, par une suite pseudo-aléatoire tirée de la clé — identique à
// scramble() de packages/client/src/audio/scramble.ts.
function scramble(bytes) {
  let state = soundKey() >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[i] ^= state & 0xff;
  }
}

// Garde la portion start → end (secondes) d'un WAV 16 bits mono (morceau d'une piste découpée).
function slice(wavFile, start, end) {
  const buffer = readFileSync(wavFile);
  const { offset, length } = dataChunk(buffer);
  const from = Math.min(length, Math.floor(start * SAMPLE_RATE) * 2);
  const to = Math.min(length, Math.floor(end * SAMPLE_RATE) * 2);
  const data = buffer.subarray(offset + from, offset + to);
  const header = Buffer.from(buffer.subarray(0, offset));
  header.writeUInt32LE(data.length, offset - 4);
  header.writeUInt32LE(header.length + data.length - 8, 4);
  writeFileSync(wavFile, Buffer.concat([header, data]));
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

// Ramène la crête d'un WAV 16 bits mono à PEAK ; avec maxDuration, coupe le son à cette durée avec un fondu.
function normalize(input, output, maxDuration) {
  let buffer = readFileSync(input);
  let { offset, length } = dataChunk(buffer);
  if (maxDuration && length > maxDuration * SAMPLE_RATE * 2) {
    length = Math.round(maxDuration * SAMPLE_RATE) * 2;
    const fade = Math.round(TRIM_FADE * SAMPLE_RATE) * 2;
    for (let i = length - fade; i < length; i += 2) {
      buffer.writeInt16LE(Math.round((buffer.readInt16LE(offset + i) * (length - i)) / fade), offset + i);
    }
    // En-têtes RIFF et "data" mis à la nouvelle taille.
    buffer = buffer.subarray(0, offset + length);
    buffer.writeUInt32LE(length, offset - 4);
    buffer.writeUInt32LE(buffer.length - 8, 4);
  }
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
