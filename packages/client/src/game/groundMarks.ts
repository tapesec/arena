import { Constants } from "@babylonjs/core/Engines/constants";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";

// Marques au sol (onglet « Marques au sol » de animation-lab.html), enregistrées dans groundMarks.json : un dessin
// (cercle, anneau, runes, rayons, fissures, créneaux) posé à plat sur le terrain, qui apparaît en grandissant,
// tourne, pulse et s'efface. Utilisées par les compétences comme les effets à particules (type « ground »).

export type GroundPattern = "disc" | "ring" | "runes" | "rays" | "cracks" | "crenels";

export interface GroundMarkDef {
  label: string;
  pattern: GroundPattern;
  color: string;
  // Opacité, et mélange lumineux (s'additionne à ce qui est dessous) ou opaque.
  alpha: number;
  glow: boolean;
  // Rayon (mètres) ; « à la taille de la zone » sur une compétence de zone le remplace par celui de la zone.
  radius: number;
  // Rayon intérieur (part du rayon) : creux d'un anneau, début des rayons et fissures, cercle des runes ; pour un
  // cercle plein, où commence son bord flou.
  inner: number;
  // Nombre de runes, rayons, fissures ou créneaux, et épaisseur des traits (part du rayon).
  count: number;
  thickness: number;
  // Tirage des formes au hasard (runes, fissures) : changer la graine donne un autre dessin.
  seed: number;
  // Apparition : grandit de appearScale à sa taille en appear secondes, en devenant visible en fadeIn secondes.
  appear: number;
  appearScale: number;
  fadeIn: number;
  // Disparition : s'efface en fadeOut secondes, à la fin de l'effet ou après duration secondes (0 : tant que
  // l'effet dure).
  fadeOut: number;
  duration: number;
  // Rotation (radians par seconde) et pulsation de l'opacité (amplitude 0 à 1, battements par seconde).
  spin: number;
  pulse: number;
  pulseSpeed: number;
}

export const DEFAULT_MARK: GroundMarkDef = {
  label: "Nouvelle marque",
  pattern: "ring",
  color: "#7fd0ff",
  alpha: 0.8,
  glow: true,
  radius: 1.5,
  inner: 0.8,
  count: 8,
  thickness: 0.04,
  seed: 1,
  appear: 0.3,
  appearScale: 0.4,
  fadeIn: 0.15,
  fadeOut: 0.5,
  duration: 0,
  spin: 0,
  pulse: 0,
  pulseSpeed: 1,
};

// Marques de départ, comme les effets du jeu convertis de l'atelier des particules.
export const BUILTIN_MARKS: Record<string, GroundMarkDef> = {
  frostCircle: { ...DEFAULT_MARK, label: "Cercle de givre", pattern: "runes", color: "#9fdcff", radius: 1.4, inner: 0.72, count: 10, spin: 0.4 },
  arcaneRunes: {
    ...DEFAULT_MARK,
    label: "Runes arcaniques",
    pattern: "runes",
    color: "#c08cff",
    radius: 1.6,
    inner: 0.7,
    count: 12,
    seed: 3,
    spin: -0.3,
    pulse: 0.25,
    pulseSpeed: 0.8,
  },
  fireCracks: { ...DEFAULT_MARK, label: "Fissures de feu", pattern: "cracks", color: "#ff8a2a", radius: 1.8, inner: 0.1, count: 9, thickness: 0.035, seed: 5, appear: 0.15, fadeOut: 1 },
  holyRays: { ...DEFAULT_MARK, label: "Rayons dorés", pattern: "rays", color: "#ffd86a", radius: 1.5, inner: 0.25, count: 16, thickness: 0.05, spin: 0.25 },
  healPool: { ...DEFAULT_MARK, label: "Flaque de soin", pattern: "disc", color: "#60f08a", alpha: 0.5, radius: 1.3, inner: 0.4, appear: 0.4, appearScale: 0.2, pulse: 0.2 },
  rampartWall: { ...DEFAULT_MARK, label: "Rempart crénelé", pattern: "crenels", color: "#4080ff", alpha: 0.85, radius: 3, inner: 0.94, count: 40, spin: 0.15, glow: false },
};

export const PATTERNS: Record<GroundPattern, string> = {
  disc: "Cercle plein",
  ring: "Anneau",
  runes: "Cercle de runes",
  rays: "Rayons",
  cracks: "Fissures",
  crenels: "Créneaux",
};

// Marques réglées et enregistrées (groundMarks.json), données par le jeu ou par la page de réglage.
let savedMarks: Record<string, GroundMarkDef> = {};

export function setGroundMarkDefs(defs: Record<string, GroundMarkDef>) {
  savedMarks = defs;
}

// Marque par son nom : sa version réglée, sinon celle de départ.
export function groundMarkDef(id: string): GroundMarkDef | null {
  const def = savedMarks[id] ?? BUILTIN_MARKS[id];
  return def ? { ...DEFAULT_MARK, ...def } : null;
}

export function groundMarkChoices(): { id: string; label: string }[] {
  const ids = new Set([...Object.keys(BUILTIN_MARKS), ...Object.keys(savedMarks)]);
  return [...ids].map((id) => ({ id, label: groundMarkLabel(id) }));
}

export function groundMarkLabel(id: string): string {
  return savedMarks[id]?.label ?? BUILTIN_MARKS[id]?.label ?? id;
}

// Hauteur au-dessus du sol (évite le scintillement avec le terrain).
const LIFT = 0.05;
// Taille de la texture dessinée.
const TEXTURE_SIZE = 512;
// Maillage qui épouse le relief : mailles d'au plus 1 m (comme la grille du terrain), au moins 4 par côté.
const CELL = 1;
const MIN_SUBDIVISIONS = 4;
const MAX_SUBDIVISIONS = 48;

// Marque posée : at est partagé (le déplacer déplace la marque), stop() lance sa disparition (remove() la retire
// aussitôt).
export interface GroundMark {
  at: Vector3;
  stop(): void;
  remove(): void;
}

interface Live {
  mark: GroundMark;
  def: GroundMarkDef;
  key: string;
  mesh: Mesh;
  // Position des sommets à la taille finale, sans rotation (x, z), pour recalculer leur hauteur.
  base: Float32Array;
  age: number;
  // Temps depuis le début de la disparition (null : visible).
  fading: number | null;
  // Placement pour lequel les hauteurs ont été calculées (position, taille, rotation).
  placed: string;
}

// Dessin partagé par les marques de mêmes réglages (une texture et un matériau), avec le nombre de marques qui
// l'utilisent.
interface Shared {
  material: StandardMaterial;
  users: number;
}

export class GroundMarks {
  private live: Live[] = [];
  private shared = new Map<string, Shared>();

  // heightAt : hauteur du sol en (x, z).
  constructor(
    private scene: Scene,
    private heightAt: (x: number, z: number) => number,
  ) {}

  // Pose une marque au sol sous at (un rayon imposé remplace celui de la marque ; tint : couleur imposée).
  create(id: string, at: Vector3, radius?: number, tint?: string, scale = 1): GroundMark | null {
    const def = groundMarkDef(id);
    if (!def) return null;
    return this.createFromDef(tint ? { ...def, color: tint } : def, at, radius ?? def.radius * scale);
  }

  createFromDef(def: GroundMarkDef, at: Vector3, radius = def.radius): GroundMark {
    const size = radius * 2;
    const subdivisions = Math.min(MAX_SUBDIVISIONS, Math.max(MIN_SUBDIVISIONS, Math.ceil(size / CELL)));
    const mesh = CreateGround("groundMark", { width: size, height: size, subdivisions, updatable: true }, this.scene);
    mesh.isPickable = false;
    const key = JSON.stringify(def);
    mesh.material = this.acquire(key, def);
    mesh.visibility = 0;
    const base = Float32Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!);
    const live: Live = {
      mark: { at, stop: () => this.fadeOut(live), remove: () => this.remove(live) },
      def,
      key,
      mesh,
      base,
      age: 0,
      fading: null,
      placed: "",
    };
    this.live.push(live);
    this.place(live, def.appear > 0 ? def.appearScale : 1, 0);
    return live.mark;
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
      const grow = def.appear > 0 ? Math.min(1, live.age / def.appear) : 1;
      const eased = 1 - (1 - grow) ** 3;
      this.place(live, def.appearScale + (1 - def.appearScale) * eased, live.age * def.spin);
      const fadeIn = def.fadeIn > 0 ? Math.min(1, live.age / def.fadeIn) : 1;
      const fadeOut = live.fading === null ? 1 : 1 - live.fading / Math.max(def.fadeOut, 1e-3);
      const pulse = 1 - def.pulse * (0.5 - 0.5 * Math.cos(live.age * def.pulseSpeed * Math.PI * 2));
      live.mesh.visibility = Math.max(0, Math.min(fadeIn, fadeOut) * pulse);
    }
  }

  dispose() {
    for (const live of [...this.live]) this.remove(live);
  }

  private acquire(key: string, def: GroundMarkDef): StandardMaterial {
    let shared = this.shared.get(key);
    if (!shared) {
      const material = new StandardMaterial("groundMark", this.scene);
      material.diffuseTexture = drawMark(this.scene, def);
      material.useAlphaFromDiffuseTexture = true;
      material.emissiveColor = Color3.White();
      material.diffuseColor = Color3.Black();
      material.specularColor = Color3.Black();
      material.disableLighting = true;
      material.disableDepthWrite = true;
      if (def.glow) material.alphaMode = Constants.ALPHA_ADD;
      material.zOffset = -2;
      shared = { material, users: 0 };
      this.shared.set(key, shared);
    }
    shared.users++;
    return shared.material;
  }

  private release(key: string) {
    const shared = this.shared.get(key);
    if (!shared || --shared.users > 0) return;
    shared.material.dispose(true, true);
    this.shared.delete(key);
  }

  private fadeOut(live: Live) {
    if (live.fading === null) live.fading = 0;
  }

  private remove(live: Live) {
    if (!this.live.includes(live)) return;
    live.mesh.dispose(false, false);
    this.release(live.key);
    this.live = this.live.filter((l) => l !== live);
  }

  // Suit son point d'accroche, posée sur le sol dont elle épouse le relief, à sa taille (scale) et tournée de angle
  // (radians). Les hauteurs ne sont recalculées que si l'un des trois a changé.
  private place(live: Live, scale: number, angle: number) {
    const { x, z } = live.mark.at;
    const placed = `${x.toFixed(2)},${z.toFixed(2)},${scale.toFixed(3)},${angle.toFixed(3)}`;
    if (placed === live.placed) return;
    live.placed = placed;
    const center = this.heightAt(x, z);
    live.mesh.position.set(x, center + LIFT, z);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const base = live.base;
    const positions = live.mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < positions.length; i += 3) {
      // Sommet à sa taille et tourné autour du centre, puis posé sur le sol à cet endroit.
      const px = (base[i] * cos - base[i + 2] * sin) * scale;
      const pz = (base[i] * sin + base[i + 2] * cos) * scale;
      positions[i] = px;
      positions[i + 1] = this.heightAt(x + px, z + pz) - center;
      positions[i + 2] = pz;
    }
    live.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    live.mesh.refreshBoundingInfo();
  }
}

// Tirage pseudo-aléatoire répétable (même graine, même dessin).
function random(seed: number): () => number {
  let state = Math.floor(seed * 9301 + 49297) % 233280 || 1;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

// Dessine la marque sur une texture transparente (centre au milieu, rayon au bord).
export function drawMark(scene: Scene, def: GroundMarkDef): DynamicTexture {
  const size = TEXTURE_SIZE;
  const texture = new DynamicTexture("groundMark", size, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  const r = c - 4;
  const rgb = hexToRgb(def.color);
  const color = (alpha: number) => `rgba(${rgb},${Math.max(0, Math.min(1, alpha))})`;
  const line = Math.max(1.5, def.thickness * r);
  const rand = random(def.seed);
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color(def.alpha);
  ctx.fillStyle = color(def.alpha);
  ctx.lineWidth = line;
  const circle = (radius: number) => {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.stroke();
  };
  switch (def.pattern) {
    case "disc": {
      const gradient = ctx.createRadialGradient(c, c, r * Math.min(def.inner, 0.99), c, c, r);
      gradient.addColorStop(0, color(def.alpha));
      gradient.addColorStop(1, color(0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ring": {
      ctx.beginPath();
      ctx.arc(c, c, r - line / 2, 0, Math.PI * 2);
      ctx.arc(c, c, Math.max(0, r * def.inner), 0, Math.PI * 2, true);
      ctx.fill();
      break;
    }
    case "runes": {
      circle(r - line / 2);
      circle(r * def.inner);
      const band = (r - line - r * def.inner) * 0.6;
      const middle = (r - line / 2 + r * def.inner) / 2;
      ctx.lineWidth = line * 0.8;
      for (let i = 0; i < def.count; i++) {
        const angle = (i / def.count) * Math.PI * 2;
        // Une rune : trois ou quatre traits au hasard dans une petite case, tournée vers le centre.
        ctx.save();
        ctx.translate(c + Math.cos(angle) * middle, c + Math.sin(angle) * middle);
        ctx.rotate(angle + Math.PI / 2);
        ctx.beginPath();
        const strokes = 3 + Math.floor(rand() * 2);
        for (let k = 0; k < strokes; k++) {
          ctx.moveTo((rand() - 0.5) * band, (rand() - 0.5) * band);
          ctx.lineTo((rand() - 0.5) * band, (rand() - 0.5) * band);
        }
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case "rays": {
      for (let i = 0; i < def.count; i++) {
        const angle = (i / def.count) * Math.PI * 2;
        const gradient = ctx.createLinearGradient(
          c + Math.cos(angle) * r * def.inner,
          c + Math.sin(angle) * r * def.inner,
          c + Math.cos(angle) * r,
          c + Math.sin(angle) * r,
        );
        gradient.addColorStop(0, color(def.alpha));
        gradient.addColorStop(1, color(0));
        ctx.strokeStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(angle) * r * def.inner, c + Math.sin(angle) * r * def.inner);
        ctx.lineTo(c + Math.cos(angle) * (r - line), c + Math.sin(angle) * (r - line));
        ctx.stroke();
      }
      break;
    }
    case "cracks": {
      for (let i = 0; i < def.count; i++) {
        let angle = (i / def.count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
        let distance = r * def.inner;
        let x = c + Math.cos(angle) * distance;
        let y = c + Math.sin(angle) * distance;
        // Le bout de la fissure reste dans le dessin (marge pour l'épaisseur du trait).
        const reach = (r - line) * (0.6 + rand() * 0.4);
        let width = line;
        while (distance < reach) {
          const step = Math.min(r * (0.06 + rand() * 0.08), reach - distance);
          angle += (rand() - 0.5) * 0.7;
          distance += step;
          const nx = c + Math.cos(angle) * distance;
          const ny = c + Math.sin(angle) * distance;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(nx, ny);
          ctx.stroke();
          x = nx;
          y = ny;
          // La fissure s'affine vers le bout.
          width = Math.max(1, width * 0.85);
        }
      }
      break;
    }
    case "crenels": {
      // Voile qui s'efface vers le centre, anneau, puis créneaux sur le bord extérieur (comme une tour vue de dessus).
      const veil = ctx.createRadialGradient(c, c, r * def.inner * 0.5, c, c, r * def.inner);
      veil.addColorStop(0, color(0));
      veil.addColorStop(1, color(def.alpha * 0.25));
      ctx.fillStyle = veil;
      ctx.beginPath();
      ctx.arc(c, c, r * def.inner, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color(def.alpha);
      const wall = r * def.inner + (r - r * def.inner) * 0.4;
      ctx.beginPath();
      ctx.arc(c, c, wall, 0, Math.PI * 2);
      ctx.arc(c, c, r * def.inner, 0, Math.PI * 2, true);
      ctx.fill();
      for (let i = 0; i < def.count; i++) {
        const a0 = (i / def.count) * Math.PI * 2;
        const a1 = a0 + Math.PI / def.count;
        ctx.beginPath();
        ctx.arc(c, c, r, a0, a1);
        ctx.arc(c, c, wall, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

function hexToRgb(hex: string): string {
  const value = parseInt(hex.replace("#", ""), 16) || 0;
  return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
}
