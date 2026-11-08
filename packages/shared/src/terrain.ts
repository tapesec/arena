import { OBSTACLES, PLAZA, type Obstacle } from "./arena";
import { ARENA_SIZE } from "./constants";
import { START_ZONES } from "./match";
import type { Position } from "./movement";

// Relief de l'arène : de larges plateaux aux pentes douces et des bosses très étalées, sur un sol plat.
// Partagé entre le serveur (ligne de vue) et le client (affichage). Les pentes ne ralentissent pas :
// le relief ne compte que pour la vue.

// Plateau : un dessus plat (rectangle aux coins arrondis), bordé d'une rampe en pente douce.
interface Plateau {
  x: number;
  z: number;
  // Demi-dimensions du dessus plat.
  halfWidth: number;
  halfDepth: number;
  height: number;
  // Largeur de la rampe qui descend jusqu'au sol.
  ramp: number;
}

// Bosse en cloche, très étalée : un léger vallonnement.
interface Rise {
  x: number;
  z: number;
  height: number;
  radius: number;
}

// Comme les obstacles, le relief est symétrique par rotation de 180° autour du centre.
const mirrored = <T extends { x: number; z: number }>(shape: T): T[] => [shape, { ...shape, x: -shape.x, z: -shape.z }];

const PLATEAUS: Plateau[] = [
  // Grands plateaux sur les flancs : 3 m, de quoi cacher un groupe en contrebas et dominer depuis le dessus.
  ...mirrored({ x: 38, z: -34, halfWidth: 7, halfDepth: 8, height: 3, ramp: 7 }),
  // Longue crête basse entre une zone de départ et un flanc : 2 m, juste assez pour masquer un personnage.
  ...mirrored({ x: 0, z: -42, halfWidth: 11, halfDepth: 3, height: 2, ramp: 6 }),
];

const RISES: Rise[] = [
  // Vallonnement large sur les approches du centre : ne cache personne.
  ...mirrored({ x: -22, z: -20, height: 1.5, radius: 16 }),
];

// Zones gardées plates : la place du centre (et ses abords), les zones de départ, les zones ouvertes et les abords des obstacles.
// Abords de la place gardés plats (PLAZA, lue au calcul : arena.ts et terrain.ts s'importent mutuellement).
const PLAZA_FLAT_MARGIN = 2;
const START_FLAT_MARGIN = 2;
const OBSTACLE_FLAT_MARGIN = 1.5;
// Distance sur laquelle le sol remonte doucement au sortir d'une zone plate.
const FLAT_FALLOFF = 4;
// Zones ouvertes (voir arena.ts) : on y fait aussi les tests, elles doivent rester plates.
export const OPEN_AREAS = [
  { minX: 26, maxX: 48, minZ: -10, maxZ: 30 },
  { minX: -48, maxX: -26, minZ: -30, maxZ: 10 },
];

// Hauteur des yeux d'un personnage, pour la ligne de vue par-dessus le relief.
export const EYE_HEIGHT = 1.6;
// Pas d'échantillonnage du relief le long d'une ligne de vue.
const SIGHT_STEP = 1;

// Le relief est précalculé sur une grille d'un mètre, puis interpolé : rapide à interroger.
const GRID_SIZE = ARENA_SIZE + 1;
let grid: Float32Array | null = null;

// Hauteur du sol en (x, z).
export function terrainHeight(x: number, z: number): number {
  grid ??= buildGrid();
  const half = ARENA_SIZE / 2;
  const gx = Math.min(GRID_SIZE - 1.001, Math.max(0, x + half));
  const gz = Math.min(GRID_SIZE - 1.001, Math.max(0, z + half));
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const h00 = grid[iz * GRID_SIZE + ix];
  const h10 = grid[iz * GRID_SIZE + ix + 1];
  const h01 = grid[(iz + 1) * GRID_SIZE + ix];
  const h11 = grid[(iz + 1) * GRID_SIZE + ix + 1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

// Vrai si le relief cache b à un personnage placé en a (les deux à hauteur des yeux).
export function terrainBlocksSight(a: Position, b: Position): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.floor(length / SIGHT_STEP);
  if (steps < 2) return false;
  const fromHeight = terrainHeight(a.x, a.z) + EYE_HEIGHT;
  const toHeight = terrainHeight(b.x, b.z) + EYE_HEIGHT;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const ground = terrainHeight(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (ground > fromHeight + (toHeight - fromHeight) * t) return true;
  }
  return false;
}

function buildGrid(): Float32Array {
  const values = new Float32Array(GRID_SIZE * GRID_SIZE);
  const half = ARENA_SIZE / 2;
  for (let iz = 0; iz < GRID_SIZE; iz++) {
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      values[iz * GRID_SIZE + ix] = rawHeight(ix - half, iz - half);
    }
  }
  return values;
}

function rawHeight(x: number, z: number): number {
  let height = 0;
  for (const p of PLATEAUS) {
    // Distance au dessus plat (0 dessus), puis rampe adoucie aux deux bouts.
    const dx = Math.max(Math.abs(x - p.x) - p.halfWidth, 0);
    const dz = Math.max(Math.abs(z - p.z) - p.halfDepth, 0);
    const t = 1 - Math.min(1, Math.hypot(dx, dz) / p.ramp);
    height = Math.max(height, p.height * smoothstep(t));
  }
  for (const r of RISES) {
    // Cloche (gaussienne) : environ 14 % de la hauteur au bord du rayon.
    const sigma = r.radius / 2;
    const d2 = (x - r.x) ** 2 + (z - r.z) ** 2;
    height += r.height * Math.exp(-d2 / (2 * sigma * sigma));
  }
  return height * flatness(x, z);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// 0 dans une zone gardée plate, 1 loin de toutes ; transition douce entre les deux.
function flatness(x: number, z: number): number {
  let distance = Math.hypot(x - PLAZA.x, z - PLAZA.z) - PLAZA.radius - PLAZA_FLAT_MARGIN;
  for (const zone of START_ZONES) {
    distance = Math.min(distance, Math.hypot(x - zone.x, z - zone.z) - zone.radius - START_FLAT_MARGIN);
  }
  for (const area of OPEN_AREAS) {
    const dx = Math.max(area.minX - x, 0, x - area.maxX);
    const dz = Math.max(area.minZ - z, 0, z - area.maxZ);
    distance = Math.min(distance, Math.hypot(dx, dz));
  }
  for (const o of OBSTACLES) distance = Math.min(distance, distanceToObstacle(x, z, o) - OBSTACLE_FLAT_MARGIN);
  return smoothstep(Math.min(1, Math.max(0, distance / FLAT_FALLOFF)));
}

function distanceToObstacle(x: number, z: number, o: Obstacle): number {
  const dx = Math.max(Math.abs(x - o.x) - o.halfWidth, 0);
  const dz = Math.max(Math.abs(z - o.z) - o.halfDepth, 0);
  return Math.hypot(dx, dz);
}
