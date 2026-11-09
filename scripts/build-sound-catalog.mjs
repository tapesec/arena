// Produit le catalogue COMPLET des sons (tous les fichiers de assets-source/sounds), pour la page des sons
// (packages/client/soundboard.html), utile en développement seulement : chaque fichier y est écoutable, avec un
// nom à copier dans le tableur. Le jeu, lui, n'embarque que les groupes de samples.json (voir build-sounds.mjs).
//
// Usage : node scripts/build-sound-catalog.mjs (outil requis : afconvert, fourni avec macOS)
// Sorties : packages/client/public/dev-sounds/<nom>.m4a (non versionné : se régénère à partir de assets-source/)
//           packages/client/src/audio/soundCatalog.json (liste des fichiers, versionnée)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "assets-source/sounds");
const OUT = path.join(ROOT, "packages/client/public/dev-sounds");
const CATALOG = path.join(ROOT, "packages/client/src/audio/soundCatalog.json");
const EXTENSIONS = new Set([".wav", ".ogg", ".mp3", ".flac", ".aif", ".aiff"]);
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
const all = listFiles(SOURCE).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const files = all.filter((file) => {
  const parts = file.split(path.sep);
  const mp3 = parts.indexOf("Mp3");
  if (mp3 < 0) return true;
  const wav = [...parts.slice(0, mp3), "Wav", ...parts.slice(mp3 + 1)].join(path.sep).replace(/\.mp3$/i, ".wav");
  return !existsSync(path.join(SOURCE, wav));
});

// Nom court et unique : le nom du fichier sans extension(s) ; en cas de doublon (ex. les trois voix de femme),
// préfixé par les dossiers parents jusqu'à être unique.
const clean = (text) => text.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const candidates = (file) => {
  const parts = file.split(path.sep);
  const base = clean(parts.pop().replace(/(\.[a-z0-9]+)+$/i, ""));
  const names = [base];
  for (let i = parts.length - 1; i >= 0; i--) names.push(`${clean(parts.slice(i).join("_"))}_${base}`);
  return names;
};
const taken = new Map();
for (const file of files) for (const name of candidates(file)) taken.set(name, (taken.get(name) ?? 0) + 1);
const nameOf = (file) => candidates(file).find((name) => taken.get(name) === 1) ?? clean(file);

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
  const pack = file.includes(path.sep) ? file.split(path.sep)[0] : "Divers";
  catalog.push({ name, pack, file: file.split(path.sep).join("/"), duration: Math.round(duration * 100) / 100 });
}
rmSync(work, { recursive: true, force: true });
writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + "\n");
console.log(`${catalog.length} sons, ${(size / 1024 / 1024).toFixed(1)} Mo dans ${path.relative(ROOT, OUT)}`);
