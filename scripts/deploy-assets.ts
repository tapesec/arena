// Envoie les assets de production (modèles, sons, musique) dans le bucket servi par Cloudflare, puis écrit
// packages/client/src/assets-manifest.json (à commiter) : le jeu publié les y charge (voir src/assets.ts).
//
// Seuls les fichiers que le jeu utilise partent : les modèles et musiques d'après les données du jeu
// (src/productionAssets.ts), les groupes de sons nommés dans le code du jeu (pages de développement exclues), les sons
// des compétences réglées (public/sounds/tuned). Le reste de public/ et le catalogue complet restent sur le poste.
//
// Chaque fichier est envoyé sous un nom à empreinte (« lame.3f9a1c0b2d4e5f60.glb ») : un fichier modifié change de
// nom, le CDN et les navigateurs le gardent donc en cache pour toujours. Rien n'est supprimé du bucket : une ancienne
// version du jeu encore ouverte trouve toujours ses fichiers.
//
// Usage : npm run deploy-assets [-- --dry-run | --local <dossier>]
//   --dry-run : liste ce qui serait envoyé, sans rien envoyer ni écrire.
//   --local <dossier> : copie les fichiers publiés dans ce dossier au lieu du bucket, et écrit le manifeste (essai du
//   jeu publié avec un serveur local ; remettre ensuite le manifeste avec git restore).
//   AWS_PROFILE (défaut lionnel-perso), ASSETS_BUCKET (défaut assets.winorwipe.com). Outil requis : la CLI AWS.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productionModels, productionMusic } from "../packages/client/src/productionAssets";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "packages/client");
const PUBLIC = path.join(CLIENT, "public");
const SRC = path.join(CLIENT, "src");
const MANIFEST = path.join(SRC, "assets-manifest.json");

const DRY_RUN = process.argv.includes("--dry-run");
const LOCAL_FLAG = process.argv.indexOf("--local");
const LOCAL_DIR = LOCAL_FLAG >= 0 ? process.argv[LOCAL_FLAG + 1] : undefined;
if (LOCAL_FLAG >= 0 && !LOCAL_DIR) throw new Error("--local demande un dossier");
const PROFILE = process.env.AWS_PROFILE ?? "lionnel-perso";
const BUCKET = process.env.ASSETS_BUCKET ?? "assets.winorwipe.com";

// Type de chaque extension (la CLI AWS ne connaît pas toutes) ; un fichier d'un autre type arrête le script.
const CONTENT_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".fbx": "application/octet-stream",
  ".webp": "image/webp",
  ".m4a": "audio/mp4",
  ".json": "application/json",
  ".bin": "application/octet-stream",
};
const CACHE_CONTROL = "public, max-age=31536000, immutable";

// Asset à publier : son chemin dans public/ et son contenu.
interface Asset {
  path: string;
  data: Buffer;
}

// Fichiers du client chargés par le jeu : ceux qu'on atteint par les imports depuis src/main.tsx (les pages de
// développement ont leurs propres points d'entrée).
function gameSources(): Map<string, string> {
  const sources = new Map<string, string>();
  const pending = [path.join(SRC, "main.tsx")];
  while (pending.length) {
    const file = pending.pop()!;
    if (sources.has(file)) continue;
    const text = readFileSync(file, "utf8");
    sources.set(file, text);
    if (file.endsWith(".json")) continue;
    for (const match of text.matchAll(/(?:from\s+|import\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const resolved = resolveImport(path.resolve(path.dirname(file), match[1]));
      if (resolved) pending.push(resolved);
    }
  }
  return sources;
}

// Seuls le code et les JSON comptent (pas les feuilles de style ni les images, ni leur suffixe « ?raw »).
function resolveImport(specifier: string): string | null {
  const base = specifier.replace(/\?.*$/, "");
  const ext = path.extname(base);
  if (ext && ![".ts", ".tsx", ".json"].includes(ext)) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Import introuvable : ${path.relative(ROOT, base)}`);
}

// Groupes de sons enregistrés (src/audio/samples.json) nommés dans le code du jeu (« "hit" ») ou dans une piste de
// compétence (« jeu:hit »). Les noms de sons sont typés (SoundName) : ils figurent toujours en toutes lettres.
function usedSoundGroups(variantCounts: Record<string, number>): { used: string[]; unused: string[] } {
  const texts = [...gameSources()].filter(([file]) => path.basename(file) !== "samples.json").map(([, text]) => text);
  const used: string[] = [];
  const unused: string[] = [];
  for (const id of Object.keys(variantCounts)) {
    const quoted = new RegExp(`["'\`](?:jeu:)?${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
    (texts.some((text) => quoted.test(text)) ? used : unused).push(id);
  }
  return { used, unused };
}

function readPublic(file: string): Asset {
  const full = path.join(PUBLIC, file);
  if (!existsSync(full)) throw new Error(`Asset introuvable : public/${file}`);
  return { path: file, data: readFileSync(full) };
}

function collect(): { assets: Asset[]; unusedSounds: string[]; unusedModels: string[] } {
  const assets: Asset[] = [];
  const models = productionModels();
  for (const file of models) assets.push(readPublic(file));

  for (const id of productionMusic()) assets.push(readPublic(`music/${id}.m4a`));
  assets.push(readPublic("music/index.json"));

  // Variantes des groupes de sons utilisés, et leur index réduit à ces groupes (le jeu télécharge tout ce qu'il liste).
  const variantCounts = JSON.parse(readFileSync(path.join(PUBLIC, "sounds/index.json"), "utf8")) as Record<string, number>;
  const { used, unused } = usedSoundGroups(variantCounts);
  const index: Record<string, number> = {};
  for (const id of used) {
    index[id] = variantCounts[id];
    for (let i = 0; i < variantCounts[id]; i++) assets.push(readPublic(`sounds/${id}_${i}.m4a`));
  }
  assets.push({ path: "sounds/index.json", data: Buffer.from(`${JSON.stringify(index, null, 2)}\n`) });

  for (const file of readdirSync(path.join(PUBLIC, "sounds/tuned")).sort()) {
    if (!file.startsWith(".")) assets.push(readPublic(`sounds/tuned/${file}`));
  }

  const allModels = listFiles(path.join(PUBLIC, "models")).map((file) => `models/${file}`);
  const unusedModels = allModels.filter((file) => !models.includes(file));
  return { assets, unusedSounds: unused, unusedModels };
}

function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name.startsWith(".")
      ? []
      : entry.isDirectory()
        ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
  );
}

// « sounds/hit_3.m4a » -> « sounds/hit_3.<empreinte>.m4a ».
function publishedName(asset: Asset): string {
  const hash = createHash("sha256").update(asset.data).digest("hex").slice(0, 16);
  const ext = path.extname(asset.path);
  return `${asset.path.slice(0, -ext.length)}.${hash}${ext}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} Mo`;
}

function main() {
  const { assets, unusedSounds, unusedModels } = collect();
  const manifest: Record<string, string> = {};
  for (const asset of assets) {
    const ext = path.extname(asset.path);
    if (!CONTENT_TYPES[ext]) throw new Error(`Type de fichier non prévu (${ext}) : ${asset.path}`);
    manifest[asset.path] = publishedName(asset);
  }

  const byFolder = new Map<string, { count: number; bytes: number }>();
  for (const asset of assets) {
    const folder = asset.path.split("/")[0];
    const total = byFolder.get(folder) ?? { count: 0, bytes: 0 };
    total.count++;
    total.bytes += asset.data.length;
    byFolder.set(folder, total);
  }
  for (const [folder, { count, bytes }] of byFolder) console.log(`${folder.padEnd(8)} ${String(count).padStart(4)} fichiers  ${megabytes(bytes)}`);
  const total = assets.reduce((sum, asset) => sum + asset.data.length, 0);
  console.log(`total    ${String(assets.length).padStart(4)} fichiers  ${megabytes(total)}`);
  console.log(`Groupes de sons non utilisés par le jeu (${unusedSounds.length}) : ${unusedSounds.join(", ") || "aucun"}`);
  console.log(`Modèles non utilisés par le jeu (${unusedModels.length}) : ${unusedModels.join(", ") || "aucun"}`);

  if (DRY_RUN) {
    console.log("\n--dry-run : rien n'a été envoyé ni écrit.");
    return;
  }

  // Copie locale sous les noms publiés, puis envoi type par type (seuls les fichiers absents du bucket partent).
  const staging = LOCAL_DIR ? path.resolve(LOCAL_DIR) : mkdtempSync(path.join(tmpdir(), "arena-assets-"));
  try {
    for (const asset of assets) {
      const target = path.join(staging, manifest[asset.path]);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, asset.data);
    }
    for (const [ext, type] of Object.entries(LOCAL_DIR ? {} : CONTENT_TYPES)) {
      if (!assets.some((asset) => asset.path.endsWith(ext))) continue;
      execFileSync(
        "aws",
        ["s3", "sync", staging, `s3://${BUCKET}/`, "--profile", PROFILE, "--size-only", "--exclude", "*", "--include", `*${ext}`,
          "--content-type", type, "--cache-control", CACHE_CONTROL, "--only-show-errors"],
        { stdio: "inherit" },
      );
    }
  } finally {
    if (!LOCAL_DIR) rmSync(staging, { recursive: true, force: true });
  }

  // Écrit après l'envoi : le manifeste ne désigne jamais un fichier absent du bucket.
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`\n${LOCAL_DIR ? `Copié dans ${staging}` : `Envoyé dans s3://${BUCKET}/`} ; manifeste écrit : ${path.relative(ROOT, MANIFEST)} (à commiter).`);
}

main();
