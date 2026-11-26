// Construit les personnages du jeu d'après les apparences de l'éditeur (packages/client/src/game/appearances.json) : pour
// chaque classe et chaque camp, un corps déjà assemblé (corps d'une race, pièces de tenue et coiffures sur un seul
// squelette, couleurs des tenues, de la peau et des cheveux appliquées ; ou le monstre tel quel), et ses armes et
// accessoires (copiés, palette Hearthfold déjà repeinte pour les objets recolorés). Le jeu les accroche au chargement
// comme l'éditeur, aux placements réglés (voir CharacterAssets.createCustom).
//
// Sources : public/dev-models/appearance/ (node scripts/prepare-appearance-lab.mjs). Sorties : public/models/appearances/
// (sous licence, non versionné, envoyé dans le bucket par npm run deploy-assets) et src/game/gameAppearances.json (à
// commiter : la liste des fichiers et des placements, sans contenu sous licence).
//
// Usage : npm run build-appearances
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, mergeDocuments, prune, unpartition } from "@gltf-transform/functions";
import sharp from "sharp";
import { CATALOG, mountedItems, recolorsOf } from "../packages/client/src/appearanceData";
import {
  isHairCut,
  isCustom,
  isMonster,
  modelFile,
  type Appearance,
  type AppearanceFile,
  type GameAppearance,
  type MountedItem,
  type Recolor,
} from "../packages/client/src/game/appearance";
import { paintPixels, tintPixels } from "../packages/client/src/game/textureTint";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "packages/client/public");
const EDITOR = path.join(PUBLIC, "dev-models/appearance");
const MODELS = path.join(PUBLIC, "models");
// Dossier des personnages, relatif à public/models/.
const TARGET = "appearances";
const OUTPUT = path.join(ROOT, "packages/client/src/game/gameAppearances.json");
// Qualité des textures repeintes (comme celles des personnages, voir build-assets.mjs).
const COLOR_QUALITY = 90;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ sharp });

// Fichier de l'éditeur, d'après son adresse (/dev-models/appearance/…) ou son chemin dans le dossier de l'éditeur.
function editorFile(file: string): string {
  return file.startsWith("/") ? path.join(PUBLIC, file) : path.join(EDITOR, file);
}

// Image recolorée par un calcul sur ses pixels RGBA (le même que dans l'éditeur), en WebP.
async function recolorImage(file: string, apply: (data: Uint8ClampedArray, width: number) => void): Promise<Uint8Array> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  apply(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width);
  const webp = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: COLOR_QUALITY }).toBuffer();
  return new Uint8Array(webp);
}

// Remplace la texture de couleur des matériaux de ce nom (une nouvelle texture : l'ancienne, si plus rien ne s'en sert,
// part avec prune).
function replaceColorTexture(doc: Document, material: string, name: string, image: Uint8Array) {
  const texture = doc.createTexture(name).setImage(image).setMimeType("image/webp");
  let found = false;
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getName() !== material) continue;
    m.setBaseColorTexture(texture);
    found = true;
  }
  if (!found) throw new Error(`Matériau introuvable : ${material}`);
}

// Fusionne les maillages articulés d'une pièce (tenue, coiffure) sur le squelette du corps : chacun garde ses matrices de
// liaison, ses os deviennent ceux du corps (par nom), comme dans l'éditeur (linkTransformNode).
async function attachPiece(doc: Document, armature: GltfNode, joints: Map<string, GltfNode>, file: string) {
  const piece = await io.read(path.join(EDITOR, file));
  const root = piece.getRoot();
  const skinned = root.listNodes().filter((n) => n.getMesh() && n.getSkin());
  const others = root.listNodes().filter((n) => !skinned.includes(n));
  const map = mergeDocuments(doc, piece);
  for (const node of skinned) {
    const merged = map.get(node) as GltfNode;
    const skin = merged.getSkin()!;
    const names = skin.listJoints().map((j) => j.getName());
    for (const joint of skin.listJoints()) skin.removeJoint(joint);
    for (const name of names) {
      const joint = joints.get(name);
      if (!joint) throw new Error(`${file} : os ${name} absent du corps`);
      skin.addJoint(joint);
    }
    armature.addChild(merged);
  }
  // Le reste de la pièce (son squelette, sa scène) ne sert plus.
  for (const node of others) (map.get(node) as GltfNode).dispose();
  for (const scene of root.listScenes()) map.get(scene)?.dispose();
}

// Corps d'une race, assemblé : cheveux de la race retirés au besoin, pièces fusionnées, couleurs appliquées.
async function buildBody(appearance: Appearance, recolors: Recolor[], target: string) {
  const doc = await io.read(path.join(EDITOR, modelFile(appearance)));
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const armature = root.listScenes()[0].listChildren()[0];
  const joints = new Map(skin.listJoints().map((j) => [j.getName(), j]));
  if (appearance.raceHair === false || appearance.hair.some(isHairCut)) {
    for (const node of root.listNodes()) if (node.getMesh() && node.getName().endsWith("_Hair")) node.dispose();
  }
  for (const part of appearance.parts) await attachPiece(doc, armature, joints, `parts/${part}.glb`);
  for (const hair of appearance.hair) await attachPiece(doc, armature, joints, `hair/${hair}.glb`);
  if (appearance.hairColor) {
    // Comme dans l'éditeur : la couleur (sans conversion) remplace celle des matériaux de cheveux.
    const rgb = [1, 3, 5].map((k) => parseInt(appearance.hairColor!.slice(k, k + 2), 16) / 255);
    for (const m of root.listMaterials()) if (m.getName().startsWith("MI_Hair")) m.setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1]);
  }
  for (const recolor of recolors) {
    const file = editorFile(recolor.texture);
    const tint = recolor.tint;
    const image = tint ? await recolorImage(file, (data) => tintPixels(data, tint.color, tint.from)) : new Uint8Array(await readFile(file));
    replaceColorTexture(doc, recolor.material, `${recolor.material}-color`, image);
  }
  await doc.transform(dedup(), prune(), unpartition());
  await io.write(path.join(MODELS, target), doc);
}

// Objet du personnage, dans le dossier des personnages : copié, ou palette repeinte (zones « c<case> ») dans un fichier
// à part (nommé d'après ses couleurs). Rend l'objet tel que le jeu l'accroche.
async function buildItem(item: MountedItem): Promise<MountedItem> {
  const { palette, colors, ...rest } = item;
  const cells: Record<number, string> = {};
  const kept: Record<string, string> = {};
  for (const [zone, color] of Object.entries(colors ?? {})) {
    if (/^c\d+$/.test(zone)) cells[Number(zone.slice(1))] = color;
    else kept[zone] = color;
  }
  const result: MountedItem = { ...rest, ...(Object.keys(kept).length ? { colors: kept } : {}) };
  const source = path.join(EDITOR, item.file);
  if (!palette || !Object.keys(cells).length) {
    result.file = `${TARGET}/items/${item.file}`;
    await mkdir(path.dirname(path.join(MODELS, result.file)), { recursive: true });
    await copyFile(source, path.join(MODELS, result.file));
    return result;
  }
  const hash = createHash("sha256").update(JSON.stringify(Object.entries(cells).sort(([a], [b]) => Number(a) - Number(b)))).digest("hex").slice(0, 8);
  result.file = `${TARGET}/items/${item.file.replace(/\.glb$/, `.${hash}.glb`)}`;
  const doc = await io.read(source);
  const image = await recolorImage(editorFile(palette.texture), (data, width) => paintPixels(data, width, palette.grid, cells));
  replaceColorTexture(doc, palette.material, `${palette.material}-painted`, image);
  await doc.transform(prune(), unpartition());
  await mkdir(path.dirname(path.join(MODELS, result.file)), { recursive: true });
  await io.write(path.join(MODELS, result.file), doc);
  return result;
}

async function buildCharacter(file: AppearanceFile, classId: string, camp: number, appearance: Appearance): Promise<GameAppearance> {
  const body = `${TARGET}/${classId}-${camp + 1}.glb`;
  if (isMonster(appearance.model) || isCustom(appearance.model)) await copyFile(path.join(EDITOR, modelFile(appearance)), path.join(MODELS, body));
  else await buildBody(appearance, recolorsOf(appearance), body);
  const items: MountedItem[] = [];
  for (const item of mountedItems(appearance)) items.push(await buildItem(item));
  // Placements des objets portés (et place « joué » d'un instrument) ; les autres restent par défaut.
  const used = new Set(items.flatMap((item) => [item.key, ...(item.playKey ? [item.playKey] : [])]));
  const modelMounts = file.mounts[appearance.model] ?? {};
  const mounts = Object.fromEntries(Object.entries(modelMounts).filter(([key]) => used.has(key)));
  return {
    // Tenue, coiffures et couleurs sont dans le corps : il ne reste que le modèle et les objets.
    appearance: { model: appearance.model, headOnly: appearance.headOnly, parts: [], hair: [], weapons: appearance.weapons, accessories: appearance.accessories },
    body,
    items,
    mounts,
  };
}

// Le script est chargé en CommonJS par tsx (pas d'await au premier niveau).
async function main() {
  const file = JSON.parse(await readFile(path.join(ROOT, "packages/client/src/game/appearances.json"), "utf8")) as AppearanceFile;
  if (!CATALOG.palette) throw new Error("Catalogue de l'éditeur sans palette : relancer prepare-appearance-lab.mjs");
  await rm(path.join(MODELS, TARGET), { recursive: true, force: true });
  await mkdir(path.join(MODELS, TARGET), { recursive: true });
  const result: Record<string, (GameAppearance | null)[]> = {};
  for (const [classId, variants] of Object.entries(file.variants)) {
    result[classId] = [];
    for (let camp = 0; camp < 2; camp++) {
      const appearance = variants[camp];
      result[classId].push(appearance ? await buildCharacter(file, classId, camp, appearance) : null);
      if (appearance) console.log(`${classId} camp ${camp + 1} : ${appearance.model}, ${result[classId][camp]!.items.length} objet(s)`);
    }
  }
  await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Écrit : ${path.relative(ROOT, OUTPUT)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
