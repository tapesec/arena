import { Constants } from "@babylonjs/core/Engines/constants";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
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

export type ObjectForm = "sphere" | "torus" | "cylinder" | "cone" | "box" | "crystal" | "crescent";

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
};

let savedObjects: Record<string, ObjectDef> = {};

export function setObjectDefs(defs: Record<string, ObjectDef>) {
  savedObjects = defs;
}

export function objectDef(id: string): ObjectDef | null {
  const def = savedObjects[id] ?? BUILTIN_OBJECTS[id];
  return def ? { ...DEFAULT_OBJECT, ...def } : null;
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
  return def.count > 1 ? def.ring + Math.max(def.size[0], def.size[2]) / 2 : Math.max(def.size[0], def.size[2]) / 2;
}

// Objet posé : at est partagé (le déplacer déplace l'objet), stop() lance sa disparition, remove() le retire.
export interface PlacedObject {
  at: Vector3;
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
}

const DEG = Math.PI / 180;

export class Objects3D {
  private live: Live[] = [];

  constructor(private scene: Scene) {}

  // Pose un objet en at (radius : rayon de la zone à laquelle l'étendre).
  create(id: string, at: Vector3, radius?: number): PlacedObject | null {
    const def = objectDef(id);
    return def ? this.createFromDef(def, at, radius) : null;
  }

  createFromDef(def: ObjectDef, at: Vector3, radius?: number): PlacedObject {
    const root = new TransformNode("object3d", this.scene);
    const material = objectMaterial(this.scene, def);
    const rand = random(def.seed);
    const meshes: Mesh[] = [];
    const count = Math.max(1, Math.round(def.count));
    for (let i = 0; i < count; i++) {
      const mesh = buildForm(this.scene, def);
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
    const object: PlacedObject = { at, stop: () => this.fadeOut(live), remove: () => this.remove(live) };
    const angles = def.billboard && count > 1 ? meshes.map((_, i) => (i / count) * Math.PI * 2) : null;
    const live: Live = { object, angles, def, root, meshes, material, fit, age: 0, fading: null };
    this.live.push(live);
    this.animate(live);
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
    }
  }

  dispose() {
    for (const live of [...this.live]) this.remove(live);
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
    } else live.root.rotation.y = age * def.spin;
    const fadeIn = def.fadeIn > 0 ? Math.min(1, age / def.fadeIn) : 1;
    const fadeOut = live.fading === null ? 1 : 1 - live.fading / Math.max(def.fadeOut, 1e-3);
    const pulse = 1 - def.pulse * (0.5 - 0.5 * Math.cos(age * Math.PI * 2));
    const visibility = Math.max(0, Math.min(fadeIn, fadeOut) * (1 + (def.endAlpha - 1) * life) * pulse);
    for (const mesh of live.meshes) mesh.visibility = visibility;
  }

  private fadeOut(live: Live) {
    if (live.fading === null) live.fading = 0;
  }

  private remove(live: Live) {
    if (!this.live.includes(live)) return;
    live.root.dispose(false, false);
    live.material.dispose();
    this.live = this.live.filter((l) => l !== live);
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

function objectMaterial(scene: Scene, def: ObjectDef): StandardMaterial {
  const material = new StandardMaterial("object3d", scene);
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
