// Produit, à partir des fichiers bruts de assets-source/ (voir import-assets.sh), les modèles optimisés
// chargés par le jeu, dans packages/client/public/models/ (ceux-là sont versionnés).
// Usage : node scripts/build-assets.mjs
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "assets-source");
const OUT = path.join(ROOT, "packages/client/public/models");

// Textures réduites (les originales font 4096 px) et converties en WebP : bien plus légères à télécharger.
const TEXTURE_SIZE = 1024;

// Animations gardées, par bibliothèque. Les autres (pêche, zombies, nage…) sont retirées.
const ANIMATIONS = {
  "UAL1_Standard.glb": [
    "Idle_Loop",
    "Walk_Loop",
    "Jog_Fwd_Loop",
    "Sprint_Loop",
    "Sword_Idle",
    "Sword_Attack",
    "Punch_Jab",
    "Punch_Cross",
    "Spell_Simple_Enter",
    "Spell_Simple_Idle_Loop",
    "Spell_Simple_Shoot",
    "Spell_Simple_Exit",
    "Hit_Chest",
    "Hit_Head",
    "Death01",
    "Roll",
    "Dance_Loop",
  ],
  "UAL2.glb": [
    "Walk_Bwd_Loop",
    "Walk_Bwd_L_Loop",
    "Walk_Bwd_R_Loop",
    "Walk_L_Loop",
    "Walk_R_Loop",
    "Walk_Fwd_L_Loop",
    "Walk_Fwd_R_Loop",
    "Idle_Shield_Loop",
    "Sword_Regular_A",
    "Sword_Regular_B",
    "Sword_Regular_C",
    "Sword_Block",
    "Shield_OneShot",
    "Hit_Knockback",
    "Yes",
  ],
};

// Personnages : une tenue complète (déjà assemblée sur le squelette) par classe.
const CHARACTERS = {
  gardien: "outfits/outfits/Male_Knight.gltf",
};

// Armes et objets tenus en main.
const WEAPONS = {
  sword: "weapons/Sword_Bronze.gltf",
  shield: "weapons/Shield_Wooden.gltf",
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ sharp });

async function optimize(doc) {
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
  );
}

async function buildModel(source, target) {
  const doc = await io.read(path.join(SOURCE, source));
  await optimize(doc);
  await io.write(path.join(OUT, target), doc);
  report(target);
}

// Bibliothèque d'animations : on retire le mannequin (seul le squelette sert) et les animations inutiles.
async function buildAnimations(file, keep) {
  const doc = await io.read(path.join(SOURCE, "animations", file));
  const root = doc.getRoot();
  const names = new Set(root.listAnimations().map((a) => a.getName()));
  const missing = keep.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`${file} : animations introuvables ${missing.join(", ")}`);
  for (const animation of root.listAnimations()) {
    if (keep.includes(animation.getName())) continue;
    // Les échantillons ne sont pas libérés avec l'animation : sans ça, leurs données resteraient dans le fichier.
    for (const sampler of animation.listSamplers()) sampler.dispose();
    for (const channel of animation.listChannels()) channel.dispose();
    animation.dispose();
  }
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  await doc.transform(resample(), prune({ keepLeaves: true }), dedup());
  const target = `animations/${path.basename(file, ".glb")}.glb`;
  await io.write(path.join(OUT, target), doc);
  report(target);
}

const sizes = [];
async function report(target) {
  const { size } = await import("node:fs").then((fs) => fs.promises.stat(path.join(OUT, target)));
  sizes.push([target, size]);
  console.log(`${target.padEnd(32)} ${(size / 1024 / 1024).toFixed(2)} Mo`);
}

await mkdir(path.join(OUT, "characters"), { recursive: true });
await mkdir(path.join(OUT, "animations"), { recursive: true });
await mkdir(path.join(OUT, "weapons"), { recursive: true });
for (const [file, keep] of Object.entries(ANIMATIONS)) await buildAnimations(file, keep);
for (const [id, source] of Object.entries(CHARACTERS)) await buildModel(source, `characters/${id}.glb`);
for (const [id, source] of Object.entries(WEAPONS)) await buildModel(source, `weapons/${id}.glb`);
