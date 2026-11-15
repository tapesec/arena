// Produit, à partir des fichiers bruts de assets-source/ (voir import-assets.sh), les modèles optimisés
// chargés par le jeu, dans packages/client/public/models/ (ceux-là sont versionnés).
// Usage : node scripts/build-assets.mjs              (tout)
//         node scripts/build-assets.mjs --characters (seulement les personnages et leurs armes)
//         node scripts/build-assets.mjs --ground     (seulement les textures du sol)
//         node scripts/build-assets.mjs --animations (seulement les bibliothèques d'animations, après un réglage
//                                                     de animation-lab.html qui utilise une nouvelle animation)
import { copyFile, mkdir, readFile } from "node:fs/promises";
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

// Personnages et armes, vus de près : compression plus douce. Les normal maps supportent mal la perte (le relief se couvre de
// petits blocs sous la lumière) : qualité 95 ; les couleurs en qualité 90. Le décor garde la qualité par défaut de
// sharp (80). Les deux passes supposent qu'aucune image ne sert à la fois de normal map et à un autre slot
// (sinon elle serait compressée deux fois) : c'est le cas des sources actuelles.
const CHARACTER_QUALITY = { normal: 95, color: 90 };

// Animations gardées, par bibliothèque. Les autres (pêche, zombies, nage…) sont retirées.
const ANIMATIONS = {
  "UAL1.glb": [
    "Idle_Loop",
    "Walk_Loop",
    "Jog_Fwd_Loop",
    // Course dans les autres directions (diagonales, pas de côté, recul).
    "Jog_Fwd_L_Loop",
    "Jog_Fwd_R_Loop",
    "Jog_Left_Loop",
    "Jog_Right_Loop",
    "Jog_Bwd_Loop",
    "Jog_Bwd_L_Loop",
    "Jog_Bwd_R_Loop",
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
    // Coup de pied de la Lame.
    "Kick",
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
    "Sword_Heavy_C",
    "Sword_Heavy_D",
    "Sword_Block",
    "Shield_OneShot",
    "Hit_Knockback",
    "Yes",
    // Stun : « non » de la tête une fois relevé, puis titubation ; root : marche entravée.
    "Idle_No_Loop",
    "Zombie_Idle_Loop",
    "Zombie_Walk_Fwd_Loop",
    // Rage de la Lame.
    "MonsterTransformation",
  ],
};

// Animations choisies dans animation-lab.html (animationTuning.json : animations du geste et réaction de la cible) :
// gardées aussi, dans la bibliothèque qui les contient (les animations Mixamo sont des fichiers à part).
async function tunedAnimations() {
  const tuning = JSON.parse(await readFile(path.join(ROOT, "packages/client/src/game/animationTuning.json"), "utf8"));
  const names = new Set();
  for (const entries of Object.values(tuning)) {
    for (const entry of Object.values(entries)) {
      // Ancien format (une seule animation) ou nouveau (suite d'animations).
      if (entry.animation) names.add(entry.animation);
      for (const clip of entry.clips ?? []) names.add(clip.animation);
      if (entry.impact?.reaction?.animation) names.add(entry.impact.reaction.animation);
    }
  }
  return names;
}

// Personnages : une tenue complète par classe (déjà assemblée sur le squelette), dans sa couleur d'origine (la même dans
// les deux équipes). Les tenues n'ont pas de tête : on y greffe celle du corps de base (body), avec ses yeux et
// sourcils, et des cheveux (hair).
// without : pièces de la tenue retirées.
const CHARACTERS = {
  gardien: { outfit: "Male_Knight" },
  lame: { outfit: "Male_Ranger", body: "Male" },
  arcaniste: { outfit: "Female_Wizard", body: "Female", hair: ["Hair_Long"] },
  pretre: { outfit: "Female_Noble", body: "Female", hair: ["Hair_Buns"], without: ["Female_Noble_Head_Crown"] },
  barde: { outfit: "Male_Peasant", body: "Male", hair: ["Hair_SimpleParted", "Hair_Beard"] },
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

async function optimize(doc, quality) {
  // Retire les sommets devenus inutiles (corps découpé autour de la tête).
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) compactPrimitive(primitive);
  const webp = { encoder: sharp, targetFormat: "webp", resize: [TEXTURE_SIZE, TEXTURE_SIZE] };
  await doc.transform(
    dedup(),
    prune(),
    ...(quality
      ? [
          textureCompress({ ...webp, slots: /^normalTexture$/, quality: quality.normal }),
          textureCompress({ ...webp, slots: /^(?!normalTexture$)/, quality: quality.color }),
        ]
      : [textureCompress(webp)]),
    // Un seul tampon de données, comme l'exige le format GLB (les fichiers fusionnés en apportent chacun un).
    unpartition(),
  );
}

async function buildModel(source, target, quality) {
  const doc = await io.read(path.join(SOURCE, source));
  await optimize(doc, quality);
  await io.write(path.join(OUT, target), doc);
  await report(target);
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
  await optimize(doc, CHARACTER_QUALITY);
  const target = `characters/${id}.glb`;
  await io.write(path.join(OUT, target), doc);
  await report(target);
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

// Pièces du hameau, réunies dans un seul fichier (elles partagent leurs textures) : le jeu assemble
// les maisons à partir des pièces du village et pose les accessoires.
const VILLAGE_PIECES = {
  village: [
    "Wall_UnevenBrick_Straight",
    "Wall_UnevenBrick_Window_Wide_Round",
    "Wall_UnevenBrick_Window_Thin_Round",
    "Wall_UnevenBrick_Door_Round",
    "Wall_Plaster_Straight",
    "Wall_Plaster_Window_Wide_Flat",
    "Wall_Plaster_Window_Thin_Round",
    "Wall_Plaster_WoodGrid",
    "Wall_Plaster_Door_Flat",
    "Corner_Exterior_Brick",
    "Corner_Exterior_Wood",
    "Wall_BottomCover",
    "Floor_WoodDark",
    "Roof_RoundTiles_6x6",
    "Roof_RoundTiles_6x8",
    "Roof_RoundTiles_8x8",
    "Roof_RoundTiles_8x10",
    "Roof_Front_Brick6",
    "Roof_Front_Brick8",
    "Door_1_Round",
    "Door_1_Flat",
    "Window_Wide_Round1",
    "Window_Wide_Flat1",
    "Window_Thin_Round1",
    "WindowShutters_Wide_Round_Open",
    "WindowShutters_Wide_Flat_Open",
    "WindowShutters_Thin_Round_Closed",
    "Prop_Vine1",
    "Prop_Vine2",
    "Prop_Vine4",
    "Prop_Chimney",
    "Prop_Wagon",
    "Prop_Crate",
    "Prop_WoodenFence_Single",
    "Prop_WoodenFence_Extension1",
  ],
  props: [
    "Stall_Empty",
    "Stall_Cart_Empty",
    "Crate_Wooden",
    "Barrel",
    "Barrel_Apples",
    "FarmCrate_Apple",
    "Banner_1",
    "Banner_1_Cloth",
    "Torch_Metal",
    "Bench",
  ],
};

// Nature autour de l'arène : arbres de la forêt des bords, buissons, rochers, herbes, fleurs et cailloux.
const NATURE_PIECES = {
  nature: [
    "CommonTree_1",
    "CommonTree_2",
    "CommonTree_3",
    "CommonTree_4",
    "CommonTree_5",
    "Pine_1",
    "Pine_2",
    "Pine_3",
    "Pine_4",
    "Pine_5",
    "TwistedTree_1",
    "TwistedTree_3",
    "Bush_Common",
    "Bush_Common_Flowers",
    "Rock_Medium_1",
    "Rock_Medium_2",
    "Rock_Medium_3",
    "Grass_Common_Short",
    "Grass_Common_Tall",
    "Grass_Wispy_Short",
    "Flower_3_Group",
    "Flower_4_Group",
    "Pebble_Round_1",
    "Pebble_Round_2",
    "Pebble_Square_1",
    "Plant_1",
    "Mushroom_Common",
  ],
};

// Bibliothèque de pièces : chacune regroupée sous un nœud à son nom, dans un seul fichier.
async function buildPieceLibrary(target, groups) {
  let doc = null;
  for (const [folder, pieces] of Object.entries(groups)) {
    for (const piece of pieces) {
      const part = await io.read(path.join(SOURCE, folder, `${piece}.gltf`));
      if (!doc) {
        doc = part;
        wrapScene(doc, doc.getRoot().listScenes()[0], piece);
        continue;
      }
      const scene = doc.getRoot().listScenes()[0];
      const partScene = part.getRoot().listScenes()[0];
      const map = mergeDocuments(doc, part);
      const merged = map.get(partScene);
      wrapScene(doc, merged, piece);
      for (const child of merged.listChildren()) scene.addChild(child);
      merged.dispose();
    }
  }
  await optimize(doc);
  await io.write(path.join(OUT, target), doc);
  await report(target);
}

// Regroupe le contenu d'une scène sous un nœud portant le nom de la pièce : le jeu la retrouve par ce nom.
function wrapScene(doc, scene, name) {
  const node = doc.createNode(name);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    node.addChild(child);
  }
  scene.addChild(node);
}

// Textures du sol, répétées sur le terrain : herbe et terre peintes à l'aquarelle (pack « Watercolor Terrain Textures »
// de Voxel Core Lab, CC0), pavés de la place. Herbe et terre en qualité 90 : la compression par défaut (80) délave les
// nuances de l'aquarelle. Les pavés, plus contrastés, la supportent bien.
const GROUND_TEXTURES = {
  grass: "ground/Grass_01.png",
  dirt: "ground/Dirt_03.png",
};

async function buildGround() {
  for (const [name, source] of Object.entries(GROUND_TEXTURES)) {
    const target = `ground/${name}.webp`;
    await sharp(path.join(SOURCE, source))
      .resize(TEXTURE_SIZE, TEXTURE_SIZE)
      .webp({ quality: 90 })
      .toFile(path.join(OUT, target));
    await report(target);
  }
  const target = "ground/paving.webp";
  await sharp(path.join(SOURCE, "ground/T_UnevenBrick_BaseColor.png")).resize(TEXTURE_SIZE, TEXTURE_SIZE).webp().toFile(path.join(OUT, target));
  await report(target);
}

// Bibliothèque d'animations : on retire le mannequin (seul le squelette sert) et les animations inutiles.
async function buildAnimations(file, keep) {
  const doc = await io.read(path.join(SOURCE, "animations", file));
  const root = doc.getRoot();
  const names = new Set(root.listAnimations().map((a) => a.getName()));
  const missing = keep.filter((name) => !names.has(name));
  for (const name of await tunedAnimations()) if (names.has(name) && !keep.includes(name)) keep = [...keep, name];
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
  await report(target);
}

const sizes = [];
async function report(target) {
  const { size } = await import("node:fs").then((fs) => fs.promises.stat(path.join(OUT, target)));
  sizes.push([target, size]);
  console.log(`${target.padEnd(32)} ${(size / 1024 / 1024).toFixed(2)} Mo`);
}

if (process.argv.includes("--ground")) {
  await mkdir(path.join(OUT, "ground"), { recursive: true });
  await buildGround();
  process.exit(0);
}
if (process.argv.includes("--characters")) {
  await mkdir(path.join(OUT, "characters"), { recursive: true });
  for (const [id, def] of Object.entries(CHARACTERS)) await buildCharacter(id, def);
  await mkdir(path.join(OUT, "weapons"), { recursive: true });
  for (const [id, source] of Object.entries(WEAPONS)) await buildModel(source, `weapons/${id}.glb`, CHARACTER_QUALITY);
  process.exit(0);
}
await mkdir(path.join(OUT, "animations"), { recursive: true });
const onlyAnimations = process.argv.includes("--animations");
if (!onlyAnimations) {
  await mkdir(path.join(OUT, "characters"), { recursive: true });
  await mkdir(path.join(OUT, "weapons"), { recursive: true });
  await mkdir(path.join(OUT, "ground"), { recursive: true });
  await buildGround();
  await mkdir(path.join(OUT, "village"), { recursive: true });
  await buildPieceLibrary("village/village.glb", VILLAGE_PIECES);
  await buildPieceLibrary("village/nature.glb", NATURE_PIECES);
}
for (const [file, keep] of Object.entries(ANIMATIONS)) await buildAnimations(file, keep);
if (!onlyAnimations) {
  for (const [id, def] of Object.entries(CHARACTERS)) await buildCharacter(id, def);
  for (const [id, source] of Object.entries(WEAPONS)) await buildModel(source, `weapons/${id}.glb`, CHARACTER_QUALITY);
  for (const [id, source] of Object.entries(FBX_WEAPONS)) {
    await copyFile(path.join(SOURCE, source), path.join(OUT, `weapons/${id}.fbx`));
    await report(`weapons/${id}.fbx`);
  }
}
