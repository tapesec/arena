// Prépare les modèles de l'éditeur d'apparence (onglets « Apparence » et « Placement » de animation-lab.html), en
// développement seulement : corps et têtes des races, pièces de tenue, cheveux, monstres, armes et accessoires, dans
// packages/client/public/dev-models/appearance/ (non versionné), plus leur catalogue dans
// packages/client/src/appearanceCatalog.json (versionné : seulement des noms de fichiers).
// Usage : node scripts/prepare-appearance-lab.mjs   (après import-assets.sh et import-appearance-assets.sh)
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, prune, textureCompress, unpartition } from "@gltf-transform/functions";
import { parseBinaryFBX } from "@babylonjs/loaders/FBX/parsers/fbxBinaryParser.js";
import { interpretFBX } from "@babylonjs/loaders/FBX/interpreter/fbxInterpreter.js";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "assets-source");
const OUT = path.join(ROOT, "packages/client/public/dev-models/appearance");
const CATALOG = path.join(ROOT, "packages/client/src/appearanceCatalog.json");
// Les originales font jusqu'à 4096 px : réduites pour que l'éditeur charge vite.
const TEXTURE_SIZE = 1024;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ sharp });

// Corps complets par race et genre (voir bodySources) : les humains sont les corps de Universal Base Characters
// (trois morphologies, la « Superhero » garde l'identifiant Human déjà enregistré), les autres races viennent du pack
// Fantasy Races (scripts/import-appearance-assets.sh).
const HUMAN_BODIES = { Superhero: "Human", Regular: "HumanRegular", Teen: "HumanTeen" };
// Coiffures : poils du visage (cumulables avec une coupe) ; les sourcils restent ceux du corps.
const FACIAL_HAIR = /^Hair_(Beard|Moustache|MuttonChops)/;
// Os dont la tête découpée dans le corps garde les triangles (comme build-assets.mjs).
const HEAD_BONES = new Set(["Head", "neck_01"]);

// Monstres humanoïdes (pack Fantasy Monsters, squelette Mixamo ; les créatures à quatre pattes ne sont pas copiées
// dans assets-source). Trois bêtes debout sont écartées aussi : nos gestes de guerrier ou de mage ne leur vont pas.
const MONSTERS_DIR = "monsters";
const EXCLUDED_MONSTERS = new Set(["BogCroaker", "CragBear", "SunBasilisk"]);

// Armes, par pack : dossier source et extensions gardées.
const WEAPON_PACKS = [
  { pack: "Quaternius", dir: "weapons", ext: ".gltf" },
  { pack: "Hearthfold", dir: "hearthfold-weapons/Hearthfold_Weapons_Shields_Pack/GLB", ext: ".glb", recursive: true },
  { pack: "Medieval Weapons", dir: "weapons-fbx/medieval-weapons", ext: ".fbx" },
  { pack: "RPG Asset Pack", dir: "weapons-fbx/rpg-asset-pack", ext: ".fbx" },
  { pack: "Ultimate RPG Items", dir: "weapons-fbx/ultimate-rpg-items", ext: ".fbx" },
];
// Objets du pack Hearthfold qui ne se tiennent pas en main (posés au sol).
const NOT_HELD = /Sword_InStone|Bolts_Bundle|Quiver_Full|Scabbard/;

// Accessoires Hearthfold portés sur le corps, avec le point d'accroche prévu par le pack (voir son README, PIVOTS).
const ACCESSORIES_DIR = "hearthfold-armor/Hearthfold_Armor_Wearables_Pack/GLB";
const SOCKETS = [
  [/Helm|Hat|Hood|Mask|Coif|Circlet/, "head"],
  [/Chest|Robe|Tunic|Tabard|Bandolier/, "chest"],
  [/Gorget|Mantle/, "neck"],
  [/Pauldrons/, "shoulder"],
  [/Gauntlets|Gloves|Bracers|Vambraces/, "wrist"],
  [/Belt|Kilt|Pouch|Quiver|Waterskin/, "hip"],
  [/Greaves|Boots|Shoes/, "foot"],
  [/Backpack|Bedroll|Satchel/, "back"],
  [/Cape|Cloak/, "cape"],
];

// Palette des objets Hearthfold (armes et armures partagent la même) : une image de PALETTE_GRID × PALETTE_GRID cases
// de couleur, où chaque partie d'un objet prend sa couleur (ses coordonnées de texture tombent dans une case).
const PALETTE_SOURCE = "hearthfold-weapons/Hearthfold_Weapons_Shields_Pack/Textures/HF_Palette.png";
const PALETTE_MATERIAL = "HF_Palette_Mat";
const PALETTE_GRID = 8;

async function main() {
  await rm(OUT, { recursive: true, force: true });
  const catalog = { bodies: [], parts: [], hair: [], monsters: [], weapons: [], accessories: [], outfitColors: {}, raceHairColors: [] };
  const palette = await readPalette();
  catalog.palette = { file: "hearthfold-palette.png", grid: PALETTE_GRID, material: PALETTE_MATERIAL, colors: palette.colors };

  for (const { id, race, gender, source, skin } of await bodySources()) {
    await writeOptimized(await io.read(path.join(SOURCE, source)), `bodies/${id}.glb`);
    const head = await io.read(path.join(SOURCE, source));
    keepHeadOnly(head);
    await writeOptimized(head, `bodies/${id}_Head.glb`);
    // Races : trois couleurs de peau (la 1 est celle du GLB), sur le matériau MI_<texture>.
    const skins = skin ? await variantTextures(`races/textures/T_${skin}_BaseColor_`, `skins/${skin}_`) : [];
    catalog.bodies.push({ id, race, gender, ...(skin && { skinMaterial: `MI_${skin}`, skins }) });
  }

  // Cheveux des races : trois couleurs (matériau MI_FantasyHair).
  catalog.raceHairColors = await variantTextures("races/textures/T_FantasyHair_BaseColor_", "skins/FantasyHair_");

  // Couleurs des tenues : les trois variantes du pack (T_<Tenue>_BaseColor, _2, _3), sur le matériau MI_<Tenue>.
  for (const outfit of (await readdir(path.join(SOURCE, "outfits/textures"))).sort()) {
    const files = [];
    for (const [i, suffix] of ["", "_2", "_3"].entries()) {
      const source = path.join(SOURCE, "outfits/textures", outfit, `T_${outfit}${suffix}_BaseColor.png`);
      const target = `outfit-colors/${outfit}_${i + 1}.webp`;
      await writeTexture(source, target);
      files.push(target);
    }
    catalog.outfitColors[outfit] = files;
  }

  // Pièces de tenue : <Genre>_<Tenue>_<Emplacement>[_<Variante>].
  for (const file of (await readdir(path.join(SOURCE, "outfits/parts"))).filter((f) => f.endsWith(".gltf")).sort()) {
    const id = file.replace(/\.gltf$/, "");
    const [gender, outfit, slot] = id.split("_");
    await writeOptimized(await io.read(path.join(SOURCE, "outfits/parts", file)), `parts/${id}.glb`);
    catalog.parts.push({ id, gender, outfit, slot });
  }

  for (const gender of ["Male", "Female"]) {
    const dir = path.join(SOURCE, "base-full/hair", gender);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".gltf") && !f.startsWith("Eyebrows")).sort()) {
      const id = file.replace(/\.gltf$/, "");
      await writeOptimized(await io.read(path.join(dir, file)), `hair/${id}.glb`);
      catalog.hair.push({ id, gender, kind: FACIAL_HAIR.test(id) ? "facial" : "cut", teen: id.endsWith("_Teen") });
    }
  }

  // Monstres : le fichier désigne un os de doigt comme racine du squelette (erreur d'export) ; le chargeur de Babylon
  // y rattache alors le maillage, qui se couche et s'étire. On met le bassin comme racine.
  for (const file of (await readdir(path.join(SOURCE, MONSTERS_DIR))).filter((f) => f.endsWith(".glb")).sort()) {
    const id = file.replace(/\.glb$/, "");
    if (EXCLUDED_MONSTERS.has(id)) continue;
    const doc = await io.read(path.join(SOURCE, MONSTERS_DIR, file));
    const hips = doc.getRoot().listNodes().find((n) => n.getName() === "mixamorig:Hips");
    if (!hips) throw new Error(`${id} : os mixamorig:Hips introuvable`);
    for (const skin of doc.getRoot().listSkins()) skin.setSkeleton(hips);
    await writeOptimized(doc, `monsters/${id}.glb`);
    catalog.monsters.push({ id });
  }

  for (const { pack, dir, ext, recursive } of WEAPON_PACKS) {
    for (const file of await listFiles(path.join(SOURCE, dir), ext, recursive)) {
      const name = path.basename(file, ext);
      if (NOT_HELD.test(name)) continue;
      const slug = pack.replace(/ /g, "");
      const id = `${slug}/${name}`;
      if (ext === ".fbx") {
        await mkdir(path.join(OUT, "weapons", slug), { recursive: true });
        await copyFile(file, path.join(OUT, "weapons", slug, `${name}.fbx`));
        catalog.weapons.push({ id, pack, name, file: `weapons/${slug}/${name}.fbx`, colors: await fbxZones(file) });
      } else {
        const doc = await io.read(file);
        const colors = gltfZones(doc, palette);
        await writeOptimized(doc, `weapons/${slug}/${name}.glb`);
        catalog.weapons.push({ id, pack, name, file: `weapons/${slug}/${name}.glb`, colors });
      }
    }
  }

  for (const file of await listFiles(path.join(SOURCE, ACCESSORIES_DIR), ".glb", true)) {
    const name = path.basename(file, ".glb");
    // Objets de décor (présentoirs, mannequins) : pas portés.
    if (name.startsWith("HF_Dsp_")) continue;
    const socket = SOCKETS.find(([pattern]) => pattern.test(name))?.[1];
    if (!socket) continue;
    const doc = await io.read(file);
    const colors = gltfZones(doc, palette);
    await writeOptimized(doc, `accessories/${name}.glb`);
    catalog.accessories.push({ id: name, socket, file: `accessories/${name}.glb`, colors });
  }

  await writeFile(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
  const counts = Object.entries(catalog).map(([key, list]) => `${Array.isArray(list) ? list.length : Object.keys(list).length} ${key}`);
  console.log(`Catalogue écrit : ${counts.join(", ")}`);
}

// Palette Hearthfold, copiée telle quelle (sans compression, les cases restent nettes), et couleur moyenne de chaque
// case (pastilles de l'éditeur), rangées ligne par ligne.
async function readPalette() {
  const source = path.join(SOURCE, PALETTE_SOURCE);
  await mkdir(OUT, { recursive: true });
  await copyFile(source, path.join(OUT, "hearthfold-palette.png"));
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const size = info.width / PALETTE_GRID;
  const colors = [];
  for (let row = 0; row < PALETTE_GRID; row++) {
    for (let col = 0; col < PALETTE_GRID; col++) {
      const sum = [0, 0, 0];
      for (let y = row * size; y < (row + 1) * size; y++) {
        for (let x = col * size; x < (col + 1) * size; x++) for (let c = 0; c < 3; c++) sum[c] += data[(y * info.width + x) * 3 + c];
      }
      colors.push(hex(sum.map((v) => v / (size * size * 255))));
    }
  }
  return { colors };
}

// Zones de couleur d'un objet glTF, la plus grande surface d'abord : pour le matériau de la palette Hearthfold, les
// cases utilisées (« c<numéro> » : chaque triangle compte pour la case où tombe le centre de ses coordonnées de
// texture), et pour un autre matériau, le matériau entier (« m:<nom> », sa couleur de base).
function gltfZones(doc, palette) {
  const weights = new Map();
  const add = (id, color, weight) => {
    const zone = weights.get(id) ?? { id, color, weight: 0 };
    zone.weight += weight;
    weights.set(id, zone);
  };
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      if (!material) continue;
      const uv = primitive.getAttribute("TEXCOORD_0");
      const position = primitive.getAttribute("POSITION");
      if (!position) continue;
      const indices = primitive.getIndices()?.getArray() ?? [...Array(position.getCount()).keys()];
      const [p, q, r] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const area = (i) => {
        position.getElement(indices[i], p);
        position.getElement(indices[i + 1], q);
        position.getElement(indices[i + 2], r);
        const e = [0, 1, 2].map((k) => q[k] - p[k]);
        const f = [0, 1, 2].map((k) => r[k] - p[k]);
        return Math.hypot(e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]) / 2;
      };
      if (material.getName() !== PALETTE_MATERIAL || !uv) {
        let total = 0;
        for (let i = 0; i + 2 < indices.length; i += 3) total += area(i);
        // Couleur de base glTF : linéaire, comme la lit Babylon ; la pastille est en sRGB.
        add(`m:${material.getName()}`, hex(material.getBaseColorFactor().slice(0, 3).map(toSrgb)), total);
        continue;
      }
      const a = [0, 0];
      const b = [0, 0];
      const c = [0, 0];
      for (let i = 0; i + 2 < indices.length; i += 3) {
        uv.getElement(indices[i], a);
        uv.getElement(indices[i + 1], b);
        uv.getElement(indices[i + 2], c);
        const u = (a[0] + b[0] + c[0]) / 3;
        const v = (a[1] + b[1] + c[1]) / 3;
        const col = Math.min(PALETTE_GRID - 1, Math.max(0, Math.floor((u - Math.floor(u)) * PALETTE_GRID)));
        const row = Math.min(PALETTE_GRID - 1, Math.max(0, Math.floor((v - Math.floor(v)) * PALETTE_GRID)));
        const cell = row * PALETTE_GRID + col;
        add(`c${cell}`, palette.colors[cell], area(i));
      }
    }
  }
  return [...weights.values()].sort((x, y) => y.weight - x.weight).map(({ id, color }) => ({ id, color }));
}

// Zones de couleur d'un objet FBX (packs Quaternius, couleurs unies) : un matériau chacune, avec sa couleur telle que
// Babylon l'affiche (couleur diffuse multipliée par son facteur, linéaire, convertie en sRGB pour la pastille).
async function fbxZones(file) {
  const buffer = await readFile(file);
  const scene = interpretFBX(parseBinaryFBX(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)));
  const zones = new Map();
  for (const material of scene.materials) {
    const { diffuseColor = [1, 1, 1], diffuseFactor = 1 } = material.properties;
    const color = diffuseColor.map((v) => toSrgb(v * diffuseFactor));
    if (!zones.has(material.name)) zones.set(material.name, { id: `m:${material.name}`, color: hex(color) });
  }
  return [...zones.values()];
}

// Composante linéaire (0 à 1) en sRGB.
function toSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

// Couleur CSS d'une couleur aux composantes de 0 à 1.
function hex(color) {
  return `#${color
    .slice(0, 3)
    .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

// Corps : morphologies humaines, puis races (« WaterElf_Male_Fins » : race WaterElfFins).
async function bodySources() {
  const bodies = [];
  for (const [type, race] of Object.entries(HUMAN_BODIES)) {
    for (const gender of ["Male", "Female"]) {
      bodies.push({ id: `${race}_${gender}`, race, gender, source: `base-full/bodies/${type}_${gender}_FullBody.gltf` });
    }
  }
  for (const file of (await readdir(path.join(SOURCE, "races"))).filter((f) => f.endsWith(".glb")).sort()) {
    const [name, gender, variant = ""] = file.replace(/\.glb$/, "").split("_");
    const race = name + variant;
    bodies.push({ id: `${race}_${gender}`, race, gender, source: `races/${file}`, skin: `${name}_${gender}` });
  }
  return bodies;
}

// Variantes 1 à 3 d'une texture (<prefix>1.png…), réduites en WebP sous <target>1.webp….
async function variantTextures(prefix, target) {
  const files = [];
  for (const n of [1, 2, 3]) {
    await writeTexture(path.join(SOURCE, `${prefix}${n}.png`), `${target}${n}.webp`);
    files.push(`${target}${n}.webp`);
  }
  return files;
}

async function writeTexture(source, target) {
  await mkdir(path.dirname(path.join(OUT, target)), { recursive: true });
  await sharp(source).resize(TEXTURE_SIZE, TEXTURE_SIZE).webp({ quality: 90 }).toFile(path.join(OUT, target));
}

async function listFiles(dir, ext, recursive) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) files.push(...(await listFiles(full, ext, recursive)));
    else if (entry.isFile() && entry.name.endsWith(ext)) files.push(full);
  }
  return files;
}

async function writeOptimized(doc, target) {
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) compactPrimitive(primitive);
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEXTURE_SIZE, TEXTURE_SIZE], quality: 90 }),
    unpartition(),
  );
  await mkdir(path.dirname(path.join(OUT, target)), { recursive: true });
  await io.write(path.join(OUT, target), doc);
}

// Ne garde du corps que la tête et le cou : les triangles dont chaque sommet suit surtout ces os. Le corps est le
// maillage articulé le plus lourd ; les yeux, sourcils et cheveux restent entiers.
function keepHeadOnly(doc) {
  const root = doc.getRoot();
  const joints = root.listSkins()[0].listJoints().map((j) => j.getName());
  const node = root
    .listNodes()
    .filter((n) => n.getMesh() && n.getSkin())
    .sort((a, b) => vertexCount(b) - vertexCount(a))[0];
  for (const primitive of node.getMesh().listPrimitives()) {
    const jointsAttr = primitive.getAttribute("JOINTS_0");
    const weightsAttr = primitive.getAttribute("WEIGHTS_0");
    const isHead = (vertex) => {
      const j = jointsAttr.getElement(vertex, []);
      const w = weightsAttr.getElement(vertex, []);
      let best = 0;
      for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
      return HEAD_BONES.has(joints[j[best]]);
    };
    const kept = [];
    const array = primitive.getIndices().getArray();
    for (let i = 0; i < array.length; i += 3) {
      if (isHead(array[i]) && isHead(array[i + 1]) && isHead(array[i + 2])) kept.push(array[i], array[i + 1], array[i + 2]);
    }
    primitive.getIndices().setArray(new Uint32Array(kept));
  }
}

function vertexCount(node) {
  return node
    .getMesh()
    .listPrimitives()
    .reduce((sum, p) => sum + p.getAttribute("POSITION").getCount(), 0);
}

await main();
