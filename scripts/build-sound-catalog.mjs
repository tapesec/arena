// Produit le catalogue COMPLET des sons (tous les fichiers de assets-source/sounds), pour la page des sons
// (packages/client/soundboard.html), utile en développement seulement : chaque fichier y est écoutable, avec un
// nom à copier dans le tableur. Le jeu, lui, n'embarque que les groupes de samples.json (voir build-sounds.mjs).
//
// Usage : node scripts/build-sound-catalog.mjs (outil requis : afconvert, fourni avec macOS)
// Sorties : packages/client/public/dev-sounds/<nom>.m4a (non versionné : se régénère à partir de assets-source/)
//           packages/client/src/audio/soundCatalog.json (liste des fichiers, versionnée)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "assets-source/sounds");
const OUT = path.join(ROOT, "packages/client/public/dev-sounds");
const CATALOG = path.join(ROOT, "packages/client/src/audio/soundCatalog.json");
// Choix de l'onglet « Sons » de animation-lab.html (voir src/audio/soundEdits.ts) : sons retirés (déplacés dans
// REJECTED), et pistes découpées en morceaux.
const EDITS = path.join(ROOT, "packages/client/src/audio/soundEdits.json");
const REJECTED = path.join(ROOT, "assets-source/sounds-rejected");
const EXTENSIONS = new Set([".wav", ".ogg", ".mp3", ".flac", ".aif", ".aiff"]);
// Packs dont la licence interdit toute modification (CC BY-ND) : ni découpe, ni passage en mono, ni volume
// harmonisé ; marqués « intact » dans le catalogue.
const INTACT_PACKS = new Set(["LDD - Elemental Magic - Fire Attacks"]);
// Packs dont la licence demande d'empêcher l'extraction des fichiers par les joueurs : marqués « protected » ; ceux
// utilisés par les compétences partent dans un conteneur brouillé (scripts/build-sounds.mjs), jamais en fichiers.
const PROTECTED_PACKS = new Set(["Shapeforms Arcane Activations"]);
// Mono et léger : la page sert à choisir un son, pas à juger finement sa qualité.
const BITRATE = 64000;

// Tous les fichiers son, en chemins relatifs à assets-source/sounds, triés.
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [path.relative(SOURCE, full)] : [];
  });
}

// La Fantasy Sound Library existe en Wav et en Mp3 : seule la version Wav (celle du jeu) est gardée.
function soundFiles() {
  const all = listFiles(SOURCE).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return all.filter((file) => {
    const parts = file.split(path.sep);
    const mp3 = parts.indexOf("Mp3");
    if (mp3 < 0) return true;
    const wav = [...parts.slice(0, mp3), "Wav", ...parts.slice(mp3 + 1)].join(path.sep).replace(/\.mp3$/i, ".wav");
    return !existsSync(path.join(SOURCE, wav));
  });
}

// Nom court et unique : le nom du fichier sans extension(s) ; en cas de doublon (ex. les trois voix de femme),
// préfixé par les dossiers parents jusqu'à être unique.
const clean = (text) => text.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
// Bundles Sonniss : un dossier par bibliothèque, fichiers nommés "CATÉGORIE_Description_Éditeur_Bibliothèque" ;
// le nom garde la catégorie et la description, le pack est la bibliothèque.
const BUNDLE = /^Sonniss GDC \d+$/;
const isBundle = (file) => BUNDLE.test(file.split(path.sep)[0]);
const baseName = (file) => {
  const name = path.basename(file).replace(/(\.[a-z0-9]+)+$/i, "");
  return clean(isBundle(file) ? name.split("_").slice(0, 2).join("_") : name);
};
const packOf = (file) => {
  const parts = file.split(path.sep);
  if (parts.length === 1) return "Divers";
  return isBundle(file) && parts.length > 2 ? `${parts[0]} · ${parts[1].replace(/^.+? - /, "")}` : parts[0];
};
const candidates = (file) => {
  const parts = file.split(path.sep);
  parts.pop();
  const base = baseName(file);
  // Doublon dans un bundle (ex. "EffectiveTrailer_Booms_Vol2_011") : le nom complet du fichier d'abord.
  const names = isBundle(file) ? [base, clean(path.basename(file).replace(/(\.[a-z0-9]+)+$/i, ""))] : [base];
  for (let i = parts.length - 1; i >= 0; i--) names.push(`${clean(parts.slice(i).join("_"))}_${base}`);
  return [...new Set(names)];
};
// Nom de chaque fichier, unique parmi files.
function namesOf(files) {
  const taken = new Map();
  for (const file of files) for (const name of candidates(file)) taken.set(name, (taken.get(name) ?? 0) + 1);
  return new Map(files.map((file) => [file, candidates(file).find((name) => taken.get(name) === 1) ?? clean(file)]));
}

// Choix de l'onglet des sons, rapportés aux fichiers (les noms peuvent changer quand un doublon est retiré).
const before = soundFiles();
const fileByName = new Map([...namesOf(before)].map(([file, name]) => [name, file]));
const edits = existsSync(EDITS) ? JSON.parse(readFileSync(EDITS, "utf8")) : { rejected: [], cuts: {} };
// Sécurité : les noms des choix sont ceux du catalogue écouté dans l'onglet. Si un nom désigne maintenant un autre
// fichier (packs ajoutés ou retirés depuis), on s'arrête sans rien déplacer.
const previous = existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, "utf8")) : [];
const catalogFile = new Map(previous.map((entry) => [entry.name, entry.file]));
const posix = (file) => file.split(path.sep).join("/");
for (const name of [...(edits.rejected ?? []).map((n) => n.replace(/_part\d+$/, "")), ...Object.keys(edits.cuts ?? {})]) {
  const expected = catalogFile.get(name);
  const found = fileByName.get(name);
  if (expected && found && posix(found) !== expected) {
    console.error(`Arrêt : « ${name} » désignait ${expected}, il désigne maintenant ${posix(found)}. Rien n'a été déplacé.`);
    process.exit(1);
  }
}
const cutsByFile = new Map();
for (const [name, cuts] of Object.entries(edits.cuts ?? {})) if (fileByName.has(name) && cuts.length) cutsByFile.set(fileByName.get(name), cuts);
const rejectedParts = new Map();
const rejectedFiles = [];
// Un son joué par le jeu (groupes de samples.json) n'est jamais retiré.
const samples = JSON.parse(readFileSync(path.join(ROOT, "packages/client/src/audio/samples.json"), "utf8"));
const patterns = Object.values(samples.groups).flatMap((group) => group.files);
const regexOf = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
// …ni un son utilisé par une piste d'une compétence réglée (animationTuning.json).
const tuning = JSON.parse(readFileSync(path.join(ROOT, "packages/client/src/game/animationTuning.json"), "utf8"));
const tunedSounds = new Set();
for (const entries of Object.values(tuning)) {
  for (const entry of Object.values(entries)) {
    const tracks = [entry.effects, entry.projectile?.effects, entry.impact?.effects, entry.status, entry.zone];
    for (const effect of tracks.flat()) if (effect?.type === "sound") tunedSounds.add(effect.recipe);
  }
}
const inGame = (file) =>
  patterns.some((pattern) => regexOf(pattern).test(file.split(path.sep).join("/"))) ||
  [...fileByName].some(([name, f]) => f === file && tunedSounds.has(name));
for (const name of edits.rejected ?? []) {
  if (fileByName.has(name)) {
    if (inGame(fileByName.get(name))) console.log(`gardé (joué par le jeu) : ${fileByName.get(name)}`);
    else rejectedFiles.push(fileByName.get(name));
    continue;
  }
  const part = /^(.+)_part(\d+)$/.exec(name);
  if (part && fileByName.has(part[1])) {
    const file = fileByName.get(part[1]);
    if (!rejectedParts.has(file)) rejectedParts.set(file, new Set());
    rejectedParts.get(file).add(Number(part[2]) - 1);
  }
}
for (const file of rejectedFiles) {
  cutsByFile.delete(file);
  rejectedParts.delete(file);
}
// Noms après les retraits, et choix réécrits avec ces noms AVANT de déplacer quoi que ce soit : une interruption
// pendant la reconstruction (longue) ne fait perdre aucun choix ; il suffit de relancer.
const removed = new Set(rejectedFiles);
const files = before.filter((file) => !removed.has(file));
const names = namesOf(files);
const nameOf = (file) => names.get(file);
const nextEdits = { rejected: [], cuts: {} };
for (const [file, cuts] of cutsByFile) {
  if (!names.has(file)) continue;
  nextEdits.cuts[names.get(file)] = cuts;
  for (const i of rejectedParts.get(file) ?? []) nextEdits.rejected.push(`${names.get(file)}_part${i + 1}`);
}
writeFileSync(EDITS, JSON.stringify(nextEdits, null, 2) + "\n");

// Sons retirés : déplacés hors du catalogue (récupérables), avec leur double en Mp3 (Fantasy Sound Library), sinon
// celui-ci reprendrait leur place. Un fichier déjà présent dans REJECTED n'est jamais écrasé.
const moveAside = (file) => {
  let target = path.join(REJECTED, file);
  for (let n = 2; existsSync(target); n++) target = path.join(REJECTED, file.replace(/(\.[a-z0-9]+)$/i, ` (${n})$1`));
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(path.join(SOURCE, file), target);
  console.log(`retiré : ${file}`);
};
for (const file of rejectedFiles) {
  moveAside(file);
  const parts = file.split(path.sep);
  const wav = parts.indexOf("Wav");
  if (wav >= 0) {
    const mp3 = [...parts.slice(0, wav), "Mp3", ...parts.slice(wav + 1)].join(path.sep).replace(/\.wav$/i, ".mp3");
    if (existsSync(path.join(SOURCE, mp3))) moveAside(mp3);
  }
}

// WAV PCM 16 bits mono : en-tête et données, pour en découper des morceaux.
function readPcm(wavFile) {
  const data = readFileSync(wavFile);
  let offset = 12;
  let rate = 44100;
  while (offset < data.length) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === "fmt ") rate = data.readUInt32LE(offset + 12);
    if (id === "data") return { rate, samples: data.subarray(offset + 8, offset + 8 + size) };
    offset += 8 + size + (size % 2);
  }
  throw new Error(`WAV illisible : ${wavFile}`);
}

function writePcm(wavFile, rate, samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  writeFileSync(wavFile, Buffer.concat([header, samples]));
}

// Morceaux [début, fin] d'une piste d'après ses coupes (comme segmentsOf de soundEdits.ts).
// Les coupes trop proches (d'un autre ou d'un bout) sont ignorées : pas de morceau de moins de MIN_PART secondes.
const MIN_PART = 0.05;
function segmentsOf(duration, cuts) {
  const points = [0];
  for (const t of [...cuts].sort((a, b) => a - b)) if (t - points.at(-1) >= MIN_PART && duration - t >= MIN_PART) points.push(t);
  points.push(duration);
  return points.slice(1).map((end, i) => [points[i], end]);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const catalog = [];
let size = 0;
const work = mkdtempSync(path.join(tmpdir(), "arena-sound-catalog-"));
const wav = path.join(work, "mono.wav");
for (const file of files) {
  const name = nameOf(file);
  const input = path.join(SOURCE, file);
  const target = path.join(OUT, `${name}.m4a`);
  // Passage par un WAV mono : afconvert ne sait pas réduire en mono certains formats (ogg stéréo) en une fois.
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@44100", "-c", "1", input, wav]);
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", String(BITRATE), wav, target]);
  size += statSync(target).size;
  const info = execFileSync("afinfo", [input]).toString();
  const duration = Number(/estimated duration: ([\d.]+)/.exec(info)?.[1] ?? 0);
  const pack = packOf(file);
  const entry = { name, pack, file: file.split(path.sep).join("/"), duration: Math.round(duration * 100) / 100 };
  const intact = INTACT_PACKS.has(file.split(path.sep)[0]);
  if (intact) entry.intact = true;
  if (PROTECTED_PACKS.has(file.split(path.sep)[0])) entry.protected = true;
  const cuts = intact ? null : cutsByFile.get(file);
  if (!cuts) {
    catalog.push(entry);
    continue;
  }
  // Piste découpée : chaque morceau (sauf ceux retirés) devient un son ; la piste entière reste dans le catalogue,
  // marquée « split » (pour revoir ses coupes sur la page de réglage, pas pour être jouée).
  catalog.push({ ...entry, split: true, cuts });
  const { rate, samples } = readPcm(wav);
  segmentsOf(duration, cuts).forEach(([start, end], i) => {
    if (rejectedParts.get(file)?.has(i)) return;
    const part = `${name}_part${i + 1}`;
    const slice = samples.subarray(Math.floor(start * rate) * 2, Math.floor(end * rate) * 2);
    const partWav = path.join(work, "part.wav");
    writePcm(partWav, rate, slice);
    const partTarget = path.join(OUT, `${part}.m4a`);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", String(BITRATE), partWav, partTarget]);
    size += statSync(partTarget).size;
    const round = (t) => Math.round(t * 1000) / 1000;
    catalog.push({ ...entry, name: part, duration: Math.round((end - start) * 100) / 100, parent: name, start: round(start), end: round(end) });
  });
}

rmSync(work, { recursive: true, force: true });
writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
console.log(`${catalog.length} sons, ${(size / 1024 / 1024).toFixed(1)} Mo dans ${path.relative(ROOT, OUT)}`);
