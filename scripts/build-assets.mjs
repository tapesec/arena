// Produit, à partir des fichiers bruts de assets-source/ (voir import-assets.sh), les modèles optimisés
// chargés par le jeu, dans packages/client/public/models/ (ceux-là sont versionnés).
// Usage : node scripts/build-assets.mjs
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, mergeDocuments, prune, resample, textureCompress, unpartition } from "@gltf-transform/functions";
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

// Personnages : une tenue complète par classe (déjà assemblée sur le squelette). Les tenues n'ont pas de tête :
// on y greffe celle du corps de base (body), avec ses yeux et sourcils, et des cheveux (hair).
// without : pièces de la tenue retirées.
const CHARACTERS = {
  gardien: { outfit: "Male_Knight" },
  lame: { outfit: "Male_Ranger", body: "Male" },
  arcaniste: { outfit: "Female_Wizard", body: "Female", hair: ["Hair_Long"] },
  pretre: { outfit: "Female_Noble", body: "Female", hair: ["Hair_Buns"], without: ["Female_Noble_Head_Crown"] },
  barde: { outfit: "Male_Peasant", body: "Male", hair: ["Hair_SimpleParted", "Hair_Beard"] },
};

// Couleur de tenue par équipe (0 bleu, 1 rouge, comme l'anneau au sol) : une des variantes fournies,
// ou une variante recolorée quand le pack n'a pas la couleur voulue (recolor, voir recolorTexture).
const TEAM_OUTFITS = {
  // La variante bleue du Knight a une armure dorée : on garde l'armure argent de la rouge et on en recolore le tissu.
  gardien: [
    { texture: "Knight/T_Knight_BaseColor.png", recolor: { from: 355, width: 20, to: 215, minSaturation: 0.3, boost: 1.1 } },
    { texture: "Knight/T_Knight_BaseColor.png" },
  ],
  pretre: [{ texture: "Noble/T_Noble_2_BaseColor.png" }, { texture: "Noble/T_Noble_BaseColor.png" }],
  arcaniste: [{ texture: "Wizard/T_Wizard_BaseColor.png" }, { texture: "Wizard/T_Wizard_3_BaseColor.png" }],
  // Le Ranger n'existe qu'en vert, noir ou beige : son vert devient bleu ou rouge.
  lame: [
    { texture: "Ranger/T_Ranger_BaseColor.png", recolor: { from: 115, width: 40, to: 215, minSaturation: 0.25 } },
    { texture: "Ranger/T_Ranger_BaseColor.png", recolor: { from: 115, width: 40, to: 6, minSaturation: 0.25 } },
  ],
  // Le Peasant a une variante bleue, mais terne et sombre : on la ravive, et on en tire la rouge.
  barde: [
    { texture: "Peasant/T_Peasant_3_BaseColor.png", recolor: { from: 195, width: 40, to: 212, minSaturation: 0.08, boost: 1.8, lighten: 1.2 } },
    { texture: "Peasant/T_Peasant_3_BaseColor.png", recolor: { from: 195, width: 40, to: 2, minSaturation: 0.08, boost: 2.6, lighten: 1.5 } },
  ],
};

const BODIES = {
  Male: "base/bodies/Superhero_Male_FullBody.gltf",
  Female: "base/bodies/Superhero_Female_FullBody.gltf",
};

// Os dont la tête découpée dans le corps de base garde les triangles.
const HEAD_BONES = new Set(["Head", "neck_01"]);

// Armes et objets tenus en main.
const WEAPONS = {
  sword: "weapons/Sword_Bronze.gltf",
  shield: "weapons/Shield_Wooden.gltf",
  dagger: "weapons/Weapon_Dagger.gltf",
  lute: "weapons/Weapon_Lute.gltf",
};

// Armes disponibles seulement en FBX : copiées telles quelles, Babylon sait les lire.
const FBX_WEAPONS = {
  staff: "weapons-fbx/rpg-asset-pack/Staff.fbx",
  "wooden-staff": "weapons-fbx/rpg-asset-pack/WoodenStaff.fbx",
  "ice-staff": "weapons-fbx/rpg-asset-pack/IceStaff.fbx",
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ sharp });

async function optimize(doc) {
  // Retire les sommets devenus inutiles (corps découpé autour de la tête).
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) compactPrimitive(primitive);
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
    // Un seul tampon de données, comme l'exige le format GLB (les fichiers fusionnés en apportent chacun un).
    unpartition(),
  );
}

async function buildModel(source, target) {
  const doc = await io.read(path.join(SOURCE, source));
  await optimize(doc);
  await io.write(path.join(OUT, target), doc);
  report(target);
}

// Personnage complet : tenue, plus tête, yeux, sourcils et cheveux rattachés au squelette de la tenue.
async function buildCharacter(id, def) {
  const doc = await io.read(path.join(SOURCE, "outfits/outfits", `${def.outfit}.gltf`));
  const root = doc.getRoot();
  for (const name of def.without ?? []) {
    const node = root.listNodes().find((n) => n.getName() === name);
    if (!node) throw new Error(`${id} : pièce introuvable ${name}`);
    node.dispose();
  }
  const skin = root.listSkins()[0];
  const armature = skin.listJoints()[0].getParentNode();
  const extras = [];
  if (def.body) {
    const body = await io.read(path.join(SOURCE, BODIES[def.body]));
    keepHeadOnly(body);
    extras.push(body);
  }
  for (const hair of def.hair ?? []) extras.push(await io.read(path.join(SOURCE, "base/hair", `${hair}.gltf`)));
  for (const extra of extras) attachToSkeleton(doc, skin, armature, extra);
  // La couleur de la tenue est chargée à part, selon l'équipe : la texture d'origine ne sert plus.
  const style = def.outfit.split("_")[1];
  const outfitMaterial = root.listMaterials().find((m) => m.getName() === `MI_${style}`);
  if (!outfitMaterial) throw new Error(`${id} : matériau introuvable MI_${style}`);
  outfitMaterial.setBaseColorTexture(null);
  await optimize(doc);
  const target = `characters/${id}.glb`;
  await io.write(path.join(OUT, target), doc);
  report(target);
}

// Fusionne les maillages articulés d'un autre fichier sur le squelette du personnage.
// Tous les packs partagent le même squelette, dans le même ordre : les indices d'os restent valables.
function attachToSkeleton(doc, skin, armature, extra) {
  const jointNames = skin.listJoints().map((j) => j.getName());
  const extraRoot = extra.getRoot();
  const extraJoints = extraRoot.listSkins()[0].listJoints().map((j) => j.getName());
  if (extraJoints.join() !== jointNames.join()) throw new Error("Squelettes différents : fusion impossible");
  const skinned = extraRoot.listNodes().filter((n) => n.getMesh() && n.getSkin());
  const others = extraRoot.listNodes().filter((n) => !skinned.includes(n));
  const map = mergeDocuments(doc, extra);
  for (const node of skinned) {
    const merged = map.get(node);
    merged.setSkin(skin);
    armature.addChild(merged);
  }
  // Le reste du fichier fusionné (sa scène, son squelette) ne sert plus.
  for (const node of others) map.get(node).dispose();
  for (const extraSkin of extraRoot.listSkins()) map.get(extraSkin).dispose();
  for (const scene of extraRoot.listScenes()) map.get(scene).dispose();
}

// Ne garde du corps de base que la tête et le cou : les triangles dont chaque sommet suit surtout ces os.
function keepHeadOnly(body) {
  const root = body.getRoot();
  const joints = root.listSkins()[0].listJoints().map((j) => j.getName());
  // Le corps est le maillage articulé le plus lourd (les autres sont les yeux et les sourcils).
  const node = root
    .listNodes()
    .filter((n) => n.getMesh() && n.getSkin())
    .sort((a, b) => vertexCount(b) - vertexCount(a))[0];
  for (const primitive of node.getMesh().listPrimitives()) {
    const jointsAttr = primitive.getAttribute("JOINTS_0");
    const weightsAttr = primitive.getAttribute("WEIGHTS_0");
    const indices = primitive.getIndices();
    const isHead = (vertex) => {
      const j = jointsAttr.getElement(vertex, []);
      const w = weightsAttr.getElement(vertex, []);
      let best = 0;
      for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
      return HEAD_BONES.has(joints[j[best]]);
    };
    const kept = [];
    const array = indices.getArray();
    for (let i = 0; i < array.length; i += 3) {
      if (isHead(array[i]) && isHead(array[i + 1]) && isHead(array[i + 2])) kept.push(array[i], array[i + 1], array[i + 2]);
    }
    indices.setArray(new Uint32Array(kept));
  }
}

function vertexCount(node) {
  return node
    .getMesh()
    .listPrimitives()
    .reduce((sum, p) => sum + p.getAttribute("POSITION").getCount(), 0);
}

// Textures de tenue des deux équipes d'une classe.
async function buildTeamOutfits(id, teams) {
  for (const [team, { texture, recolor }] of teams.entries()) {
    let image = sharp(path.join(SOURCE, "outfits/textures", texture)).resize(TEXTURE_SIZE, TEXTURE_SIZE).removeAlpha();
    if (recolor) {
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      recolorTexture(data, recolor);
      image = sharp(data, { raw: info });
    }
    const target = `characters/${id}-${team}.webp`;
    await image.webp().toFile(path.join(OUT, target));
    report(target);
  }
}

// Donne la teinte "to" (en degrés) aux pixels dont la teinte est à moins de "width" degrés de "from",
// en gardant leur luminosité. Les pixels trop gris (cuir, peau, métal) ne changent pas ; boost ravive la couleur,
// lighten éclaircit (un tissu sombre recoloré en rouge tirerait sur le brun).
function recolorTexture(data, { from, width, to, minSaturation, boost = 1, lighten = 1 }) {
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    const saturation = max ? delta / max : 0;
    if (!delta || saturation < minSaturation) continue;
    const sector = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    const offset = ((sector * 60 - from + 540) % 360) - 180;
    if (Math.abs(offset) > width) continue;
    // Une partie de l'écart d'origine est gardée, pour conserver les nuances du tissu.
    const hue = (to + offset * 0.3 + 360) % 360;
    const value = Math.min(1, max * lighten);
    const chroma = value * Math.min(1, saturation * boost);
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const [rr, gg, bb] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue / 60)];
    const m = value - chroma;
    data[i] = (rr + m) * 255;
    data[i + 1] = (gg + m) * 255;
    data[i + 2] = (bb + m) * 255;
  }
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
for (const [id, def] of Object.entries(CHARACTERS)) await buildCharacter(id, def);
for (const [id, teams] of Object.entries(TEAM_OUTFITS)) await buildTeamOutfits(id, teams);
for (const [id, source] of Object.entries(WEAPONS)) await buildModel(source, `weapons/${id}.glb`);
for (const [id, source] of Object.entries(FBX_WEAPONS)) {
  await copyFile(path.join(SOURCE, source), path.join(OUT, `weapons/${id}.fbx`));
  report(`weapons/${id}.fbx`);
}
