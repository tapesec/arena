// Donne aux os du squelette Tripo les mêmes axes (orientations au repos, dans le monde) que les os de même nom de
// notre Arcaniste, en gardant leurs positions : les animations Quaternius s'y branchent alors directement par nom,
// comme sur nos personnages. Les matrices de liaison sont recalculées : le maillage ne bouge pas.
// Usage : node scripts/align-tripo-skeleton.mjs <modèle Tripo riggé (squelette UE)>.glb <un de nos personnages>.glb
//   packages/client/public/dev-models/appearance/custom/<Nom>.glb [hauteur totale en mètres] [cape-epaules]
//   (options dans n'importe quel ordre ; puis ajouter <Nom> à CUSTOM_MODELS). Sans hauteur, le bassin est mis à la
//   hauteur du nôtre.
//   cape-epaules : la cape est rattachée aux épaules au lieu des bras (voir plus bas).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds, textureCompress } from "@gltf-transform/functions";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import sharp from "sharp";

const [tripoPath, refPath, outPath, ...options] = process.argv.slice(2);
// Options dans n'importe quel ordre : un nombre (hauteur totale), des drapeaux connus.
const FLAGS = new Set(["cape-epaules"]);
const heightArg = options.find((o) => o !== "" && !Number.isNaN(Number(o)));
const flags = options.filter((o) => o !== heightArg);
for (const flag of flags) if (!FLAGS.has(flag)) throw new Error(`Option inconnue : ${flag} (connues : ${[...FLAGS].join(", ")})`);
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

// Cape rattachée aux épaules (option cape-epaules) : le rigging automatique de Tripo fait suivre les bras (et le bassin,
// les jambes) à la cape, qui se plie, se froisse et se troue dès qu'ils bougent. La cape (couleur violette dans la
// texture, sous la base du cou, plus grand morceau d'un seul tenant) suit désormais le haut du buste d'un bloc : elle
// tombe des épaules et ne suit plus les bras. Les sommets d'un même point (coutures de texture) sont traités ensemble ;
// leur bordure (sommets voisins hors cape) est partagée entre le buste et ses os d'origine, pour s'étirer moins quand
// les bras bougent. Le maillage d'entrée est supposé dans sa pose de liaison (sommets en coordonnées du monde).
if (flags.includes("cape-epaules")) {
  const CAPE_HUE = [250, 320];
  const jointNames = skin.listJoints().map((j) => j.getName());
  // Haut du buste (spine_05, qui suit spine_03 dans nos animations) : les clavicules, elles, tournent quand les bras
  // descendent, et une cape longue qui leur est rattachée s'évase en cloche.
  const torso = jointNames.indexOf("spine_05");
  const neckIndex = jointNames.findIndex((n) => n.toLowerCase() === "neck_01");
  if (torso < 0 || neckIndex < 0) throw new Error("Os spine_05 ou neck_01 absent : cape-epaules impossible");
  // Base du cou dans l'espace de liaison (celui des sommets) : inverse de sa matrice de liaison.
  const neckY = Matrix.Invert(Matrix.FromArray(skin.getInverseBindMatrices().getArray(), neckIndex * 16)).m[13];
  const hue = (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 25) return -1;
    const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    return (h * 60 + 360) % 360;
  };
  const wrap = (u, mode) => (mode === 10497 ? u - Math.floor(u) : mode === 33648 ? 1 - Math.abs((u % 2 + 2) % 2 - 1) : Math.min(1, Math.max(0, u)));
  let total = 0;
  for (const node of tripo.getRoot().listNodes()) {
    if (node.getSkin() !== skin || !node.getMesh()) continue;
    for (const primitive of node.getMesh().listPrimitives()) {
      const material = primitive.getMaterial();
      const texture = material?.getBaseColorTexture();
      const textureInfo = material?.getBaseColorTextureInfo();
      const uvAcc = textureInfo && primitive.getAttribute(`TEXCOORD_${textureInfo.getTexCoord()}`);
      const jointsAcc = primitive.getAttribute("JOINTS_0"), weightsAcc = primitive.getAttribute("WEIGHTS_0");
      if (!texture || !uvAcc || !jointsAcc || !weightsAcc) continue;
      const { data, info } = await sharp(Buffer.from(texture.getImage())).raw().toBuffer({ resolveWithObject: true });
      const uv = uvAcc.getArray();
      const pos = primitive.getAttribute("POSITION").getArray();
      const count = pos.length / 3;
      // Points (sommets fusionnés par position) et leurs voisins par les triangles.
      const pointOf = new Int32Array(count);
      const keys = new Map();
      for (let v = 0; v < count; v++) {
        const key = `${Math.round(pos[v * 3] * 1e5)},${Math.round(pos[v * 3 + 1] * 1e5)},${Math.round(pos[v * 3 + 2] * 1e5)}`;
        if (!keys.has(key)) keys.set(key, keys.size);
        pointOf[v] = keys.get(key);
      }
      const indices = primitive.getIndices()?.getArray() ?? Uint32Array.from({ length: count }, (_, i) => i);
      const neighbours = Array.from({ length: keys.size }, () => new Set());
      for (let i = 0; i < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]].map((v) => pointOf[v]);
        for (const a of tri) for (const b of tri) if (a !== b) neighbours[a].add(b);
      }
      // Points violets sous la base du cou.
      const violet = new Uint8Array(keys.size);
      for (let v = 0; v < count; v++) {
        if (pos[v * 3 + 1] > neckY) continue;
        const px = Math.min(info.width - 1, Math.floor(wrap(uv[v * 2], textureInfo.getWrapS()) * info.width));
        const py = Math.min(info.height - 1, Math.floor(wrap(uv[v * 2 + 1], textureInfo.getWrapT()) * info.height));
        const i = (py * info.width + px) * info.channels;
        const h = hue(data[i], data[i + 1], data[i + 2]);
        if (h >= CAPE_HUE[0] && h <= CAPE_HUE[1]) violet[pointOf[v]] = 1;
      }
      // Plus grand morceau violet d'un seul tenant : la cape (les petits îlots ailleurs sur le corps sont ignorés).
      const component = new Int32Array(keys.size).fill(-1);
      let best = -1, bestSize = 0;
      for (let start = 0, id = 0; start < keys.size; start++) {
        if (!violet[start] || component[start] >= 0) continue;
        const stack = [start];
        component[start] = id;
        let size = 0;
        while (stack.length) {
          const p = stack.pop();
          size++;
          for (const n of neighbours[p]) if (violet[n] && component[n] < 0) { component[n] = id; stack.push(n); }
        }
        if (size > bestSize) { best = id; bestSize = size; }
        id++;
      }
      if (best < 0) continue;
      const cape = (point) => component[point] === best;
      const border = (point) => !cape(point) && [...neighbours[point]].some(cape);
      const J = jointsAcc.getArray().slice();
      const W = new Float32Array(count * 4);
      const element = [0, 0, 0, 0];
      for (let v = 0; v < count; v++) W.set(weightsAcc.getElement(v, element), v * 4);
      for (let v = 0; v < count; v++) {
        const point = pointOf[v];
        if (cape(point)) {
          // Un seul os, poids 1 (glTF : pas deux poids non nuls sur le même os).
          J.set([torso, 0, 0, 0], v * 4);
          W.set([1, 0, 0, 0], v * 4);
          total++;
        } else if (border(point)) {
          // Moitié buste, moitié os d'origine : le buste prend la place de son propre poids s'il en a un, sinon celle
          // du plus faible (dont la part est reportée sur les autres).
          const slots = [0, 1, 2, 3].map((k) => v * 4 + k);
          const slot = slots.find((s) => J[s] === torso && W[s] > 0) ?? slots.reduce((a, b) => (W[b] < W[a] ? b : a));
          const own = J[slot] === torso ? W[slot] : 0;
          W[slot] = 0;
          const rest = slots.reduce((sum, s) => sum + W[s], 0);
          for (const s of slots) W[s] = rest > 0 ? (W[s] / rest) * 0.5 * (1 - own) : 0;
          J[slot] = torso;
          W[slot] = rest > 0 ? 0.5 + 0.5 * own : 1;
        }
      }
      jointsAcc.setArray(J);
      weightsAcc.setNormalized(false).setArray(W);
    }
  }
  if (!total) throw new Error("cape-epaules : aucune cape violette trouvée sous le cou");
  console.log({ capeAuxEpaules: total });
}
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
  const gap = Math.atan2(test.z, test.x) - side(refNodes);
  if (Math.abs(Math.atan2(Math.sin(gap), Math.cos(gap))) > 1e-3) turn = Matrix.RotationY(-angle);
  for (const scene of tripo.getRoot().listScenes()) {
    for (const top of scene.listChildren()) {
      const { s, r, t } = parts(Matrix.FromArray(top.getMatrix()).multiply(turn));
      top.setTranslation(t.asArray()).setRotation(r.normalize().asArray()).setScale(s.asArray());
    }
  }
}
console.log("après : repère Tripo", frame(byName(tripo)));

// Nouvelles matrices monde, du haut vers le bas de la hiérarchie.
// Pose de repos : nos animations partent de bras à l'horizontale (pose en T). Un modèle généré dans une autre pose
// (pose A, bras baissés) est d'abord mis dans la nôtre : chaque os des membres est tourné pour pointer vers son enfant
// dans la même direction que chez nous, le maillage suit (habillage), puis cette pose devient la pose de repos. Les
// animations ramènent ensuite les bras en bas, et le maillage retrouve sa forme d'origine (cape qui pend).
{
  const CHAINS = { clavicle: "upperarm", upperarm: "lowerarm", lowerarm: "hand", hand: "middle_01", thigh: "calf", calf: "foot", foot: "ball" };
  for (const finger of ["thumb", "index", "middle", "ring", "pinky"]) Object.assign(CHAINS, { [`${finger}_01`]: `${finger}_02`, [`${finger}_02`]: `${finger}_03` });
  const childOf = (name) => {
    for (const side of ["l", "r"]) {
      for (const [from, to] of Object.entries(CHAINS)) if (name === `${from}_${side}`) return `${to}_${side}`;
    }
    return null;
  };
  const tripoNodes = byName(tripo);
  const position = (m) => parts(m).t;
  const posed = new Map();
  let turned = 0;
  const pose = (node, parentWorld) => {
    const local = Matrix.FromArray(node.getMatrix());
    let w = local.multiply(parentWorld);
    const childName = childOf(node.getName().toLowerCase());
    const child = childName && tripoNodes.get(childName);
    const refFrom = refNodes.get(node.getName().toLowerCase()), refTo = childName && refNodes.get(childName);
    // L'enfant peut être plus bas dans la hiérarchie (main → métacarpe → doigt) : son monde composé depuis cet os.
    let childLocal = child ? Matrix.FromArray(child.getMatrix()) : null;
    for (let up = child?.getParentNode(); childLocal && up !== node; up = up?.getParentNode()) {
      childLocal = up ? childLocal.multiply(Matrix.FromArray(up.getMatrix())) : null;
    }
    if (childLocal && refFrom && refTo) {
      const have = position(childLocal.multiply(w)).subtract(position(w)).normalize();
      const want = position(world(refTo)).subtract(position(world(refFrom))).normalize();
      const axis = Vector3.Cross(have, want);
      const angle = Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(have, want))));
      if (axis.length() > 1e-6 && angle > 1e-4) {
        const p = position(w);
        const rotation = Matrix.RotationAxis(axis.normalize(), angle);
        w = w.multiply(Matrix.Translation(-p.x, -p.y, -p.z)).multiply(rotation).multiply(Matrix.Translation(p.x, p.y, p.z));
        turned++;
      }
    }
    posed.set(node, w);
    for (const c of node.listChildren()) pose(c, w);
  };
  for (const scene of tripo.getRoot().listScenes()) for (const top of scene.listChildren()) pose(top, Matrix.Identity());

  // Maillage habillé dans cette pose (positions et normales en coordonnées du monde, comme le veut l'habillage glTF).
  const ibm = skin.getInverseBindMatrices();
  const ibmArray = ibm.getArray();
  const missing = joints.filter((j) => !posed.has(j));
  if (missing.length) throw new Error(`Os hors de la scène : ${missing.map((j) => j.getName()).join(", ")}`);
  const skinMatrices = joints.map((j, i) => Matrix.FromArray(ibmArray, i * 16).multiply(posed.get(j)));
  // Cas non gérés (absents des modèles Tripo) : refusés plutôt que transformés à moitié.
  const skinned = tripo.getRoot().listNodes().filter((n) => n.getSkin() === skin && n.getMesh());
  if (tripo.getRoot().listSkins().length > 1) throw new Error("Plusieurs squelettes : non géré");
  for (const node of tripo.getRoot().listNodes()) {
    if (node.getMesh() && node.getSkin() !== skin && skinned.some((n) => n.getMesh() === node.getMesh())) throw new Error("Maillage partagé avec un nœud non habillé : non géré");
  }
  const done = new Set();
  for (const node of skinned) {
    for (const primitive of node.getMesh().listPrimitives()) {
      const semantics = primitive.listSemantics();
      if (semantics.some((name) => /^(JOINTS|WEIGHTS)_[1-9]|^TANGENT$/.test(name)) || primitive.listTargets().length) {
        throw new Error(`Attributs non gérés : ${semantics.join(", ")}${primitive.listTargets().length ? ", cibles de morph" : ""}`);
      }
      const pos = primitive.getAttribute("POSITION"), nor = primitive.getAttribute("NORMAL");
      if (done.has(pos)) continue;
      if (nor && done.has(nor)) throw new Error("Normales partagées entre primitives : non géré");
      done.add(pos);
      if (nor) done.add(nor);
      const jointsAcc = primitive.getAttribute("JOINTS_0"), weightsAcc = primitive.getAttribute("WEIGHTS_0");
      const P = pos.getArray().slice(), N = nor?.getArray().slice();
      const joint = [0, 0, 0, 0], weight = [0, 0, 0, 0];
      for (let v = 0; v < pos.getCount(); v++) {
        jointsAcc.getElement(v, joint);
        weightsAcc.getElement(v, weight); // valeurs normalisées, quel que soit le type stocké
        const total = weight.reduce((a, b) => a + b, 0);
        if (!(total > 0)) continue; // sommet sans os : laissé tel quel
        const p = new Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        const n = N ? new Vector3(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) : null;
        const outP = Vector3.Zero(), outN = Vector3.Zero();
        for (let k = 0; k < 4; k++) {
          if (!weight[k]) continue;
          const m = skinMatrices[joint[k]];
          outP.addInPlace(Vector3.TransformCoordinates(p, m).scale(weight[k] / total));
          if (n) outN.addInPlace(Vector3.TransformNormal(n, m).scale(weight[k] / total));
        }
        P.set(outP.asArray(), v * 3);
        if (N) N.set(outN.normalize().asArray(), v * 3);
      }
      pos.setArray(P);
      if (N) nor.setArray(N);
    }
    // Sommets désormais en coordonnées du monde : le nœud du maillage, rattaché à la scène, ne transforme plus rien
    // (même pour un visualiseur qui appliquerait la transformation d'un nœud habillé).
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    node.getParentNode()?.removeChild(node);
    tripo.getRoot().listScenes()[0].addChild(node);
  }
  // La pose devient la pose de repos : transformations locales des os, et matrices de liaison = inverse du monde.
  for (const [node, w] of posed) {
    if (skinned.includes(node)) continue; // remis à l'identité ci-dessus
    const parent = node.getParentNode();
    const local = parent ? w.multiply(Matrix.Invert(posed.get(parent))) : w;
    const { s, r, t } = parts(local);
    node.setTranslation(t.asArray()).setRotation(r.normalize().asArray()).setScale(s.asArray());
  }
  const array = ibmArray.slice();
  joints.forEach((j, i) => Matrix.Invert(posed.get(j)).copyToArray(array, i * 16));
  ibm.setArray(array);
  console.log({ osMisEnPoseT: turned });
}

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
    } else if (node.getSkin() && node.getMesh()) {
      // Maillage habillé (sommets en coordonnées du monde) : aucune transformation propre.
      const parent = node.getParentNode();
      w = parent ? (newWorld.get(parent) ?? world(parent)) : Matrix.Identity();
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
// Taille : le bassin à la même hauteur au-dessus de l'os racine (aux pieds) que le nôtre (mêmes déplacements du
// bassin, même foulée au sol). L'échelle est appliquée aux positions (os, sommets, matrices de liaison) et non à un nœud :
// les os gardent une échelle 1, comme les nôtres, et les placements d'objets s'y règlent dans les mêmes unités.
const pelvisHeight = (nodes) => parts(world(nodes.get("pelvis"))).t.y - parts(world(nodes.get("root"))).t.y;
// Hauteur totale demandée (chapeau compris) : elle remplace le calage du bassin ; le jeu met alors les déplacements du
// bassin à l'échelle du modèle (scaledHipsAnimation).
const bounds = getBounds(tripo.getRoot().listScenes()[0]);
const factor = heightArg ? Number(heightArg) / (bounds.max[1] - bounds.min[1]) : pelvisHeight(refNodes) / pelvisHeight(byName(tripo));
if (!(factor > 0)) throw new Error(`Échelle impossible (${factor}) : bassin sous l'os racine ?`);
for (const node of tripo.getRoot().listNodes()) node.setTranslation(node.getTranslation().map((v) => v * factor));
const scaledAccessors = new Set();
for (const mesh of tripo.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    for (const accessor of [primitive.getAttribute("POSITION"), ...primitive.listTargets().map((t) => t.getAttribute("POSITION"))]) {
      if (!accessor || scaledAccessors.has(accessor)) continue;
      scaledAccessors.add(accessor);
      accessor.setArray(accessor.getArray().map((v) => v * factor));
    }
  }
}
{
  const array = ibm.getArray().slice();
  for (let i = 0; i < array.length; i += 16) for (const k of [12, 13, 14]) array[i + k] *= factor;
  ibm.setArray(array);
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
