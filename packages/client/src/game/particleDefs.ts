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
  // « wave » : une vague qui part du centre (à la hauteur y) et s'étend à l'horizontale jusqu'au rayon radius,
  // atteint à la fin de la vie des particules (vitesse = rayon / durée de vie ; speed n'est pas utilisé).
  shape: "sphere" | "cylinder" | "fingers" | "wave";
  // Traînée : les particules naissent tout le long du chemin parcouru depuis l'image précédente (dans la forme
  // choisie autour), sinon un projectile rapide laisserait un chapelet de boules.
  trail: boolean;
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
  trail: false,
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

// Effets du code convertis en réglages (même rendu, à de petites approximations près) : traînées, impacts, zones,
// et effets portés par les personnages.
export const BUILTIN_DEFS: Record<string, ParticleEffectDef> = {
  // ——— Traînées des projectiles ———
  fireTrail: def({
    label: "Traînée de feu",
    trail: true,
    rate: 1400,
    radius: 0.15,
    direction: "outward",
    speed: [0.2, 0.8],
    life: [0.12, 0.3],
    size: [0.3, 0.65],
    colors: stops([0, "#ffe080", 0.45], [0.3, "#ff8a20", 0.4], [0.7, "#c02808", 0.3], [1, "#400000", 0]),
  }),
  smokeTrail: def({
    label: "Fumée",
    blend: "normal",
    trail: true,
    rate: 60,
    radius: 0.1,
    direction: "outward",
    speed: [0.1, 0.4],
    gravity: 1.2,
    life: [0.5, 0.9],
    size: [0.35, 0.7],
    colors: stops([0, "#9a8c80", 0.12], [1, "#6a6a6a", 0]),
    optional: true,
  }),
  frostTrail: def({
    label: "Traînée de givre",
    trail: true,
    rate: 1000,
    radius: 0.12,
    direction: "outward",
    speed: [0.1, 0.5],
    gravity: -1.5,
    life: [0.2, 0.4],
    size: [0.12, 0.4],
    colors: stops([0, "#70c0ff", 0.35], [0.4, "#3080f0", 0.3], [1, "#1030a0", 0]),
  }),
  arcaneTrail: def({
    label: "Traînée arcanique",
    trail: true,
    rate: 1000,
    radius: 0.22,
    direction: "outward",
    speed: [0.3, 0.9],
    life: [0.2, 0.4],
    size: [0.15, 0.45],
    colors: stops([0, "#e0a0ff", 0.35], [0.4, "#a050ff", 0.3], [1, "#4010a0", 0]),
  }),
  silenceTrail: def({
    label: "Traînée de silence",
    trail: true,
    rate: 800,
    radius: 0.06,
    direction: "outward",
    speed: [0, 0.2],
    life: [0.12, 0.25],
    size: [0.1, 0.2],
    colors: stops([0, "#ffffff", 0.5], [1, "#8090a0", 0]),
  }),
  // ——— Impacts ———
  fireBurst: def({
    label: "Explosion de feu",
    emission: "burst",
    count: 90,
    radius: 0.3,
    direction: "outward",
    speed: [2, 5],
    life: [0.2, 0.5],
    size: [0.3, 0.7],
    colors: stops([0, "#ffe7a0", 0.7], [0.25, "#ff8a20", 0.6], [0.7, "#b02000", 0.35], [1, "#300000", 0]),
  }),
  frostBurst: def({
    label: "Éclat de givre",
    texture: "spark",
    emission: "burst",
    count: 70,
    radius: 0.3,
    direction: "outward",
    speed: [2, 4.5],
    gravity: -7,
    life: [0.4, 0.8],
    size: [0.15, 0.4],
    rotation: [-4, 4],
    colors: stops([0, "#ffffff", 1], [0.5, "#a0e8ff", 1], [1, "#3080d0", 0]),
  }),
  arcaneBurst: def({
    label: "Éclat arcanique",
    emission: "burst",
    count: 70,
    radius: 0.4,
    direction: "outward",
    speed: [0.6, 1.8],
    gravity: 1.5,
    life: [0.5, 0.9],
    size: [0.15, 0.4],
    colors: stops([0, "#d890ff", 0.55], [0.4, "#9040f0", 0.45], [1, "#4010a0", 0]),
  }),
  silencePuff: def({
    label: "Bouffée de silence",
    blend: "normal",
    emission: "burst",
    count: 40,
    radius: 0.3,
    direction: "outward",
    speed: [0.5, 1.2],
    life: [0.4, 0.7],
    size: [0.25, 0.5],
    colors: stops([0, "#e8eef4", 0.7], [1, "#606870", 0]),
  }),
  // ——— Zones (rayon de référence 6 m ; « à la taille de la zone » les étend) ———
  fireWave: def({
    label: "Vague de feu (pour une zone)",
    emission: "burst",
    count: 240,
    shape: "wave",
    radius: 6,
    y: 0.15,
    life: [0.45, 0.45],
    size: [0.4, 0.8],
    colors: stops([0, "#fff0a0", 1], [0.4, "#ff8020", 1], [1, "#801000", 0]),
  }),
  fireField: def({
    label: "Braises (pour une zone)",
    emission: "burst",
    count: 108,
    shape: "cylinder",
    radius: 6,
    y: 0.1,
    direction: "up",
    spread: 0.1,
    speed: [1.8, 3],
    life: [0.3, 0.7],
    size: [0.3, 0.7],
    colors: stops([0, "#ffe080", 1], [0.4, "#ff7010", 1], [1, "#500000", 0]),
  }),
  frostWave: def({
    label: "Vague de givre (pour une zone)",
    texture: "spark",
    emission: "burst",
    count: 240,
    shape: "wave",
    radius: 6,
    y: 0.15,
    life: [0.45, 0.45],
    size: [0.4, 0.8],
    colors: stops([0, "#b0e0ff", 0.8], [0.5, "#50a8ff", 0.6], [1, "#1040b0", 0]),
  }),
  frostField: def({
    label: "Cristaux de givre (pour une zone)",
    emission: "burst",
    count: 72,
    shape: "cylinder",
    radius: 6,
    y: 0.1,
    direction: "up",
    spread: 0.1,
    speed: [1.2, 2],
    life: [0.4, 0.8],
    size: [0.15, 0.35],
    colors: stops([0, "#90d0ff", 0.6], [0.5, "#4090f0", 0.5], [1, "#1040b0", 0]),
  }),
  arcaneMist: def({
    label: "Brume arcanique (pour une zone)",
    emission: "burst",
    count: 90,
    shape: "cylinder",
    radius: 6,
    y: 0.1,
    direction: "up",
    spread: 0.1,
    speed: [0.42, 0.7],
    life: [0.8, 1.4],
    size: [0.6, 1.2],
    colors: stops([0, "#9a6cff", 0.55], [0.5, "#5a30d0", 0.4], [1, "#201060", 0]),
  }),
  healField: def({
    label: "Lueurs de soin (pour une zone)",
    emission: "burst",
    count: 180,
    shape: "cylinder",
    radius: 6,
    y: 0.1,
    direction: "up",
    spread: 0.1,
    speed: [1.5, 2.5],
    life: [0.7, 1.2],
    size: [0.25, 0.5],
    colors: stops([0, "#a0ffb0", 0.6], [0.3, "#50e070", 0.5], [1, "#108030", 0]),
  }),
  rallyWave: def({
    label: "Onde de ralliement (pour une zone)",
    emission: "burst",
    count: 240,
    shape: "wave",
    radius: 6,
    y: 0.15,
    life: [0.45, 0.45],
    size: [0.4, 0.8],
    colors: stops([0, "#fff4c0", 0.9], [0.5, "#ffc840", 0.7], [1, "#a07000", 0]),
  }),
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
  // Effets de zone (ils prennent le rayon de la zone).
  fireWave: P.fireWave,
  fireField: P.fireField,
  frostWave: P.frostWave,
  frostField: P.frostField,
  arcaneMist: P.arcaneMist,
  healField: P.healField,
  rallyWave: P.rallyWave,
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
  fireWave: "Vague de feu (pour une zone)",
  fireField: "Braises (pour une zone)",
  frostWave: "Vague de givre (pour une zone)",
  frostField: "Cristaux de givre (pour une zone)",
  arcaneMist: "Brume arcanique (pour une zone)",
  healField: "Lueurs de soin (pour une zone)",
  rallyWave: "Onde de ralliement (pour une zone)",
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

// Effet étendu à une zone de rayon radius (mètres) : un effet réglé y prend ce rayon (et plus de particules, pour
// la même densité) ; un effet du code de zone reçoit le rayon.
export function zoneRecipe(id: string, radius: number): ((fx: ParticleFactory, at: Vector3) => ParticleSystem | null) | null {
  // Réglé et enregistré : sa version ; sinon un effet de zone du code reçoit le rayon ; sinon la version convertie
  // d'un effet du code (qui, lui, ne connaît pas de rayon).
  if (savedDefs[id]) return (fx, at) => createFromDef(fx, at, savedDefs[id], id, radius);
  const code = CODE_RECIPES[id];
  if (code && ZONE_CODE.has(id)) return (fx, at) => code(fx, at, radius);
  if (BUILTIN_DEFS[id]) return (fx, at) => createFromDef(fx, at, BUILTIN_DEFS[id], id, radius);
  return code ? (fx, at) => code(fx, at, radius) : null;
}

// Effets de zone du code, qui reçoivent le rayon de la zone.
const ZONE_CODE = new Set(["fireWave", "fireField", "frostWave", "frostField", "arcaneMist", "healField", "rallyWave"]);

// Plafond du nombre de particules multiplié pour remplir une zone.
const MAX_ZONE_DENSITY = 40;

// Recette qui cherche l'effet au moment de le jouer (une modification enregistrée s'applique sans recharger le code).
export function recipeById(id: string): Recipe {
  return (fx, at, radius) => particleRecipe(id)?.(fx, at, radius) ?? null;
}

// Durée d'émission d'un effet lancé une seule fois (impact, soin, buff) quand ses réglages le font émettre sans fin
// (émission continue sans arrêt) : sinon il ne s'éteindrait jamais.
export const ONE_SHOT_DURATION = 1;

// Effet lancé une seule fois, sans être arrêté ensuite : on lui impose une fin s'il n'en a pas.
export function oneShot(system: ParticleSystem | null): ParticleSystem | null {
  if (system && !system.targetStopDuration && system.manualEmitCount < 0) system.targetStopDuration = ONE_SHOT_DURATION;
  return system;
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
// zoneRadius : rayon imposé (effet étendu à une zone), le nombre de particules suit la surface.
export function createFromDef(
  fx: ParticleFactory,
  at: Vector3,
  saved: ParticleEffectDef,
  name = "effect",
  zoneRadius?: number,
): ParticleSystem | null {
  // Les réglages enregistrés avant l'ajout d'un réglage le prennent à sa valeur par défaut.
  const d: ParticleEffectDef = { ...DEFAULT_DEF, ...saved };
  if (zoneRadius !== undefined && zoneRadius > 0) {
    const scale = zoneRadius / Math.max(d.radius, 0.05);
    // Une vague garde la même densité sur son pourtour (proportionnel au rayon), une zone remplie sur sa surface.
    const density = Math.min(MAX_ZONE_DENSITY, Math.max(1, d.shape === "wave" ? scale : scale * scale));
    d.radius = zoneRadius;
    d.innerRadius *= scale;
    d.rate = Math.round(d.rate * density);
    d.count = Math.round(d.count * density);
  }
  const bend = d.shape === "fingers" ? fingerBend(d.radius, d.height) : 0;
  const burst = d.emission === "burst";
  const capacity = Math.max(10, Math.ceil(burst ? d.count * 1.2 : d.rate * d.life[1] * 1.3 + 10));
  const s = fx.create(name, capacity, at, d.texture, d.optional);
  if (!s) return null;
  if (d.blend === "normal") s.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  const start = performance.now();
  // Traînée : chemin parcouru par le point d'accroche depuis l'image précédente.
  const previous = at.clone();
  const origin = new Vector3();
  if (d.trail) s.onBeforeDrawParticlesObservable.add(() => previous.copyFrom(at));
  s.startPositionFunction = (_worldMatrix, position: Vector3) => {
    const base = d.trail ? Vector3.LerpToRef(previous, at, Math.random(), origin) : at;
    if (d.shape === "wave") {
      position.set(at.x, at.y + d.y, at.z);
      return;
    }
    if (d.core > 0 && Math.random() < d.core) {
      position.copyFrom(base);
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
      position.set(base.x + r * Math.sin(v) * Math.cos(u), base.y + d.y + r * Math.cos(v), base.z + r * Math.sin(v) * Math.sin(u));
      return;
    }
    const angle =
      d.arms > 0
        ? ((performance.now() - start) / 1000) * d.spin + Math.floor(Math.random() * d.arms) * ((Math.PI * 2) / d.arms)
        : Math.random() * Math.PI * 2;
    const r = d.arms > 0 ? d.radius : d.innerRadius + (d.radius - d.innerRadius) * Math.sqrt(Math.random());
    position.set(base.x + Math.cos(angle) * r, base.y + d.y + Math.random() * d.height, base.z + Math.sin(angle) * r);
  };
  s.startDirectionFunction = (_worldMatrix, direction: Vector3, particle) => {
    if (d.shape === "wave") {
      const angle = Math.random() * Math.PI * 2;
      direction.set(Math.cos(angle), 0, Math.sin(angle));
      return;
    }
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
  // Une vague atteint le bord de son rayon à la fin de sa vie.
  s.minEmitPower = d.shape === "wave" ? d.radius / Math.max(d.life[1], 0.01) : d.speed[0];
  s.maxEmitPower = d.shape === "wave" ? d.radius / Math.max(d.life[1], 0.01) : d.speed[1];
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
