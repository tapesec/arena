import { OBSTACLES, type Obstacle } from "./arena";
import { ARENA_SIZE } from "./constants";
import { START_ZONES } from "./match";
import type { Position } from "./movement";

// Relief de l'arène : des collines en forme de cloche, posées sur un sol plat.
// Partagé entre le serveur (ligne de vue) et le client (affichage). Les pentes ne ralentissent pas :
// le relief ne compte que pour la vue.

interface Hill {
  x: number;
  z: number;
  // Hauteur au sommet, en mètres.
  height: number;
  // Rayon approximatif de la base.
  radius: number;
}

// Comme les obstacles, le relief est symétrique par rotation de 180° autour du centre.
const mirrored = (h: Hill): Hill[] => [h, { ...h, x: -h.x, z: -h.z }];

const HILLS: Hill[] = [
  // Grandes buttes sur les flancs : assez hautes pour cacher un groupe qui contourne.
  ...mirrored({ x: 34, z: -30, height: 4, radius: 8 }),
  // Ondulations douces, qui ne cachent pas un personnage.
  ...mirrored({ x: 16, z: 28, height: 1.4, radius: 6 }),
  ...mirrored({ x: 4, z: 24, height: 1.2, radius: 5 }),
  ...mirrored({ x: 12, z: -42, height: 1.5, radius: 6 }),
  ...mirrored({ x: -21, z: -21, height: 1.3, radius: 6 }),
  ...mirrored({ x: -40, z: 32, height: 1.5, radius: 6 }),
];

// Zones gardées plates : le centre, les zones de départ, les zones ouvertes et les abords des obstacles.
const CENTER_FLAT_RADIUS = 13;
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
  for (const hill of HILLS) {
    // Cloche (gaussienne) : environ 14 % de la hauteur au bord du rayon.
    const sigma = hill.radius / 2;
    const d2 = (x - hill.x) ** 2 + (z - hill.z) ** 2;
    height += hill.height * Math.exp(-d2 / (2 * sigma * sigma));
  }
  return height * flatness(x, z);
}

// 0 dans une zone gardée plate, 1 loin de toutes ; transition douce entre les deux.
function flatness(x: number, z: number): number {
  let distance = Math.hypot(x, z) - CENTER_FLAT_RADIUS;
  for (const zone of START_ZONES) {
    distance = Math.min(distance, Math.hypot(x - zone.x, z - zone.z) - zone.radius - START_FLAT_MARGIN);
  }
  for (const area of OPEN_AREAS) {
    const dx = Math.max(area.minX - x, 0, x - area.maxX);
    const dz = Math.max(area.minZ - z, 0, z - area.maxZ);
    distance = Math.min(distance, Math.hypot(dx, dz));
  }
  for (const o of OBSTACLES) distance = Math.min(distance, distanceToObstacle(x, z, o) - OBSTACLE_FLAT_MARGIN);
  const t = Math.min(1, Math.max(0, distance / FLAT_FALLOFF));
  return t * t * (3 - 2 * t);
}

function distanceToObstacle(x: number, z: number, o: Obstacle): number {
  const dx = Math.max(Math.abs(x - o.x) - o.halfWidth, 0);
  const dz = Math.max(Math.abs(z - o.z) - o.halfDepth, 0);
  return Math.hypot(dx, dz);
}
