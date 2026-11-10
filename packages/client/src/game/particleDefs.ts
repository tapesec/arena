import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import * as P from "./particles";
import type { ParticleFactory, ParticleTexture, Recipe } from "./particles";

// Effets à particules décrits par des réglages (onglet « Effets à particules » de animation-lab.html), enregistrés
// dans particleEffects.json. Un effet du code converti en réglages (BUILTIN_DEFS) sert de point de départ ; le jeu
// garde la version du code tant que l'effet n'a pas été modifié et enregistré sous le même nom.

export interface ParticleEffectDef {
  label: string;
  texture: ParticleTexture;
  // Lumineux (les particules qui se superposent s'éclaircissent) ou opaque (fumée, notes).
  blend: "add" | "normal";
  // Émission continue (rate particules par seconde) ou d'une seule gerbe (count particules). duration : arrêt
  // automatique après ce temps (secondes), 0 pour émettre tant que l'effet dure.
  emission: "continuous" | "burst";
  rate: number;
  count: number;
  duration: number;
  // Lieu de naissance, autour du point d'accroche (mètres) : une boule (rayon intérieur à extérieur) ou un cylindre
  // vertical (anneau de rayon intérieur à extérieur, de y à y + height). Avec arms > 0, les particules naissent sur
  // arms points du cercle extérieur qui tournent à spin radians par seconde (spirale, couronne).
  // « fingers » : doigts de lumière qui sortent du sol tout autour (arms doigts, sur un cercle de rayon radius,
  // longs de height) et se referment au-dessus du personnage en closeTime secondes, jusqu'à closeAmount (1 : les
  // bouts se rejoignent au centre) ; fingerWidth : épaisseur d'un doigt.
  shape: "sphere" | "cylinder" | "fingers";
  closeTime: number;
  closeAmount: number;
  fingerWidth: number;
  radius: number;
  innerRadius: number;
  y: number;
  height: number;
  arms: number;
  spin: number;
  // Part des particules qui naissent au centre exact (cœur d'une boule qui se forme).
  core: number;
  // Direction de départ : vers le haut, le bas, depuis le centre, vers le centre ou au hasard ; spread ajoute un
  // écart au hasard (0 à 1).
  direction: "up" | "down" | "outward" | "inward" | "random";
  spread: number;
  speed: [number, number];
  // Accélération verticale (m/s², positive vers le haut).
  gravity: number;
  life: [number, number];
  size: [number, number];
  // Taille en fin de vie, en proportion de la taille de naissance (1 : constante).
  growth: number;
  // Rotation de chaque particule (radians par seconde).
  rotation: [number, number];
  // Dégradé de couleur au fil de la vie (0 naissance, 1 mort), couleur et transparence.
  colors: { at: number; color: string; alpha: number }[];
  // Effet secondaire, sacrifié quand trop d'effets sont à l'écran.
  optional: boolean;
}

export const DEFAULT_DEF: ParticleEffectDef = {
  label: "Nouvel effet",
  texture: "glow",
  blend: "add",
  emission: "continuous",
  rate: 60,
  count: 40,
  duration: 0,
  shape: "sphere",
  radius: 0.3,
  innerRadius: 0,
  y: 0,
  height: 0,
  arms: 0,
  spin: 0,
  closeTime: 0.8,
  closeAmount: 1,
  fingerWidth: 0.06,
  core: 0,
  direction: "random",
  spread: 0,
  speed: [0.3, 0.8],
  gravity: 0,
  life: [0.5, 1],
  size: [0.15, 0.3],
  growth: 1,
  rotation: [0, 0],
  colors: [
    { at: 0, color: "#ffffff", alpha: 0.8 },
    { at: 1, color: "#80c0ff", alpha: 0 },
  ],
  optional: false,
};

const def = (overrides: Partial<ParticleEffectDef>): ParticleEffectDef => ({ ...DEFAULT_DEF, ...overrides });
const stops = (...list: [number, string, number][]) => list.map(([at, color, alpha]) => ({ at, color, alpha }));

// Effets du code portés par les personnages, convertis en réglages (même rendu, à de petites approximations près).
export const BUILTIN_DEFS: Record<string, ParticleEffectDef> = {
  fireCharge: def({
    label: "Formation de feu",
    rate: 180,
    radius: 0.45,
    innerRadius: 0.27,
    core: 0.2,
    direction: "inward",
    speed: [1.3, 1.7],
    life: [0.22, 0.3],
    size: [0.08, 0.26],
    colors: stops([0, "#ff5a10", 0], [0.35, "#ff9a30", 0.55], [1, "#fff0b0", 0.9]),
  }),
  frostCharge: def({
    label: "Formation de givre",
    rate: 180,
    radius: 0.45,
    innerRadius: 0.27,
    core: 0.2,
    direction: "inward",
    speed: [1.3, 1.7],
    life: [0.22, 0.3],
    size: [0.08, 0.26],
    colors: stops([0, "#2060e0", 0], [0.35, "#60b8ff", 0.65], [1, "#e0f6ff", 0.9]),
  }),
  notesAura: def({
    label: "Notes de musique",
    texture: "note",
    blend: "normal",
    rate: 5,
    radius: 0.7,
    speed: [0.1, 0.3],
    gravity: 0.6,
    life: [1.2, 1.8],
    size: [0.25, 0.4],
    colors: stops([0, "#ffe070", 0], [0.2, "#ffd050", 0.9], [1, "#ff9020", 0]),
    optional: true,
  }),
  noteBurst: def({
    label: "Gerbe de notes",
    texture: "note",
    blend: "normal",
    emission: "burst",
    count: 14,
    radius: 0.4,
    speed: [1, 2],
    gravity: 1,
    life: [0.8, 1.2],
    size: [0.3, 0.45],
    colors: stops([0, "#ffe070", 1], [0.7, "#ffb030", 0.9], [1, "#ff9020", 0]),
  }),
  buffSpiral: def({
    label: "Spirale de buff",
    rate: 160,
    duration: 0.6,
    shape: "cylinder",
    radius: 0.6,
    innerRadius: 0.6,
    y: 0.1,
    arms: 1,
    spin: 14,
    direction: "up",
    speed: [3, 3],
    life: [0.6, 0.8],
    size: [0.15, 0.3],
    colors: stops([0, "#fff0b0", 0.8], [0.5, "#ffcc40", 0.6], [1, "#a07000", 0]),
  }),
  rallyHalo: def({
    label: "Couronne dorée",
    rate: 60,
    shape: "cylinder",
    radius: 0.4,
    innerRadius: 0.4,
    y: 0.35,
    arms: 3,
    spin: 6,
    direction: "up",
    speed: [0.1, 0.1],
    life: [0.4, 0.6],
    size: [0.12, 0.22],
    colors: stops([0, "#fff0b0", 0.9], [0.5, "#ffcc40", 0.7], [1, "#a07000", 0]),
    optional: true,
  }),
  healColumn: def({
    label: "Colonne de soin",
    emission: "burst",
    count: 110,
    shape: "cylinder",
    radius: 0.7,
    innerRadius: 0.3,
    y: 0.1,
    direction: "up",
    speed: [1.5, 3],
    life: [0.6, 1.1],
    size: [0.12, 0.3],
    colors: stops([0, "#a0ffb0", 0.6], [0.3, "#50e070", 0.5], [1, "#108030", 0]),
  }),
  healFlash: def({
    label: "Éclair de soin",
    texture: "spark",
    emission: "burst",
    count: 70,
    radius: 0.5,
    speed: [1.5, 3],
    gravity: 2,
    life: [0.3, 0.6],
    size: [0.2, 0.45],
    colors: stops([0, "#c0ffc8", 0.7], [0.3, "#60f080", 0.55], [1, "#108030", 0]),
  }),
  resurrectRain: def({
    label: "Pluie de résurrection",
    rate: 220,
    duration: 1.2,
    shape: "cylinder",
    radius: 0.8,
    y: 6,
    direction: "down",
    speed: [5, 7],
    life: [0.8, 1.1],
    size: [0.15, 0.35],
    colors: stops([0, "#fff8d0", 0.8], [0.6, "#ffd860", 0.6], [1, "#c08000", 0]),
  }),
  mezHalo: def({
    label: "Volutes de mez",
    rate: 45,
    radius: 0.45,
    speed: [0.05, 0.25],
    gravity: 0.4,
    life: [0.8, 1.3],
    size: [0.15, 0.35],
    colors: stops([0, "#c080ff", 0], [0.3, "#a050ff", 0.5], [1, "#4010a0", 0]),
  }),
  frostMist: def({
    label: "Brume de givre",
    rate: 22,
    shape: "cylinder",
    radius: 0.8,
    innerRadius: 0.3,
    y: 0.1,
    direction: "up",
    speed: [0.1, 0.3],
    life: [0.8, 1.4],
    size: [0.3, 0.6],
    colors: stops([0, "#a0d8ff", 0], [0.3, "#80c0ff", 0.25], [1, "#4080d0", 0]),
    optional: true,
  }),
  frostCoat: def({
    label: "Givre sur le corps",
    texture: "spark",
    rate: 60,
    shape: "cylinder",
    radius: 0.4,
    innerRadius: 0.15,
    y: 0.1,
    height: 1.8,
    direction: "down",
    spread: 0.3,
    speed: [0.02, 0.07],
    life: [0.4, 0.9],
    size: [0.08, 0.2],
    colors: stops([0, "#ffffff", 0.9], [0.4, "#a8e4ff", 0.7], [1, "#3080d0", 0]),
    optional: true,
  }),
  bubbleShards: def({
    label: "Éclats de bulle",
    texture: "spark",
    emission: "burst",
    count: 60,
    radius: 1.1,
    speed: [2.5, 5],
    gravity: -4,
    life: [0.3, 0.6],
    size: [0.15, 0.35],
    rotation: [-6, 6],
    colors: stops([0, "#e8e0ff", 0.9], [0.3, "#a8a0ff", 0.7], [0.6, "#f0a0e0", 0.5], [1, "#6040c0", 0]),
  }),
  burning: def({
    label: "Flammes",
    rate: 150,
    shape: "cylinder",
    radius: 0.35,
    y: 0.2,
    height: 1.7,
    direction: "up",
    spread: 0.3,
    speed: [1, 2.2],
    life: [0.25, 0.5],
    size: [0.2, 0.45],
    colors: stops([0, "#ffd070", 0.6], [0.35, "#ff7020", 0.55], [0.8, "#b02000", 0.3], [1, "#300000", 0]),
  }),
  burningSmoke: def({
    label: "Fumée de brûlure",
    texture: "glow",
    blend: "normal",
    rate: 25,
    shape: "cylinder",
    radius: 0.3,
    y: 1,
    height: 1,
    direction: "up",
    speed: [0.6, 1.2],
    life: [0.6, 1],
    size: [0.35, 0.7],
    colors: stops([0, "#706050", 0.25], [1, "#404040", 0]),
    optional: true,
  }),
  critSparks: def({
    label: "Étincelles",
    texture: "spark",
    emission: "burst",
    count: 35,
    radius: 0.2,
    speed: [3, 6],
    gravity: -6,
    life: [0.2, 0.45],
    size: [0.12, 0.3],
    colors: stops([0, "#fff4c0", 0.9], [0.4, "#ffc040", 0.7], [1, "#a05000", 0]),
  }),
  speedDust: def({
    label: "Poussière",
    blend: "normal",
    rate: 35,
    radius: 0.3,
    speed: [0.2, 0.6],
    gravity: 0.5,
    life: [0.4, 0.7],
    size: [0.35, 0.7],
    colors: stops([0, "#8a6a48", 0.55], [1, "#6a5038", 0]),
    optional: true,
  }),
  rageFlames: def({
    label: "Flammes de rage",
    rate: 140,
    shape: "cylinder",
    radius: 0.55,
    innerRadius: 0.35,
    height: 1.6,
    direction: "up",
    speed: [1, 2],
    life: [0.3, 0.6],
    size: [0.18, 0.38],
    colors: stops([0, "#ff9050", 0.8], [0.4, "#ff2010", 0.7], [1, "#500000", 0]),
  }),
  rampartFlames: def({
    label: "Flammes du Rempart",
    rate: 260,
    shape: "cylinder",
    radius: 0.85,
    innerRadius: 0.55,
    height: 0.6,
    direction: "up",
    spread: 0.15,
    speed: [3, 4.5],
    life: [0.45, 0.8],
    size: [0.3, 0.6],
    colors: stops([0, "#ffb070", 0.85], [0.35, "#ff2a10", 0.75], [1, "#500000", 0]),
  }),
  chargeStreak: def({
    label: "Traînée de charge",
    rate: 320,
    radius: 0.35,
    speed: [0, 0],
    life: [0.25, 0.4],
    size: [0.3, 0.55],
    colors: stops([0, "#ffffff", 0.7], [0.4, "#a8d8ff", 0.5], [1, "#3060c0", 0]),
  }),
  arcaneColumn: def({
    label: "Colonne arcanique",
    rate: 220,
    shape: "cylinder",
    radius: 0.45,
    height: 0.5,
    direction: "up",
    speed: [3.5, 5],
    life: [0.6, 1],
    size: [0.25, 0.5],
    colors: stops([0, "#f0d8ff", 0.7], [0.3, "#b060ff", 0.6], [0.7, "#7020d0", 0.35], [1, "#300060", 0]),
  }),
  arcaneSparks: def({
    label: "Éclairs arcaniques",
    texture: "spark",
    rate: 90,
    shape: "cylinder",
    radius: 0.85,
    innerRadius: 0.6,
    height: 3.5,
    speed: [4, 8],
    life: [0.06, 0.15],
    size: [0.2, 0.45],
    colors: stops([0, "#ffffff", 1], [0.5, "#d8b0ff", 0.9], [1, "#8040ff", 0]),
    optional: true,
  }),
};

// Effets du code (pour ceux qui n'ont pas de réglages, et pour la comparaison avec leur conversion).
export const CODE_RECIPES: Record<string, Recipe> = {
  fireCharge: P.fireCharge,
  frostCharge: P.frostCharge,
  fireTrail: P.fireTrail,
  frostTrail: P.frostTrail,
  arcaneTrail: P.arcaneTrail,
  silenceTrail: P.silenceTrail,
  smokeTrail: P.smokeTrail,
  fireBurst: P.fireBurst,
  frostBurst: P.frostBurst,
  arcaneBurst: P.arcaneBurst,
  silencePuff: P.silencePuff,
  critSparks: P.critSparks,
  healFlash: P.healFlash,
  healColumn: P.healColumn,
  buffSpiral: P.buffSpiral,
  resurrectRain: P.resurrectRain,
  noteBurst: P.noteBurst,
  notesAura: P.notesAura,
  mezHalo: P.mezHalo,
  frostMist: P.frostMist,
  frostCoat: P.frostCoat,
  bubbleShards: P.bubbleShards,
  burning: P.burning,
  burningSmoke: P.burningSmoke,
  rageFlames: P.rageFlames,
  rampartFlames: P.rampartFlames,
  rallyHalo: P.rallyHalo,
  arcaneColumn: P.arcaneColumn,
  arcaneSparks: P.arcaneSparks,
  chargeStreak: P.chargeStreak,
  speedDust: P.speedDust,
};

const CODE_LABELS: Record<string, string> = {
  fireTrail: "Traînée de feu",
  frostTrail: "Traînée de givre",
  arcaneTrail: "Traînée arcanique",
  silenceTrail: "Traînée de silence",
  smokeTrail: "Fumée",
  fireBurst: "Explosion de feu",
  frostBurst: "Éclat de givre",
  arcaneBurst: "Éclat arcanique",
  silencePuff: "Bouffée de silence",
};

// Effets réglés et enregistrés (particleEffects.json), donnés par le jeu ou par la page de réglage.
let savedDefs: Record<string, ParticleEffectDef> = {};

export function setParticleEffectDefs(defs: Record<string, ParticleEffectDef>) {
  savedDefs = defs;
}

// Effet par son nom : sa version réglée si elle existe, sinon celle du code.
export function particleRecipe(id: string): Recipe | null {
  const saved = savedDefs[id];
  if (saved) return (fx, at) => createFromDef(fx, at, saved, id);
  return CODE_RECIPES[id] ?? null;
}

// Recette qui cherche l'effet au moment de le jouer (une modification enregistrée s'applique sans recharger le code).
export function recipeById(id: string): Recipe {
  return (fx, at, radius) => particleRecipe(id)?.(fx, at, radius) ?? null;
}

// Effets proposés pour les compétences : ceux du code et ceux créés sur la page de réglage.
export function particleEffectChoices(): { id: string; label: string }[] {
  const ids = new Set([...Object.keys(CODE_RECIPES), ...Object.keys(savedDefs)]);
  return [...ids].map((id) => ({ id, label: particleEffectLabel(id) }));
}

export function particleEffectLabel(id: string): string {
  return savedDefs[id]?.label ?? BUILTIN_DEFS[id]?.label ?? CODE_LABELS[id] ?? id;
}

const scratch = new Vector3();

// Crée et démarre un système de particules d'après ses réglages, au point at (partagé : le déplacer déplace l'effet).
export function createFromDef(fx: ParticleFactory, at: Vector3, saved: ParticleEffectDef, name = "effect"): ParticleSystem | null {
  // Les réglages enregistrés avant l'ajout d'un réglage le prennent à sa valeur par défaut.
  const d: ParticleEffectDef = { ...DEFAULT_DEF, ...saved };
  const bend = d.shape === "fingers" ? fingerBend(d.radius, d.height) : 0;
  const burst = d.emission === "burst";
  const capacity = Math.max(10, Math.ceil(burst ? d.count * 1.2 : d.rate * d.life[1] * 1.3 + 10));
  const s = fx.create(name, capacity, at, d.texture, d.optional);
  if (!s) return null;
  if (d.blend === "normal") s.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  const start = performance.now();
  s.startPositionFunction = (_worldMatrix, position: Vector3) => {
    if (d.core > 0 && Math.random() < d.core) {
      position.copyFrom(at);
      return;
    }
    if (d.shape === "fingers") {
      fingerPoint(d, bend, (performance.now() - start) / 1000, position);
      position.addInPlace(at);
      return;
    }
    if (d.shape === "sphere") {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      const r = d.innerRadius + (d.radius - d.innerRadius) * Math.cbrt(Math.random());
      position.set(at.x + r * Math.sin(v) * Math.cos(u), at.y + d.y + r * Math.cos(v), at.z + r * Math.sin(v) * Math.sin(u));
      return;
    }
    const angle =
      d.arms > 0
        ? ((performance.now() - start) / 1000) * d.spin + Math.floor(Math.random() * d.arms) * ((Math.PI * 2) / d.arms)
        : Math.random() * Math.PI * 2;
    const r = d.arms > 0 ? d.radius : d.innerRadius + (d.radius - d.innerRadius) * Math.sqrt(Math.random());
    position.set(at.x + Math.cos(angle) * r, at.y + d.y + Math.random() * d.height, at.z + Math.sin(angle) * r);
  };
  s.startDirectionFunction = (_worldMatrix, direction: Vector3, particle) => {
    switch (d.direction) {
      case "up":
        direction.set(0, 1, 0);
        break;
      case "down":
        direction.set(0, -1, 0);
        break;
      case "outward":
      case "inward": {
        // Depuis (ou vers) le centre de la forme ; une particule née au centre part au hasard.
        particle.position.subtractToRef(at, scratch);
        if (d.shape !== "sphere") scratch.y = 0;
        if (scratch.lengthSquared() < 1e-6) scratch.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        scratch.normalize();
        if (d.direction === "inward") scratch.scaleInPlace(-1);
        direction.copyFrom(scratch);
        break;
      }
      default:
        direction.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    }
    if (d.spread > 0) {
      direction.x += (Math.random() * 2 - 1) * d.spread;
      direction.y += (Math.random() * 2 - 1) * d.spread;
      direction.z += (Math.random() * 2 - 1) * d.spread;
    }
  };
  if (burst) s.manualEmitCount = d.count;
  else s.emitRate = d.rate;
  s.minLifeTime = d.life[0];
  s.maxLifeTime = d.life[1];
  s.minEmitPower = d.speed[0];
  s.maxEmitPower = d.speed[1];
  s.gravity = new Vector3(0, d.gravity, 0);
  if (d.growth !== 1) {
    s.addSizeGradient(0, d.size[0], d.size[1]);
    s.addSizeGradient(1, d.size[0] * d.growth, d.size[1] * d.growth);
  } else {
    s.minSize = d.size[0];
    s.maxSize = d.size[1];
  }
  if (d.rotation[0] || d.rotation[1]) {
    s.minInitialRotation = 0;
    s.maxInitialRotation = Math.PI * 2;
    s.minAngularSpeed = d.rotation[0];
    s.maxAngularSpeed = d.rotation[1];
  }
  for (const stop of [...d.colors].sort((a, b) => a.at - b.at)) {
    const color = Color4.FromHexString(`${stop.color}ff`);
    color.a = stop.alpha;
    s.addColorGradient(stop.at, color);
  }
  s.start();
  // Une gerbe émet tout d'un coup ; un effet à durée limitée s'arrête seul.
  if (burst) s.targetStopDuration = 0.05;
  else if (d.duration > 0) s.targetStopDuration = d.duration;
  return s;
}

// Courbure totale (radians) qui amène le bout d'un doigt de longueur length, parti à distance radius du centre, au
// centre : un doigt est un arc de cercle qui se courbe vers l'intérieur. Au-delà de ce qu'un arc permet (doigts
// trop courts pour le rayon), il se courbe au maximum sans atteindre le centre.
function fingerBend(radius: number, length: number): number {
  const target = radius / Math.max(length, 1e-3);
  const reach = (bend: number) => (1 - Math.cos(bend)) / bend;
  const max = 2.33;
  if (target >= reach(max)) return max;
  let low = 1e-4;
  let high = max;
  for (let i = 0; i < 30; i++) {
    const middle = (low + high) / 2;
    if (reach(middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// Point au hasard sur l'un des doigts, time secondes après l'apparition de l'effet (relatif au point d'accroche).
function fingerPoint(d: ParticleEffectDef, bend: number, time: number, out: Vector3) {
  const fingers = Math.max(1, d.arms || 5);
  const linear = Math.min(1, time / Math.max(0.01, d.closeTime));
  // Fermeture qui accélère puis ralentit, jusqu'à closeAmount.
  const progress = linear * linear * (3 - 2 * linear) * d.closeAmount;
  const angle = Math.floor(Math.random() * fingers) * ((Math.PI * 2) / fingers) + d.spin * time;
  const length = d.height;
  const along = length * Math.random();
  const curvature = (progress * bend) / Math.max(length, 1e-3);
  const distance = curvature < 1e-5 ? d.radius : d.radius - (1 - Math.cos(curvature * along)) / curvature;
  const height = curvature < 1e-5 ? along : Math.sin(curvature * along) / curvature;
  // Épaisseur du doigt : un petit écart au hasard autour de sa ligne.
  const u = Math.random() * Math.PI * 2;
  const v = Math.acos(2 * Math.random() - 1);
  const r = d.fingerWidth * Math.cbrt(Math.random());
  out.set(
    Math.cos(angle) * distance + r * Math.sin(v) * Math.cos(u),
    d.y + height + r * Math.cos(v),
    Math.sin(angle) * distance + r * Math.sin(v) * Math.sin(u),
  );
}
