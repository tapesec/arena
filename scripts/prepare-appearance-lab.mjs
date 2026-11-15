// Prépare les modèles de l'éditeur d'apparence (onglets « Apparence » et « Placement » de animation-lab.html), en
// développement seulement : corps et têtes des races, pièces de tenue, cheveux, monstres, armes et accessoires, dans
// packages/client/public/dev-models/appearance/ (non versionné), plus leur catalogue dans
// packages/client/src/appearanceCatalog.json (versionné : seulement des noms de fichiers).
// Usage : node scripts/prepare-appearance-lab.mjs   (après import-assets.sh et import-appearance-assets.sh)
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, prune, textureCompress, unpartition } from "@gltf-transform/functions";
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

async function main() {
  await rm(OUT, { recursive: true, force: true });
  const catalog = { bodies: [], parts: [], hair: [], monsters: [], weapons: [], accessories: [] };

  for (const { id, race, gender, source } of await bodySources()) {
    await writeOptimized(await io.read(path.join(SOURCE, source)), `bodies/${id}.glb`);
    const head = await io.read(path.join(SOURCE, source));
    keepHeadOnly(head);
    await writeOptimized(head, `bodies/${id}_Head.glb`);
    catalog.bodies.push({ id, race, gender });
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
        catalog.weapons.push({ id, pack, name, file: `weapons/${slug}/${name}.fbx` });
      } else {
        await writeOptimized(await io.read(file), `weapons/${slug}/${name}.glb`);
        catalog.weapons.push({ id, pack, name, file: `weapons/${slug}/${name}.glb` });
      }
    }
  }

  for (const file of await listFiles(path.join(SOURCE, ACCESSORIES_DIR), ".glb", true)) {
    const name = path.basename(file, ".glb");
    // Objets de décor (présentoirs, mannequins) : pas portés.
    if (name.startsWith("HF_Dsp_")) continue;
    const socket = SOCKETS.find(([pattern]) => pattern.test(name))?.[1];
    if (!socket) continue;
    await writeOptimized(await io.read(file), `accessories/${name}.glb`);
    catalog.accessories.push({ id: name, socket, file: `accessories/${name}.glb` });
  }

  await writeFile(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
  const counts = Object.entries(catalog).map(([key, list]) => `${list.length} ${key}`);
  console.log(`Catalogue écrit : ${counts.join(", ")}`);
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
    bodies.push({ id: `${race}_${gender}`, race, gender, source: `races/${file}` });
  }
  return bodies;
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
