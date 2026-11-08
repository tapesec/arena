import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";

// Recettes d'effets à particules des sorts. Chaque particule est une petite image tournée vers la caméra ;
// en mode "additif", les particules qui se superposent s'éclaircissent jusqu'au blanc : c'est ce qui fait briller.

// Au-delà de ce nombre de systèmes actifs, les nouveaux effets secondaires (fumée…) sont ignorés.
const MAX_ACTIVE = 40;

export type ParticleTexture = "glow" | "spark";

// Une recette : à partir d'un point (déplaçable, pour suivre un projectile ou un personnage), crée et démarre
// un système de particules. Un système "continu" émet tant qu'on ne l'arrête pas ; une "gerbe" émet tout d'un
// coup puis s'arrête seule. Dans les deux cas, il disparaît quand sa dernière particule s'éteint.
export type Recipe = (fx: ParticleFactory, at: Vector3, radius?: number) => ParticleSystem | null;

export class ParticleFactory {
  private textures: Record<ParticleTexture, Texture>;
  private active = new Set<ParticleSystem>();
  // Systèmes arrêtés : détruits quand leur dernière particule s'est éteinte (voir update).
  private stopping = new Set<ParticleSystem>();

  constructor(private scene: Scene) {
    this.textures = { glow: glowTexture(scene), spark: sparkTexture(scene) };
  }

  // Crée un système à l'emplacement "at" (le vecteur est partagé : le déplacer déplace l'émetteur).
  // optional : effet secondaire, sacrifié quand trop de systèmes sont actifs.
  create(name: string, capacity: number, at: Vector3, texture: ParticleTexture, optional = false): ParticleSystem | null {
    if (optional && this.active.size >= MAX_ACTIVE) return null;
    const system = new ParticleSystem(name, capacity, this.scene);
    system.particleTexture = this.textures[texture];
    system.emitter = at;
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    // Horloge en secondes (par défaut, une unité de Babylon vaut 1,67 s à 60 images/s) : durées de vie
    // en secondes et vitesses en mètres par seconde.
    system.updateSpeed = 1 / 60;
    // Pas de "disposeOnStop" : Babylon détruirait aussi la texture, partagée par tous les effets.
    system.onStoppedObservable.add(() => this.stopping.add(system));
    this.active.add(system);
    return system;
  }

  // Détruit (sans leur texture) les systèmes arrêtés dont toutes les particules se sont éteintes.
  update() {
    for (const system of this.stopping) {
      if (system.getActiveCount() > 0) continue;
      this.stopping.delete(system);
      this.active.delete(system);
      system.dispose(false);
    }
  }

  // Joue chaque recette un instant sous le sol : ses programmes graphiques sont préparés avant le premier sort
  // (sinon l'image se figerait une fraction de seconde à ce moment-là).
  prewarm(recipes: Recipe[]) {
    for (const recipe of recipes) {
      const system = recipe(this, new Vector3(0, -50, 0), 1);
      if (system) setTimeout(() => system.stop(), 300);
    }
  }

  dispose() {
    for (const system of this.active) system.dispose(false);
    this.active.clear();
    this.stopping.clear();
    for (const texture of Object.values(this.textures)) texture.dispose();
  }
}

// Point lumineux flou : base de presque tous les effets.
function glowTexture(scene: Scene): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture("fx-glow", size, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

// Étincelle : un trait lumineux en losange, pour les éclats et les impacts.
function sparkTexture(scene: Scene): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture("fx-spark", size, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size * 0.6, size / 2);
  ctx.lineTo(size / 2, size);
  ctx.lineTo(size * 0.4, size / 2);
  ctx.closePath();
  ctx.fill();
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

const rgba = (hex: string, alpha = 1) => {
  const c = Color4.FromHexString(`${hex}ff`);
  c.a = alpha;
  return c;
};

// Dégradé de couleur d'une particule au fil de sa vie (0 = naissance, 1 = mort).
function gradient(system: ParticleSystem, ...stops: [number, Color4][]) {
  for (const [at, color] of stops) system.addColorGradient(at, color);
}

// Émetteur d'une traînée : les particules naissent n'importe où sur le trajet parcouru depuis l'image précédente
// (dans une petite sphère autour), sinon un projectile rapide laisserait un chapelet de boules.
function trailEmitter(system: ParticleSystem, radius: number) {
  const emitter = system.emitter as Vector3;
  const previous = emitter.clone();
  system.startPositionFunction = (_worldMatrix, position: Vector3) => {
    const t = Math.random();
    const u = Math.random() * Math.PI * 2;
    const v = Math.acos(2 * Math.random() - 1);
    const r = radius * Math.cbrt(Math.random());
    position.set(
      previous.x + (emitter.x - previous.x) * t + r * Math.sin(v) * Math.cos(u),
      previous.y + (emitter.y - previous.y) * t + r * Math.cos(v),
      previous.z + (emitter.z - previous.z) * t + r * Math.sin(v) * Math.sin(u),
    );
  };
  system.onBeforeDrawParticlesObservable.add(() => previous.copyFrom(emitter));
  sphereBurst(system, radius);
}

// Particules qui partent dans toutes les directions depuis une petite sphère.
function sphereBurst(system: ParticleSystem, radius: number) {
  system.createSphereEmitter(radius, 1);
}

// ——— Feu ———

// Cœur et traînée d'une boule de feu : jaune-blanc au centre, qui vire à l'orange puis au rouge sombre.
// Un projectile file à plus de 30 m/s : il faut un gros débit pour que la traînée soit continue.
export const fireTrail: Recipe = (fx, at) => {
  const s = fx.create("fireTrail", 700, at, "glow");
  if (!s) return null;
  trailEmitter(s, 0.15);
  s.emitRate = 1400;
  s.minLifeTime = 0.12;
  s.maxLifeTime = 0.3;
  s.minSize = 0.3;
  s.maxSize = 0.65;
  s.minEmitPower = 0.2;
  s.maxEmitPower = 0.8;
  // Particules à demi-transparentes : très nombreuses, elles saturent sinon jusqu'au blanc.
  gradient(s, [0, rgba("#ffe080", 0.45)], [0.3, rgba("#ff8a20", 0.4)], [0.7, rgba("#c02808", 0.3)], [1, rgba("#400000", 0)]);
  s.start();
  return s;
};

// Fumée qui reste derrière la boule de feu et monte doucement.
export const smokeTrail: Recipe = (fx, at) => {
  const s = fx.create("smokeTrail", 200, at, "glow", true);
  if (!s) return null;
  s.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  trailEmitter(s, 0.1);
  s.emitRate = 60;
  s.minLifeTime = 0.5;
  s.maxLifeTime = 0.9;
  s.minSize = 0.35;
  s.maxSize = 0.7;
  s.minEmitPower = 0.1;
  s.maxEmitPower = 0.4;
  s.gravity = new Vector3(0, 1.2, 0);
  gradient(s, [0, rgba("#9a8c80", 0.12)], [1, rgba("#6a6a6a", 0)]);
  s.start();
  return s;
};

// Explosion de feu à l'impact : une gerbe de flammes et quelques étincelles.
export const fireBurst: Recipe = (fx, at) => {
  const s = fx.create("fireBurst", 120, at, "glow");
  if (!s) return null;
  sphereBurst(s, 0.3);
  s.manualEmitCount = 90;
  s.minLifeTime = 0.2;
  s.maxLifeTime = 0.5;
  s.minSize = 0.3;
  s.maxSize = 0.7;
  s.minEmitPower = 2;
  s.maxEmitPower = 5;
  gradient(s, [0, rgba("#ffe7a0", 0.7)], [0.25, rgba("#ff8a20", 0.6)], [0.7, rgba("#b02000", 0.35)], [1, rgba("#300000", 0)]);
  s.start();
  s.targetStopDuration = 0.05;
  return s;
};

// ——— Givre ———

export const frostTrail: Recipe = (fx, at) => {
  const s = fx.create("frostTrail", 600, at, "glow");
  if (!s) return null;
  trailEmitter(s, 0.12);
  s.emitRate = 1000;
  s.minLifeTime = 0.2;
  s.maxLifeTime = 0.4;
  s.minSize = 0.12;
  s.maxSize = 0.4;
  s.minEmitPower = 0.1;
  s.maxEmitPower = 0.5;
  s.gravity = new Vector3(0, -1.5, 0);
  gradient(s, [0, rgba("#70c0ff", 0.35)], [0.4, rgba("#3080f0", 0.3)], [1, rgba("#1030a0", 0)]);
  s.start();
  return s;
};

// Gerbe de cristaux de glace qui retombent.
export const frostBurst: Recipe = (fx, at) => {
  const s = fx.create("frostBurst", 100, at, "spark");
  if (!s) return null;
  sphereBurst(s, 0.3);
  s.manualEmitCount = 70;
  s.minLifeTime = 0.4;
  s.maxLifeTime = 0.8;
  s.minSize = 0.15;
  s.maxSize = 0.4;
  s.minEmitPower = 2;
  s.maxEmitPower = 4.5;
  s.minAngularSpeed = -4;
  s.maxAngularSpeed = 4;
  s.gravity = new Vector3(0, -7, 0);
  gradient(s, [0, rgba("#ffffff")], [0.5, rgba("#a0e8ff")], [1, rgba("#3080d0", 0)]);
  s.start();
  s.targetStopDuration = 0.05;
  return s;
};

// ——— Arcane (mez) ———

export const arcaneTrail: Recipe = (fx, at) => {
  const s = fx.create("arcaneTrail", 600, at, "glow");
  if (!s) return null;
  trailEmitter(s, 0.22);
  s.emitRate = 1000;
  s.minLifeTime = 0.2;
  s.maxLifeTime = 0.4;
  s.minSize = 0.15;
  s.maxSize = 0.45;
  s.minEmitPower = 0.3;
  s.maxEmitPower = 0.9;
  gradient(s, [0, rgba("#e0a0ff", 0.35)], [0.4, rgba("#a050ff", 0.3)], [1, rgba("#4010a0", 0)]);
  s.start();
  return s;
};

export const arcaneBurst: Recipe = (fx, at) => {
  const s = fx.create("arcaneBurst", 90, at, "glow");
  if (!s) return null;
  sphereBurst(s, 0.4);
  s.manualEmitCount = 70;
  s.minLifeTime = 0.5;
  s.maxLifeTime = 0.9;
  s.minSize = 0.15;
  s.maxSize = 0.4;
  s.minEmitPower = 0.6;
  s.maxEmitPower = 1.8;
  s.gravity = new Vector3(0, 1.5, 0);
  gradient(s, [0, rgba("#d890ff", 0.55)], [0.4, rgba("#9040f0", 0.45)], [1, rgba("#4010a0", 0)]);
  s.start();
  s.targetStopDuration = 0.05;
  return s;
};

// ——— Silence ———

export const silenceTrail: Recipe = (fx, at) => {
  const s = fx.create("silenceTrail", 300, at, "glow");
  if (!s) return null;
  trailEmitter(s, 0.06);
  s.emitRate = 800;
  s.minLifeTime = 0.12;
  s.maxLifeTime = 0.25;
  s.minSize = 0.1;
  s.maxSize = 0.2;
  s.minEmitPower = 0;
  s.maxEmitPower = 0.2;
  gradient(s, [0, rgba("#ffffff", 0.5)], [1, rgba("#8090a0", 0)]);
  s.start();
  return s;
};

// Bouffée grise qui s'éteint : la voix de la cible est coupée.
export const silencePuff: Recipe = (fx, at) => {
  const s = fx.create("silencePuff", 60, at, "glow");
  if (!s) return null;
  s.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  sphereBurst(s, 0.3);
  s.manualEmitCount = 40;
  s.minLifeTime = 0.4;
  s.maxLifeTime = 0.7;
  s.minSize = 0.25;
  s.maxSize = 0.5;
  s.minEmitPower = 0.5;
  s.maxEmitPower = 1.2;
  gradient(s, [0, rgba("#e8eef4", 0.7)], [1, rgba("#606870", 0)]);
  s.start();
  s.targetStopDuration = 0.05;
  return s;
};

// ——— Zones ———

// Onde qui part du centre et s'étend jusqu'au bord de la zone, au ras du sol.
function wave(fx: ParticleFactory, name: string, at: Vector3, radius: number, colors: [number, Color4][], texture: ParticleTexture) {
  const s = fx.create(name, 400, at, texture);
  if (!s) return null;
  const life = 0.45;
  s.manualEmitCount = Math.round(60 + radius * 30);
  s.minLifeTime = s.maxLifeTime = life;
  s.minSize = 0.4;
  s.maxSize = 0.8;
  // Chaque particule part dans une direction horizontale et atteint le bord de la zone à la fin de sa vie.
  s.minEmitPower = s.maxEmitPower = radius / life;
  s.startPositionFunction = (worldMatrix, position: Vector3) => {
    Vector3.TransformCoordinatesFromFloatsToRef(0, 0.15, 0, worldMatrix, position);
  };
  s.startDirectionFunction = (_worldMatrix, direction: Vector3) => {
    const angle = Math.random() * Math.PI * 2;
    direction.set(Math.cos(angle), 0, Math.sin(angle));
  };
  gradient(s, ...colors);
  s.start();
  s.targetStopDuration = 0.05;
  return s;
}

// Particules qui naissent partout dans la zone et montent (brume, étincelles).
function rising(
  fx: ParticleFactory,
  name: string,
  at: Vector3,
  radius: number,
  count: number,
  life: [number, number],
  size: [number, number],
  speed: number,
  colors: [number, Color4][],
) {
  const s = fx.create(name, count + 20, at, "glow");
  if (!s) return null;
  s.manualEmitCount = count;
  [s.minLifeTime, s.maxLifeTime] = life;
  [s.minSize, s.maxSize] = size;
  s.minEmitPower = speed * 0.6;
  s.maxEmitPower = speed;
  s.startPositionFunction = (worldMatrix, position: Vector3) => {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * radius;
    Vector3.TransformCoordinatesFromFloatsToRef(Math.cos(angle) * distance, 0.1, Math.sin(angle) * distance, worldMatrix, position);
  };
  s.startDirectionFunction = (_worldMatrix, direction: Vector3) => {
    direction.set((Math.random() - 0.5) * 0.2, 1, (Math.random() - 0.5) * 0.2);
  };
  gradient(s, ...colors);
  s.start();
  s.targetStopDuration = 0.05;
  return s;
}

// Déflagration : onde de feu depuis le lanceur, et flammes qui montent dans toute la zone.
export const fireWave: Recipe = (fx, at, radius = 6) =>
  wave(fx, "fireWave", at, radius, [[0, rgba("#fff0a0")], [0.4, rgba("#ff8020")], [1, rgba("#801000", 0)]], "glow");
export const fireField: Recipe = (fx, at, radius = 6) =>
  rising(fx, "fireField", at, radius, Math.round(radius * radius * 3), [0.3, 0.7], [0.3, 0.7], 3, [
    [0, rgba("#ffe080")],
    [0.4, rgba("#ff7010")],
    [1, rgba("#500000", 0)],
  ]);

// Root de zone : vague de givre au sol et cristaux qui jaillissent.
export const frostWave: Recipe = (fx, at, radius = 6) =>
  wave(fx, "frostWave", at, radius, [[0, rgba("#b0e0ff", 0.8)], [0.5, rgba("#50a8ff", 0.6)], [1, rgba("#1040b0", 0)]], "spark");
export const frostField: Recipe = (fx, at, radius = 6) =>
  rising(fx, "frostField", at, radius, Math.round(radius * radius * 2), [0.4, 0.8], [0.15, 0.35], 2, [
    [0, rgba("#90d0ff", 0.6)],
    [0.5, rgba("#4090f0", 0.5)],
    [1, rgba("#1040b0", 0)],
  ]);

// Mez de zone : brume violette qui flotte un instant sur la zone.
export const arcaneMist: Recipe = (fx, at, radius = 6) =>
  rising(fx, "arcaneMist", at, radius, Math.round(radius * radius * 2.5), [0.8, 1.4], [0.6, 1.2], 0.7, [
    [0, rgba("#9a6cff", 0.55)],
    [0.5, rgba("#5a30d0", 0.4)],
    [1, rgba("#201060", 0)],
  ]);

// Soin de groupe : étincelles vertes qui montent du sol dans toute la zone.
export const healField: Recipe = (fx, at, radius = 6) =>
  rising(fx, "healField", at, radius, Math.min(1200, Math.round(radius * radius * 5)), [0.7, 1.2], [0.25, 0.5], 2.5, [
    [0, rgba("#a0ffb0", 0.6)],
    [0.3, rgba("#50e070", 0.5)],
    [1, rgba("#108030", 0)],
  ]);

// ——— Soins ———

// Colonne d'étincelles vertes qui montent autour du personnage soigné.
export const healColumn: Recipe = (fx, at) => {
  const s = fx.create("healColumn", 160, at, "glow");
  if (!s) return null;
  s.manualEmitCount = 110;
  s.minLifeTime = 0.6;
  s.maxLifeTime = 1.1;
  s.minSize = 0.12;
  s.maxSize = 0.3;
  s.minEmitPower = 1.5;
  s.maxEmitPower = 3;
  s.startPositionFunction = (worldMatrix, position: Vector3) => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 0.3 + Math.random() * 0.4;
    Vector3.TransformCoordinatesFromFloatsToRef(Math.cos(angle) * distance, 0.1, Math.sin(angle) * distance, worldMatrix, position);
  };
  s.startDirectionFunction = (_worldMatrix, direction: Vector3) => direction.set(0, 1, 0);
  gradient(s, [0, rgba("#a0ffb0", 0.6)], [0.3, rgba("#50e070", 0.5)], [1, rgba("#108030", 0)]);
  s.start();
  s.targetStopDuration = 0.05;
  return s;
};

// Soin instantané : un éclat vert vif, plus bref et plus serré.
export const healFlash: Recipe = (fx, at) => {
  const s = fx.create("healFlash", 100, at, "spark");
  if (!s) return null;
  sphereBurst(s, 0.5);
  s.manualEmitCount = 70;
  s.minLifeTime = 0.3;
  s.maxLifeTime = 0.6;
  s.minSize = 0.2;
  s.maxSize = 0.45;
  s.minEmitPower = 1.5;
  s.maxEmitPower = 3;
  s.gravity = new Vector3(0, 2, 0);
  gradient(s, [0, rgba("#c0ffc8", 0.7)], [0.3, rgba("#60f080", 0.55)], [1, rgba("#108030", 0)]);
  s.start();
  s.targetStopDuration = 0.05;
  return s;
};

export const RECIPES: Recipe[] = [
  fireTrail,
  smokeTrail,
  fireBurst,
  frostTrail,
  frostBurst,
  arcaneTrail,
  arcaneBurst,
  silenceTrail,
  silencePuff,
  fireWave,
  fireField,
  frostWave,
  frostField,
  arcaneMist,
  healField,
  healColumn,
  healFlash,
];

