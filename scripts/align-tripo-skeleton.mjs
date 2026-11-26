// Donne aux os du squelette Tripo les mêmes axes (orientations au repos, dans le monde) que les os de même nom de
// notre Arcaniste, en gardant leurs positions : les animations Quaternius s'y branchent alors directement par nom,
// comme sur nos personnages. Les matrices de liaison sont recalculées : le maillage ne bouge pas.
// Usage : node scripts/align-tripo-skeleton.mjs <modèle Tripo riggé (squelette UE)>.glb <un de nos personnages>.glb
//   packages/client/public/dev-models/appearance/custom/<Nom>.glb (puis ajouter <Nom> à CUSTOM_MODELS)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { textureCompress } from "@gltf-transform/functions";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import sharp from "sharp";

const [tripoPath, refPath, outPath] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const tripo = await io.read(tripoPath);
const ref = await io.read(refPath);

const world = (node) => Matrix.FromArray(node.getWorldMatrix());
const parts = (m) => {
  const s = new Vector3(), r = new Quaternion(), t = new Vector3();
  m.decompose(s, r, t);
  return { s, r, t };
};
const byName = (doc) => new Map(doc.getRoot().listNodes().map((n) => [n.getName().toLowerCase(), n]));
const refNodes = byName(ref);
const skin = tripo.getRoot().listSkins()[0];
const joints = skin.listJoints();
const jointSet = new Set(joints);

// Repère de chaque personnage (contrôle : ils doivent regarder dans le même sens).
const frame = (nodes) => {
  const p = (n) => parts(world(nodes.get(n))).t;
  const x = p("upperarm_l").subtract(p("upperarm_r")).normalize();
  const up = p("neck_01").subtract(p("pelvis")).normalize();
  return { x: x.asArray().map((v) => +v.toFixed(2)), up: up.asArray().map((v) => +v.toFixed(2)) };
};
console.log("avant : repère Tripo", frame(byName(tripo)), "repère réf.", frame(refNodes));

// Tripo regarde dans une autre direction : le personnage entier est tourné autour de la verticale pour regarder comme
// notre Arcaniste (mêmes déplacements du bassin, même orientation dans le jeu).
{
  const side = (nodes) => {
    const p = (n) => parts(world(nodes.get(n))).t;
    const x = p("upperarm_l").subtract(p("upperarm_r"));
    return Math.atan2(x.z, x.x);
  };
  const angle = side(byName(tripo)) - side(refNodes);
  let turn = Matrix.RotationY(angle);
  const test = Vector3.TransformNormal(new Vector3(Math.cos(side(byName(tripo))), 0, Math.sin(side(byName(tripo)))), turn);
  if (Math.abs(Math.atan2(test.z, test.x) - side(refNodes)) > 1e-3) turn = Matrix.RotationY(-angle);
  for (const scene of tripo.getRoot().listScenes()) {
    for (const top of scene.listChildren()) {
      const { s, r, t } = parts(Matrix.FromArray(top.getMatrix()).multiply(turn));
      top.setTranslation(t.asArray()).setRotation(r.normalize().asArray()).setScale(s.asArray());
    }
  }
}
console.log("après : repère Tripo", frame(byName(tripo)));

// Nouvelles matrices monde, du haut vers le bas de la hiérarchie.
// Tous les nœuds sont concernés, pas seulement les os : le nœud « Armature », parent des os, doit aussi avoir
// l'orientation du nôtre, sinon les animations de l'os racine le remettent de travers.
const allNodes = tripo.getRoot().listNodes();
const originalWorld = new Map(allNodes.map((n) => [n, world(n)]));
const newWorld = new Map();
const matched = [], kept = [];
const visit = (node) => {
  {
    const orig = parts(originalWorld.get(node));
    const twin = refNodes.get(node.getName().toLowerCase());
    let w;
    if (twin) {
      w = Matrix.Compose(orig.s, parts(world(twin)).r, orig.t);
      matched.push(node.getName());
    } else if (jointSet.has(node) && node.getParentNode()) {
      // Os absent de nos animations (spine_04, métacarpes, torsion…) : mêmes axes que son parent, rotation locale
      // nulle ; il suit son parent sans tordre ses enfants, qui reçoivent nos rotations.
      const parent = node.getParentNode();
      w = Matrix.Compose(orig.s, parts(newWorld.get(parent) ?? world(parent)).r, orig.t);
      kept.push(node.getName());
    } else {
      w = originalWorld.get(node);
    }
    newWorld.set(node, w);
  }
  for (const child of node.listChildren()) visit(child);
};
for (const scene of tripo.getRoot().listScenes()) for (const n of scene.listChildren()) visit(n);

// Transformations locales : local = monde × inverse(monde du parent) (convention Babylon, vecteurs ligne).
for (const j of newWorld.keys()) {
  const parent = j.getParentNode();
  const parentWorld = parent ? (newWorld.get(parent) ?? world(parent)) : Matrix.Identity();
  const local = newWorld.get(j).multiply(Matrix.Invert(parentWorld));
  const { s, r, t } = parts(local);
  j.setTranslation(t.asArray()).setRotation(r.normalize().asArray()).setScale(s.asArray());
}

// Matrices de liaison : liaison' = liaison × monde d'origine × inverse(nouveau monde), même déformation au repos.
const ibm = skin.getInverseBindMatrices();
const array = ibm.getArray().slice();
joints.forEach((j, i) => {
  const bind = Matrix.FromArray(array, i * 16);
  const next = bind.multiply(originalWorld.get(j)).multiply(Matrix.Invert(newWorld.get(j)));
  next.copyToArray(array, i * 16);
});
ibm.setArray(array);

// Contrôle : la nouvelle hiérarchie redonne bien les mêmes positions d'os.
let maxGap = 0;
for (const j of allNodes) maxGap = Math.max(maxGap, parts(world(j)).t.subtract(parts(originalWorld.get(j)).t).length());
console.log({ alignés: matched.length, gardés: kept, écartPositionMax: maxGap });
// Taille : le bassin à la même hauteur que le nôtre (mêmes déplacements du bassin, même foulée au sol).
const pelvisY = (nodes) => parts(world(nodes.get("pelvis"))).t.y;
const factor = pelvisY(refNodes) / pelvisY(byName(tripo));
for (const scene of tripo.getRoot().listScenes()) {
  for (const top of scene.listChildren()) {
    const { s, r, t } = parts(Matrix.FromArray(top.getMatrix()).multiply(Matrix.Scaling(factor, factor, factor)));
    top.setTranslation(t.asArray()).setRotation(r.normalize().asArray()).setScale(s.asArray());
  }
}
// Noms d'os exactement ceux de notre squelette (« Head » : animations et accroche des chapeaux).
for (const j of joints) {
  const twin = refNodes.get(j.getName().toLowerCase());
  if (twin && twin.getName() !== j.getName()) j.setName(twin.getName());
}
// Textures en webp 1024 (comme nos personnages).
await tripo.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }));
console.log({ échelle: +factor.toFixed(3) });
await io.write(outPath, tripo);
