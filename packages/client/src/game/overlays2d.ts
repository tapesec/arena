import { Constants } from "@babylonjs/core/Engines/constants";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { createDefRegistry } from "./defRegistry";

// Affichage 2D (onglet « Affichage 2D » de animation-lab.html), enregistré dans overlays2d.json : un texte ou un
// symbole (★ ♥ ♪ Z !…) toujours tourné vers la caméra, de taille fixe en mètres ou à l'écran, seul, en ronde autour
// du point d'accroche ou qui monte en s'effaçant (les « Zzz » du mez). Utilisé par les compétences comme les effets à
// particules (type « overlay »).

export type OverlayLayout = "single" | "orbit" | "rise";

export interface OverlayDef {
  label: string;
  // Texte ; pour « monte », les mots (séparés par des espaces) apparaissent à tour de rôle.
  text: string;
  bold: boolean;
  color: string;
  // Contour (couleur, épaisseur en part de la hauteur des lettres ; 0 : sans contour).
  outline: string;
  outlineWidth: number;
  alpha: number;
  glow: boolean;
  // Hauteur des lettres : en mètres, ou en pixels à l'écran (screen : même taille quelle que soit la distance).
  size: number;
  screen: boolean;
  // Hauteur au-dessus du point d'accroche (mètres), et dessiné par-dessus le décor et les personnages (une
  // information de jeu ne disparaît pas derrière un mur ou une tête).
  lift: number;
  onTop: boolean;
  layout: OverlayLayout;
  // Ronde : nombre d'exemplaires, rayon (mètres), vitesse (radians par seconde).
  count: number;
  radius: number;
  speed: number;
  // Monte : un nouveau toutes les interval secondes, qui vit life secondes en montant de rise mètres par seconde,
  // en ondulant de drift mètres sur le côté, et grandit jusqu'à growth fois sa taille.
  interval: number;
  life: number;
  rise: number;
  drift: number;
  growth: number;
  // Apparition et disparition de l'ensemble, durée (0 : tant que l'effet dure), flottement et pulsation.
  appear: number;
  appearScale: number;
  fadeIn: number;
  fadeOut: number;
  duration: number;
  bob: number;
  bobSpeed: number;
  pulse: number;
  pulseSpeed: number;
}

export const DEFAULT_OVERLAY: OverlayDef = {
  label: "Nouvel affichage",
  text: "★",
  bold: true,
  color: "#ffe14a",
  outline: "#000000",
  outlineWidth: 0.08,
  alpha: 1,
  glow: false,
  size: 0.35,
  screen: false,
  lift: 0,
  onTop: true,
  layout: "single",
  count: 3,
  radius: 0.45,
  speed: 4,
  interval: 0.5,
  life: 1.5,
  rise: 0.4,
  drift: 0.1,
  growth: 1.5,
  appear: 0.15,
  appearScale: 0.5,
  fadeIn: 0.1,
  fadeOut: 0.3,
  duration: 0,
  bob: 0,
  bobSpeed: 1,
  pulse: 0,
  pulseSpeed: 1,
};

// Affichages du jeu (dessinés jusqu'ici dans le code) convertis en réglages, et quelques autres.
export const BUILTIN_OVERLAYS: Record<string, OverlayDef> = {
  zzz: {
    ...DEFAULT_OVERLAY,
    label: "Zzz du mez",
    text: "Z z z",
    color: "#c9a6ff",
    size: 13,
    screen: true,
    layout: "rise",
    interval: 0.5,
    life: 1.5,
    rise: 0.35,
    drift: 0.12,
    growth: 0.6,
  },
  stunStars: {
    ...DEFAULT_OVERLAY,
    label: "Étoiles du stun",
    text: "★",
    color: "#ffe14a",
    outline: "#fff8c0",
    outlineWidth: 0.05,
    glow: true,
    size: 0.26,
    layout: "orbit",
    count: 3,
    radius: 0.45,
    speed: 4,
    appear: 0,
    fadeIn: 0,
    fadeOut: 0,
  },
  tauntMarks: {
    ...DEFAULT_OVERLAY,
    label: "Provocation (!!!)",
    text: "!!!",
    color: "#ff3b30",
    size: 15,
    screen: true,
    duration: 2.5,
    pulse: 0.6,
    pulseSpeed: 1.6,
    bob: 0.05,
    bobSpeed: 1.6,
  },
  hearts: {
    ...DEFAULT_OVERLAY,
    label: "Cœurs qui montent",
    text: "♥",
    color: "#ff6fa8",
    size: 0.25,
    layout: "rise",
    interval: 0.4,
    life: 1.4,
    rise: 0.5,
    drift: 0.2,
    growth: 1.4,
  },
  notes: {
    ...DEFAULT_OVERLAY,
    label: "Notes qui montent",
    text: "♪ ♫",
    color: "#ffe9a0",
    glow: true,
    size: 0.3,
    layout: "rise",
    interval: 0.35,
    life: 1.6,
    rise: 0.45,
    drift: 0.25,
    growth: 1.2,
  },
  question: {
    ...DEFAULT_OVERLAY,
    label: "Point d'interrogation",
    text: "?",
    color: "#ffffff",
    size: 16,
    screen: true,
    lift: 0.5,
    bob: 0.06,
    bobSpeed: 1.2,
  },
};

export const LAYOUTS: Record<OverlayLayout, string> = {
  single: "Seul, au point d'accroche",
  orbit: "En ronde autour du point d'accroche",
  rise: "Monte en s'effaçant, l'un après l'autre",
};

// Réglages enregistrés (fichier JSON) et de départ.
const overlayDefs = createDefRegistry(DEFAULT_OVERLAY, BUILTIN_OVERLAYS);
export const setOverlayDefs = overlayDefs.set;
export const overlayDef = overlayDefs.get;
export const overlayChoices = overlayDefs.choices;
export const overlayLabel = overlayDefs.label;

// Affichage posé : at est partagé (le déplacer le déplace), stop() lance sa disparition, remove() le retire.
export interface PlacedOverlay {
  at: Vector3;
  stop(): void;
  remove(): void;
}

// Un exemplaire affiché : son texte, son âge (pour « monte ») et son décalage de départ.
interface Item {
  mesh: Mesh;
  // Rapport largeur / hauteur du texte, et hauteur de la texture rapportée à celle du texte.
  aspect: number;
  box: number;
  age: number;
  phase: number;
  key: string;
}

interface Live {
  overlay: PlacedOverlay;
  def: OverlayDef;
  items: Item[];
  age: number;
  fading: number | null;
  // « Monte » : temps avant le prochain, et rang du prochain mot.
  nextIn: number;
  word: number;
}

// Texte dessiné (une texture et un matériau) partagé par les exemplaires de mêmes réglages.
interface Shared {
  material: StandardMaterial;
  aspect: number;
  // Hauteur de la texture (marges comprises) rapportée à celle du texte.
  box: number;
  users: number;
}

const TEXT_HEIGHT = 128;
// Rapport entre la hauteur de la texture et celle d'une majuscule dessinée dedans.
const LETTER_TO_BOX = 1 / (0.8 * 0.72);

export class Overlays2D {
  private live: Live[] = [];
  private shared = new Map<string, Shared>();
  private position = new Vector3();

  constructor(private scene: Scene) {}

  create(id: string, at: Vector3, _radius?: number, tint?: string, scale = 1): PlacedOverlay | null {
    const def = overlayDef(id);
    if (!def) return null;
    return this.createFromDef({ ...def, size: def.size * scale, radius: def.radius * scale, ...(tint && { color: tint }) }, at);
  }

  createFromDef(def: OverlayDef, at: Vector3): PlacedOverlay {
    const overlay: PlacedOverlay = { at, stop: () => this.fadeOut(live), remove: () => this.remove(live) };
    const live: Live = { overlay, def, items: [], age: 0, fading: null, nextIn: 0, word: 0 };
    if (def.layout !== "rise") {
      const count = def.layout === "orbit" ? Math.max(1, Math.round(def.count)) : 1;
      for (let i = 0; i < count; i++) live.items.push(this.item(def, def.text, i / count));
    }
    this.live.push(live);
    this.animate(live, 0);
    return overlay;
  }

  update(dt: number) {
    for (const live of [...this.live]) {
      live.age += dt;
      const def = live.def;
      if (live.fading === null && def.duration > 0 && live.age >= def.duration) live.fading = 0;
      if (live.fading !== null) live.fading += dt;
      // Un affichage qui monte finit ses derniers exemplaires avant de disparaître.
      const done = live.fading !== null && live.fading >= def.fadeOut && (def.layout !== "rise" || !live.items.length);
      if (done) {
        this.remove(live);
        continue;
      }
      this.animate(live, dt);
    }
  }

  dispose() {
    for (const live of [...this.live]) this.remove(live);
  }

  private item(def: OverlayDef, text: string, phase: number): Item {
    const key = JSON.stringify([text, def.bold, def.color, def.outline, def.outlineWidth, def.alpha, def.glow]);
    const shared = this.acquire(key, def, text);
    const mesh = CreatePlane("overlay2d", { width: shared.aspect, height: 1 }, this.scene);
    mesh.material = shared.material;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.visibility = 0;
    // Groupe de rendu dessiné après la scène, sur un tampon de profondeur vidé : toujours visible.
    if (def.onTop) mesh.renderingGroupId = 1;
    return { mesh, aspect: shared.aspect, box: shared.box, age: 0, phase, key };
  }

  private animate(live: Live, dt: number) {
    const def = live.def;
    const age = live.age;
    const grow = def.appear > 0 ? Math.min(1, age / def.appear) : 1;
    const appear = def.appearScale + (1 - def.appearScale) * (1 - (1 - grow) ** 3);
    const fadeIn = def.fadeIn > 0 ? Math.min(1, age / def.fadeIn) : 1;
    const fadeOut = live.fading === null ? 1 : Math.max(0, 1 - live.fading / Math.max(def.fadeOut, 1e-3));
    const pulse = 1 - def.pulse * (0.5 - 0.5 * Math.cos(age * def.pulseSpeed * Math.PI * 2));
    const bob = def.bob * Math.sin(age * def.bobSpeed * Math.PI * 2) + def.lift;
    const visibility = Math.min(fadeIn, def.layout === "rise" ? 1 : fadeOut) * pulse;
    const at = live.overlay.at;

    if (def.layout === "rise") {
      // Un nouveau exemplaire à intervalle régulier, tant que l'affichage n'est pas en train de disparaître.
      live.nextIn -= dt;
      if (live.fading === null && live.nextIn <= 0) {
        const words = def.text.split(" ").filter(Boolean);
        live.items.push(this.item(def, words[live.word % Math.max(1, words.length)] ?? "", Math.random() * Math.PI * 2));
        live.word++;
        live.nextIn = Math.max(0.05, def.interval);
      }
      for (const item of [...live.items]) {
        item.age += dt;
        const t = item.age / Math.max(def.life, 0.05);
        if (t >= 1) {
          this.dropItem(live, item);
          continue;
        }
        // Apparaît vite, s'efface sur la fin de sa vie.
        const alpha = Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.4);
        this.position.set(at.x + Math.sin(item.phase + item.age * 3) * def.drift, at.y + def.rise * item.age + bob, at.z);
        this.place(item, def, this.position, appear * (1 + (def.growth - 1) * t));
        item.mesh.visibility = alpha * visibility;
      }
      return;
    }
    live.items.forEach((item) => {
      if (def.layout === "orbit") {
        // Tournés vers la caméra, ils sont placés un à un sur leur cercle, avec une légère ondulation.
        const angle = item.phase * Math.PI * 2 + age * def.speed;
        this.position.set(
          at.x + Math.cos(angle) * def.radius * appear,
          at.y + Math.sin(angle * 2) * 0.05 + bob,
          at.z + Math.sin(angle) * def.radius * appear,
        );
      } else this.position.set(at.x, at.y + bob, at.z);
      this.place(item, def, this.position, appear);
      item.mesh.visibility = visibility;
    });
  }

  // Pose un exemplaire, à sa taille en mètres, ou à sa taille à l'écran (selon sa distance à la caméra).
  private place(item: Item, def: OverlayDef, position: Vector3, scale: number) {
    item.mesh.position.copyFrom(position);
    let height = def.size;
    if (def.screen) {
      const camera = this.scene.activeCamera;
      const engine = this.scene.getEngine();
      if (camera) {
        const distance = Vector3.Distance(camera.globalPosition, position);
        // Hauteur du canvas en pixels CSS : la résolution du rendu varie avec la densité de l'écran (renderScale.ts).
        const cssHeight = engine.getRenderHeight(true) * engine.getHardwareScalingLevel();
        height = (def.size * 2 * distance * Math.tan(camera.fov / 2)) / Math.max(1, cssHeight);
      }
    }
    // La hauteur réglée est celle des lettres : la texture est plus haute (marges, police à 80 %, majuscule à ~70 %).
    item.mesh.scaling.setAll(height * scale * LETTER_TO_BOX * item.box);
  }

  private dropItem(live: Live, item: Item) {
    item.mesh.dispose(false, false);
    this.release(item.key);
    live.items = live.items.filter((i) => i !== item);
  }

  private fadeOut(live: Live) {
    if (live.fading === null) live.fading = 0;
  }

  private remove(live: Live) {
    if (!this.live.includes(live)) return;
    for (const item of [...live.items]) this.dropItem(live, item);
    this.live = this.live.filter((l) => l !== live);
  }

  private acquire(key: string, def: OverlayDef, text: string): Shared {
    let shared = this.shared.get(key);
    if (!shared) {
      const { texture, aspect, box } = drawText(this.scene, def, text);
      const material = new StandardMaterial("overlay2d", this.scene);
      material.diffuseTexture = texture;
      material.useAlphaFromDiffuseTexture = true;
      material.emissiveColor = Color3.White();
      material.diffuseColor = Color3.Black();
      material.specularColor = Color3.Black();
      material.disableLighting = true;
      material.disableDepthWrite = true;
      material.backFaceCulling = false;
      if (def.glow) material.alphaMode = Constants.ALPHA_ADD;
      shared = { material, aspect, box, users: 0 };
      this.shared.set(key, shared);
    }
    shared.users++;
    return shared;
  }

  private release(key: string) {
    const shared = this.shared.get(key);
    if (!shared || --shared.users > 0) return;
    shared.material.dispose(true, true);
    this.shared.delete(key);
  }
}

// Texte dessiné sur une texture transparente, à la hauteur TEXT_HEIGHT, avec son contour.
function drawText(scene: Scene, def: OverlayDef, text: string): { texture: DynamicTexture; aspect: number; box: number } {
  const font = `${def.bold ? "800" : "500"} ${TEXT_HEIGHT * 0.8}px system-ui, "Apple Symbols", "Segoe UI Symbol", sans-serif`;
  const outline = def.outlineWidth * TEXT_HEIGHT;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const width = Math.ceil(measure.measureText(text || " ").width + outline * 2 + 8);
  // Marge en haut et en bas pour le contour et les symboles plus hauts que les lettres.
  const pad = Math.ceil(outline + TEXT_HEIGHT * 0.15);
  const height = TEXT_HEIGHT + pad * 2;
  // Texture aux dimensions puissances de deux (mipmaps), le texte dessiné à sa taille dedans.
  const texture = new DynamicTexture("overlay2d", { width: pow2(width), height: pow2(height) }, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const sx = pow2(width) / width;
  const sy = pow2(height) / height;
  ctx.clearRect(0, 0, pow2(width), pow2(height));
  ctx.save();
  ctx.scale(sx, sy);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = def.alpha;
  if (outline > 0) {
    ctx.lineJoin = "round";
    ctx.lineWidth = outline * 2;
    ctx.strokeStyle = def.outline;
    ctx.strokeText(text, width / 2, height / 2);
  }
  ctx.fillStyle = def.color;
  ctx.fillText(text, width / 2, height / 2);
  ctx.restore();
  texture.hasAlpha = true;
  texture.update();
  return { texture, aspect: width / height, box: height / TEXT_HEIGHT };
}

function pow2(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}
