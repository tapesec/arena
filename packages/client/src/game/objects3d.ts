import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

// Objets 3D (onglet « Objets 3D » de animation-lab.html), enregistrés dans objects3d.json : une forme simple
// (sphère, anneau, cylindre, cône, cube, cristal, croissant), seule ou répétée en cercle, lumineuse ou éclairée,
// qui apparaît (en grandissant, en montant ou en descendant), tourne, flotte, change de taille et d'opacité au fil
// de sa vie, puis s'efface. Utilisés par les compétences comme les effets à particules (type « object »).
// Forme à part : les arcs électriques, des traits lumineux en zigzag autour du point d'accroche, redessinés au hasard
// plusieurs fois par seconde (crépitement).

export type ObjectForm = "sphere" | "torus" | "cylinder" | "cone" | "box" | "crystal" | "crescent" | "arcs";

export interface ObjectDef {
  label: string;
  form: ObjectForm;
  // Taille (mètres) : largeur, hauteur, profondeur.
  size: [number, number, number];
  // Anneau : épaisseur (part du diamètre) ; cylindre : diamètre du haut (part de celui du bas) ; croissant :
  // épaisseur au milieu (part du rayon).
  thickness: number;
  // Cylindre et cône ouverts aux deux bouts (rayon de lumière).
  open: boolean;
  // Inclinaison de la forme (degrés autour des axes x, y, z).
  tilt: [number, number, number];
  // Tournée vers la caméra (estafilade, anneau de contour) ; roll : rotation au hasard dans le plan de l'écran.
  billboard: boolean;
  roll: boolean;
  // Répétition : count exemplaires en cercle de rayon ring (mètres), penchés vers l'extérieur de lean degrés, de
  // taille variant au hasard de variation (0 à 1).
  count: number;
  ring: number;
  lean: number;
  variation: number;
  seed: number;
  // Couleur, opacité, lumineuse (sans éclairage, peut s'additionner à ce qui est derrière) ou éclairée (reflets).
  color: string;
  alpha: number;
  glow: boolean;
  additive: boolean;
  // Apparition en appear secondes : taille de départ (part de la taille) et décalage vertical de départ (mètres :
  // négatif, sort du sol ; positif, descend du ciel), en devenant visible en fadeIn secondes.
  appear: number;
  appearScale: number;
  appearRise: number;
  // Se déploie vers le bas depuis son sommet pendant l'apparition (rayon qui descend du ciel).
  unfoldDown: boolean;
  fadeIn: number;
  // Au fil de sa vie (duration secondes ; 0 : tant que l'effet dure) : taille et opacité atteintes à la fin (× celles
  // de départ). Puis disparition en fadeOut secondes.
  duration: number;
  endScale: number;
  endAlpha: number;
  // Part de la vie pendant laquelle taille et opacité restent celles de départ avant d'évoluer (0 à 1).
  lifeHold: number;
  // L'évolution de la taille ne touche que la largeur et la profondeur (éclair aplati, onde au sol).
  flatGrowth: boolean;
  fadeOut: number;
  // Rotation autour de la verticale (radians par seconde), flottement (amplitude en mètres, battements par
  // seconde), pulsation de l'opacité (0 à 1).
  spin: number;
  bob: number;
  bobSpeed: number;
  pulse: number;
  // Arcs électriques : count arcs sur un cercle de rayon ring, jusqu'à size[1] de haut, d'épaisseur thickness
  // (mètres). Redessinés flicker fois par seconde ; zigzag : écart des coudes (part de la longueur de l'arc) ;
  // span : longueur d'un arc le long du cercle (degrés).
  flicker: number;
  jag: number;
  span: number;
}

export const DEFAULT_OBJECT: ObjectDef = {
  label: "Nouvel objet",
  form: "sphere",
  size: [0.6, 0.6, 0.6],
  thickness: 0.15,
  open: false,
  tilt: [0, 0, 0],
  billboard: false,
  roll: false,
  count: 1,
  ring: 0.6,
  lean: 0,
  variation: 0,
  seed: 1,
  color: "#9fd8ff",
  alpha: 0.8,
  glow: true,
  additive: false,
  appear: 0.2,
  appearScale: 0.3,
  appearRise: 0,
  unfoldDown: false,
  fadeIn: 0.1,
  duration: 0,
  endScale: 1,
  endAlpha: 1,
  lifeHold: 0,
  flatGrowth: false,
  fadeOut: 0.4,
  spin: 0,
  bob: 0,
  bobSpeed: 1,
  pulse: 0,
  flicker: 14,
  jag: 0.25,
  span: 80,
};

// Objets du jeu (dessinés jusqu'ici dans le code) convertis en réglages, comme point de départ.
export const BUILTIN_OBJECTS: Record<string, ObjectDef> = {
  slash: {
    ...DEFAULT_OBJECT,
    label: "Estafilade",
    form: "crescent",
    size: [1.6, 1.6, 1.6],
    thickness: 0.28,
    billboard: true,
    roll: true,
    color: "#fff2cc",
    alpha: 1,
    additive: true,
    appear: 0,
    appearScale: 1,
    fadeIn: 0,
    duration: 0.25,
    endScale: 1.75,
    endAlpha: 0,
    fadeOut: 0,
  },
  lightBeam: {
    ...DEFAULT_OBJECT,
    label: "Rayon de lumière",
    form: "cylinder",
    size: [1, 9, 1],
    thickness: 1.6,
    open: true,
    color: "#ffd973",
    alpha: 0.55,
    additive: true,
    appear: 0.35,
    appearScale: 1,
    unfoldDown: true,
    fadeIn: 0,
    duration: 1.4,
    endAlpha: 0,
    lifeHold: 0.25,
    fadeOut: 0,
  },
  pulseSphere: {
    ...DEFAULT_OBJECT,
    label: "Sphère lumineuse",
    form: "sphere",
    size: [0.8, 0.8, 0.8],
    color: "#ffe066",
    alpha: 0.5,
    appear: 0,
    appearScale: 1,
    fadeIn: 0,
    duration: 0.5,
    endScale: 3,
    endAlpha: 0,
    fadeOut: 0,
  },
  meleeFlash: {
    ...DEFAULT_OBJECT,
    label: "Éclair aplati",
    form: "sphere",
    size: [0.7, 0.25, 0.7],
    color: "#ffffff",
    alpha: 0.9,
    flatGrowth: true,
    appear: 0,
    appearScale: 1,
    fadeIn: 0,
    duration: 0.25,
    endScale: 3,
    endAlpha: 0,
    fadeOut: 0,
  },
  iceCrystals: {
    ...DEFAULT_OBJECT,
    label: "Cristaux de glace",
    form: "crystal",
    size: [0.28, 0.75, 0.28],
    count: 7,
    ring: 0.55,
    lean: 20,
    variation: 0.4,
    seed: 2,
    color: "#73b8ff",
    alpha: 0.8,
    glow: false,
    appear: 0.25,
    appearScale: 0.2,
    appearRise: -0.3,
    fadeOut: 0.6,
  },
  bubble: {
    ...DEFAULT_OBJECT,
    label: "Bulle irisée",
    form: "sphere",
    size: [2.4, 2.4, 2.4],
    color: "#8066cc",
    alpha: 0.12,
    appear: 0.2,
    appearScale: 0.85,
    fadeIn: 0.2,
    duration: 1.5,
    fadeOut: 0.5,
    pulse: 0.1,
  },
  bubbleRim: {
    ...DEFAULT_OBJECT,
    label: "Contour de bulle",
    form: "torus",
    size: [2.35, 2.35, 2.35],
    thickness: 0.03,
    tilt: [90, 0, 0],
    billboard: true,
    color: "#9980ff",
    alpha: 0.8,
    additive: true,
    appear: 0.2,
    appearScale: 0.85,
    fadeIn: 0.2,
    duration: 1.5,
    fadeOut: 0.5,
  },
  orb: {
    ...DEFAULT_OBJECT,
    label: "Cœur de projectile",
    form: "sphere",
    size: [1, 1, 1],
    color: "#ffffff",
    alpha: 1,
    appear: 0,
    appearScale: 1,
    fadeIn: 0,
    fadeOut: 0,
  },
  sparkArcs: {
    ...DEFAULT_OBJECT,
    label: "Arcs électriques",
    form: "arcs",
    size: [0.5, 0.45, 0.5],
    thickness: 0.05,
    count: 3,
    ring: 0.45,
    color: "#a8dcff",
    alpha: 1,
    additive: true,
    appear: 0,
    appearScale: 1,
    fadeIn: 0.05,
    fadeOut: 0.15,
  },
  frostRing: {
    ...DEFAULT_OBJECT,
    label: "Anneau de givre",
    form: "torus",
    size: [0.4, 0.4, 0.4],
    thickness: 0.1,
    color: "#59b3ff",
    alpha: 0.8,
    additive: true,
    flatGrowth: true,
    appear: 0,
    appearScale: 1,
    fadeIn: 0,
    duration: 1.2,
    endScale: 7,
    endAlpha: 0,
    fadeOut: 0,
  },
};

export const FORMS: Record<ObjectForm, string> = {
  sphere: "Sphère",
  torus: "Anneau",
  cylinder: "Cylindre",
  cone: "Cône",
  box: "Cube",
  crystal: "Cristal",
  crescent: "Croissant (estafilade)",
  arcs: "Arcs électriques",
};

let savedObjects: Record<string, ObjectDef> = {};

export function setObjectDefs(defs: Record<string, ObjectDef>) {
  savedObjects = defs;
}

// Les réglages absents d'un enregistrement (ajoutés depuis) reprennent ceux de l'objet de départ.
export function objectDef(id: string): ObjectDef | null {
  if (!savedObjects[id] && !BUILTIN_OBJECTS[id]) return null;
  return { ...DEFAULT_OBJECT, ...BUILTIN_OBJECTS[id], ...savedObjects[id] };
}

export function objectChoices(): { id: string; label: string }[] {
  const ids = new Set([...Object.keys(BUILTIN_OBJECTS), ...Object.keys(savedObjects)]);
  return [...ids].map((id) => ({ id, label: objectLabel(id) }));
}

export function objectLabel(id: string): string {
  return savedObjects[id]?.label ?? BUILTIN_OBJECTS[id]?.label ?? id;
}

// Rayon d'un objet (mètres), pour l'étendre à une zone : celui de son cercle, sinon de sa forme.
export function objectRadius(def: ObjectDef): number {
  // Arcs électriques : leur cercle, plus l'écart des coudes.
  if (def.form === "arcs") return def.ring * (1 + def.jag / 2);
  return def.count > 1 ? def.ring + Math.max(def.size[0], def.size[2]) / 2 : Math.max(def.size[0], def.size[2]) / 2;
}

// Objet posé : at est partagé (le déplacer déplace l'objet), stop() lance sa disparition, remove() le retire.
// aim : direction vers laquelle pointer sa profondeur (axe z) ; null, il garde sa propre orientation.
export interface PlacedObject {
  at: Vector3;
  aim: Vector3 | null;
  // Recalcule sa pose tout de suite (après un changement de aim, avant la prochaine image).
  refresh(): void;
  stop(): void;
  remove(): void;
}

interface Live {
  object: PlacedObject;
  // Répétition en cercle tournée vers la caméra : angle de chaque exemplaire (sa rotation suit spin).
  angles: number[] | null;
  def: ObjectDef;
  root: TransformNode;
  meshes: Mesh[];
  material: StandardMaterial;
  // Agrandissement imposé (objet étendu à une zone).
  fit: number;
  age: number;
  fading: number | null;
  // Arcs électriques : temps avant le prochain redessin, et arcs allumés à ce redessin.
  arcs: { wait: number; lit: boolean[] } | null;
}

const DEG = Math.PI / 180;
// Matériaux gardés prêts au-delà desquels ceux qui ne servent plus sont détruits.
const MAX_SPARE_MATERIALS = 48;

export class Objects3D {
  private live: Live[] = [];
  // Formes et matériaux partagés entre les exemplaires (un même sort revient sans cesse) : copier un maillage modèle
  // et réutiliser un matériau déjà compilé coûte bien moins que les recréer (0,5 à 1 ms par exemplaire).
  private forms = new Map<string, Mesh>();
  private materials = new Map<string, { material: StandardMaterial; users: number }>();

  constructor(private scene: Scene) {}

  // Pose un objet en at (radius : rayon de la zone à laquelle l'étendre ; tint : couleur imposée).
  create(id: string, at: Vector3, radius?: number, tint?: string, scale = 1): PlacedObject | null {
    const def = objectDef(id);
    if (!def) return null;
    const size = def.size.map((v) => v * scale) as [number, number, number];
    return this.createFromDef({ ...def, size, ring: def.ring * scale, ...(tint && { color: tint }) }, at, radius);
  }

  createFromDef(def: ObjectDef, at: Vector3, radius?: number): PlacedObject {
    const root = new TransformNode("object3d", this.scene);
    const material = this.takeMaterial(def);
    const rand = random(def.seed);
    const meshes: Mesh[] = [];
    const count = Math.max(1, Math.round(def.count));
    const arcs = def.form === "arcs";
    for (let i = 0; i < count && arcs; i++) {
      // Arcs électriques : leurs points sont calculés en mètres, autour du point d'accroche (voir drawArcs).
      // Une seule face : le matériau ne cache pas l'arrière (sinon, en mode additif, l'arc serait dessiné deux fois).
      const mesh = CreateRibbon("object3d", { pathArray: arcPaths(ARC_POINTS), updatable: true }, this.scene);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.parent = root;
      mesh.visibility = 0;
      meshes.push(mesh);
    }
    for (let i = 0; i < count && !arcs; i++) {
      const mesh = this.form(def);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.parent = root;
      const scale = 1 - def.variation * rand();
      mesh.scaling.set(def.size[0] * scale, def.size[1] * scale, def.size[2] * scale);
      mesh.rotation.set(def.tilt[0] * DEG, def.tilt[1] * DEG, def.tilt[2] * DEG);
      if (count > 1) {
        // En cercle, chacun penché vers l'extérieur.
        const angle = (i / count) * Math.PI * 2;
        mesh.position.set(Math.cos(angle) * def.ring, 0, Math.sin(angle) * def.ring);
        mesh.rotation.x += Math.sin(angle) * def.lean * DEG;
        mesh.rotation.z += -Math.cos(angle) * def.lean * DEG;
      }
      if (def.billboard) mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      if (def.roll) mesh.rotation.z += rand() * Math.PI * 2;
      mesh.visibility = 0;
      meshes.push(mesh);
    }
    // Étendu à une zone : sa plus grande taille (en fin de vie s'il grandit) prend le rayon de la zone.
    const largest = Math.max(1, def.duration > 0 ? def.endScale : 1);
    const fit = radius !== undefined ? radius / Math.max(objectRadius(def) * largest, 0.05) : 1;
    const object: PlacedObject = {
      at,
      aim: null,
      refresh: () => this.animate(live),
      stop: () => this.fadeOut(live),
      remove: () => this.remove(live),
    };
    const angles = def.billboard && count > 1 && !arcs ? meshes.map((_, i) => (i / count) * Math.PI * 2) : null;
    const live: Live = { object, angles, def, root, meshes, material, fit, age: 0, fading: null, arcs: arcs ? { wait: 0, lit: [] } : null };
    this.live.push(live);
    this.animate(live);
    if (live.arcs) this.drawArcs(live);
    return object;
  }

  update(dt: number) {
    for (const live of [...this.live]) {
      live.age += dt;
      const def = live.def;
      if (live.fading === null && def.duration > 0 && live.age >= def.duration) live.fading = 0;
      if (live.fading !== null) live.fading += dt;
      if (live.fading !== null && live.fading >= def.fadeOut) {
        this.remove(live);
        continue;
      }
      this.animate(live);
      if (live.arcs && (live.arcs.wait -= dt) <= 0) this.drawArcs(live);
    }
  }

  // Redessine les arcs électriques au hasard : chacun part d'un point du cercle vers un autre, en zigzag, à une
  // hauteur au hasard ; ses bords font face à la caméra (un ruban plat, plus lumineux au milieu). Certains restent
  // éteints jusqu'au prochain redessin (crépitement).
  private drawArcs(live: Live) {
    const def = live.def;
    const arcs = live.arcs!;
    arcs.wait = 1 / Math.max(1, def.flicker);
    // Caméra dans le repère de l'objet (tourné et agrandi), pour orienter les rubans.
    const camera = this.scene.activeCamera;
    live.root.computeWorldMatrix(true);
    live.root.getWorldMatrix().invertToRef(inverseRoot);
    const eye = camera ? Vector3.TransformCoordinates(camera.globalPosition, inverseRoot) : new Vector3(0, 10, -10);
    live.meshes.forEach((mesh, i) => {
      arcs.lit[i] = Math.random() < 0.8;
      const a0 = Math.random() * Math.PI * 2;
      const span = def.span * DEG * (0.6 + 0.8 * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      const r0 = def.ring * (0.7 + 0.3 * Math.random());
      const r1 = def.ring * (0.7 + 0.3 * Math.random());
      const h0 = Math.random() * def.size[1] * 0.3;
      const h1 = Math.random() * def.size[1];
      const start = new Vector3(Math.cos(a0) * r0, h0, Math.sin(a0) * r0);
      const end = new Vector3(Math.cos(a0 + span) * r1, h1, Math.sin(a0 + span) * r1);
      const jag = def.jag * Vector3.Distance(start, end);
      const centre: Vector3[] = [];
      for (let k = 0; k <= ARC_POINTS; k++) {
        const t = k / ARC_POINTS;
        const angle = a0 + span * t;
        const radius = r0 + (r1 - r0) * t;
        const point = new Vector3(Math.cos(angle) * radius, h0 + (h1 - h0) * t, Math.sin(angle) * radius);
        // Coudes au hasard, sauf aux deux bouts.
        if (k > 0 && k < ARC_POINTS) point.addInPlaceFromFloats((Math.random() - 0.5) * 2 * jag, (Math.random() - 0.5) * jag, (Math.random() - 0.5) * 2 * jag);
        centre.push(point);
      }
      const left: Vector3[] = [];
      const right: Vector3[] = [];
      centre.forEach((point, k) => {
        const previous = centre[Math.max(0, k - 1)];
        const next = centre[Math.min(ARC_POINTS, k + 1)];
        const along = next.subtract(previous);
        const side = Vector3.Cross(along, eye.subtract(point));
        // Plus fin aux deux bouts.
        const width = def.thickness * (0.35 + 0.65 * Math.sin(Math.PI * (k / ARC_POINTS)));
        side.normalize().scaleInPlace(width / 2);
        left.push(point.subtract(side));
        right.push(point.add(side));
      });
      CreateRibbon("object3d", { pathArray: [left, centre, right], instance: mesh });
    });
    this.animate(live);
  }

  dispose() {
    for (const live of [...this.live]) this.remove(live);
    for (const model of this.forms.values()) model.dispose();
    this.forms.clear();
    for (const { material } of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  private animate(live: Live) {
    const def = live.def;
    const age = live.age;
    const grow = def.appear > 0 ? Math.min(1, age / def.appear) : 1;
    const eased = 1 - (1 - grow) ** 3;
    // Au fil de la vie (jusqu'à la disparition), après la part tenue.
    const raw = def.duration > 0 ? Math.min(1, age / def.duration) : 0;
    const life = def.lifeHold < 1 ? Math.max(0, (raw - def.lifeHold) / (1 - def.lifeHold)) : 0;
    const appear = def.unfoldDown ? 1 : def.appearScale + (1 - def.appearScale) * eased;
    const lifeScale = 1 + (def.endScale - 1) * life;
    const wide = appear * lifeScale * live.fit;
    const tall = appear * (def.flatGrowth ? 1 : lifeScale) * live.fit;
    // Déploiement vers le bas : la hauteur grandit de 0 à 1, le sommet reste en place (linéaire, comme une chute).
    const unfold = def.unfoldDown ? (def.appear > 0 ? Math.min(1, age / def.appear) : 1) : 1;
    const drop = def.unfoldDown ? def.size[1] * (1 - unfold) * tall : 0;
    const rise = def.appearRise * (1 - eased);
    const bob = def.bob * Math.sin(age * def.bobSpeed * Math.PI * 2);
    live.root.position.set(live.object.at.x, live.object.at.y + rise + bob + drop, live.object.at.z);
    live.root.scaling.set(wide, tall * unfold, wide);
    if (live.angles) {
      // Tournés vers la caméra, ils ignorent la rotation de leur parent : on les place sur leur cercle.
      live.meshes.forEach((mesh, i) => {
        const angle = live.angles![i] + age * def.spin;
        mesh.position.set(Math.cos(angle) * def.ring, 0, Math.sin(angle) * def.ring);
      });
    } else if (live.object.aim && live.object.aim.lengthSquared() > 1e-8) {
      // Pointé dans le sens du trajet (sa profondeur, axe z, vers aim), en tournant sur lui-même autour de cet axe.
      const aim = live.object.aim;
      const pitch = -Math.asin(Math.max(-1, Math.min(1, aim.y / aim.length())));
      live.root.rotationQuaternion ??= new Quaternion();
      Quaternion.RotationYawPitchRollToRef(Math.atan2(aim.x, aim.z), pitch, age * def.spin, live.root.rotationQuaternion);
    } else {
      live.root.rotationQuaternion = null;
      live.root.rotation.y = age * def.spin;
    }
    const fadeIn = def.fadeIn > 0 ? Math.min(1, age / def.fadeIn) : 1;
    const fadeOut = live.fading === null ? 1 : 1 - live.fading / Math.max(def.fadeOut, 1e-3);
    const pulse = 1 - def.pulse * (0.5 - 0.5 * Math.cos(age * Math.PI * 2));
    const visibility = Math.max(0, Math.min(fadeIn, fadeOut) * (1 + (def.endAlpha - 1) * life) * pulse);
    live.meshes.forEach((mesh, i) => (mesh.visibility = live.arcs && !live.arcs.lit[i] ? 0 : visibility));
  }

  private fadeOut(live: Live) {
    if (live.fading === null) live.fading = 0;
  }

  private remove(live: Live) {
    if (!this.live.includes(live)) return;
    live.root.dispose(false, false);
    this.releaseMaterial(live.material);
    this.live = this.live.filter((l) => l !== live);
  }

  // Maillage d'un exemplaire, qui partage la géométrie du modèle de sa forme (créé à la première demande, caché).
  private form(def: ObjectDef): Mesh {
    const key = `${def.form}|${def.thickness}|${def.open}`;
    let model = this.forms.get(key);
    if (!model) {
      model = buildForm(this.scene, def);
      model.isPickable = false;
      model.setEnabled(false);
      this.forms.set(key, model);
    }
    const mesh = new Mesh("object3d", this.scene);
    model.geometry?.applyToMesh(mesh);
    return mesh;
  }

  // Matériau d'un réglage, partagé par ses exemplaires (il n'est jamais modifié après sa création).
  private takeMaterial(def: ObjectDef): StandardMaterial {
    const key = `${def.form === "arcs"}|${def.color}|${def.glow}|${def.alpha}|${def.open}|${def.form === "crescent"}|${def.additive}`;
    let entry = this.materials.get(key);
    if (!entry) {
      entry = { material: objectMaterial(this.scene, def), users: 0 };
      this.materials.set(key, entry);
    }
    entry.users++;
    return entry.material;
  }

  // Un exemplaire disparaît : son matériau reste prêt pour le prochain, sauf s'il y en a trop d'inutilisés (réglages
  // essayés à la suite sur la page de réglage).
  private releaseMaterial(material: StandardMaterial) {
    for (const entry of this.materials.values()) if (entry.material === material) entry.users--;
    if (this.materials.size <= MAX_SPARE_MATERIALS) return;
    for (const [key, entry] of this.materials) {
      if (entry.users > 0) continue;
      entry.material.dispose();
      this.materials.delete(key);
    }
  }
}

// Forme de taille 1 (posée sur sa base pour les formes verticales), agrandie ensuite par size.
function buildForm(scene: Scene, def: ObjectDef): Mesh {
  switch (def.form) {
    case "sphere":
      return CreateSphere("object3d", { diameter: 1, segments: 16 }, scene);
    case "torus":
      return CreateTorus("object3d", { diameter: 1, thickness: Math.max(0.005, def.thickness), tessellation: 48 }, scene);
    case "box":
      return CreateBox("object3d", { size: 1 }, scene);
    case "cylinder":
    case "cone":
    case "crystal": {
      const top = def.form === "cylinder" ? Math.max(0, def.thickness) : 0;
      const mesh = CreateCylinder(
        "object3d",
        {
          height: 1,
          diameterTop: top,
          diameterBottom: 1,
          tessellation: def.form === "crystal" ? 4 : 32,
          cap: def.open ? Mesh.NO_CAP : Mesh.CAP_ALL,
        },
        scene,
      );
      mesh.position.y = 0.5;
      mesh.bakeCurrentTransformIntoVertices();
      return mesh;
    }
    case "arcs":
      // Les arcs sont construits à part (createFromDef).
      return CreateRibbon("object3d", { pathArray: arcPaths(ARC_POINTS) }, scene);
    case "crescent": {
      // Croissant dans le plan vertical, plus épais au milieu, effilé aux deux bouts.
      const outer: Vector3[] = [];
      const inner: Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const angle = -1.1 + t * 2.2;
        const thickness = def.thickness * Math.sin(Math.PI * t);
        outer.push(new Vector3(Math.sin(angle) * 0.5, (Math.cos(angle) - 0.5) * 0.5, 0));
        inner.push(new Vector3(Math.sin(angle) * (1 - thickness) * 0.5, ((Math.cos(angle) - 0.5) * (1 - thickness) - thickness * 0.5) * 0.5, 0));
      }
      return CreateRibbon("object3d", { pathArray: [outer, inner], sideOrientation: Mesh.DOUBLESIDE }, scene);
    }
  }
}

// Points d'un arc électrique (et donc ses coudes).
const ARC_POINTS = 10;
const inverseRoot = new Matrix();

// Trois chemins vides (bord, milieu, bord) d'un ruban d'arc, avant son premier dessin.
function arcPaths(points: number): Vector3[][] {
  return [0, 1, 2].map((side) => Array.from({ length: points + 1 }, (_, k) => new Vector3(k * 0.01, side * 0.01, 0)));
}

// Dégradé en travers d'un arc : lumineux au milieu, transparent aux bords (une texture par scène).
const arcGlows = new WeakMap<Scene, DynamicTexture>();
function arcGlow(scene: Scene): DynamicTexture {
  let texture = arcGlows.get(scene);
  if (!texture) {
    texture = new DynamicTexture("arcGlow", { width: 4, height: 64 }, scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "black");
    gradient.addColorStop(0.35, "rgb(90,90,90)");
    gradient.addColorStop(0.5, "white");
    gradient.addColorStop(0.65, "rgb(90,90,90)");
    gradient.addColorStop(1, "black");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 64);
    texture.update();
    arcGlows.set(scene, texture);
  }
  return texture;
}

function objectMaterial(scene: Scene, def: ObjectDef): StandardMaterial {
  const material = new StandardMaterial("object3d", scene);
  if (def.form === "arcs") {
    // Toujours lumineux et additionné : le dégradé (noir aux bords) disparaît sur le fond.
    material.emissiveColor = Color3.FromHexString(def.color);
    material.emissiveTexture = arcGlow(scene);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.alpha = def.alpha;
    material.alphaMode = Constants.ALPHA_ADD;
    return material;
  }
  const color = Color3.FromHexString(def.color);
  if (def.glow) {
    material.emissiveColor = color;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
  } else {
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.45);
    material.specularColor = Color3.White();
    material.specularPower = 64;
  }
  material.alpha = def.alpha;
  material.backFaceCulling = def.open || def.form === "crescent" ? false : material.backFaceCulling;
  if (def.additive) material.alphaMode = Constants.ALPHA_ADD;
  return material;
}

function random(seed: number): () => number {
  let state = Math.floor(seed * 9301 + 49297) % 233280 || 1;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}
