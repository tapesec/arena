import type { Position } from "./movement";
import { terrainBlocksSight } from "./terrain";

// Obstacle rectangulaire aligné sur les axes, vu de dessus.
export interface Obstacle {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
}

// Carte symétrique par rotation de 180° autour du centre : (x, z) ↔ (-x, -z), pour qu'aucune équipe
// ne soit avantagée. Bleus en (-36, -36), Rouges en (36, 36).
//  - au centre, des ruines carrées avec une entrée au milieu de chaque côté et un pilier ;
//  - sur les approches, des piliers qui coupent les lignes de vue ;
//  - sur les flancs, des murs pour contourner à couvert ;
//  - deux grandes zones ouvertes, en (37, 10) et (-37, -10), où un groupe est exposé ;
//  - peu de couvert près des zones de départ.
const half = (o: Obstacle): Obstacle[] => [o, { ...o, x: -o.x, z: -o.z }];

export const OBSTACLES: Obstacle[] = [
  // Ruines centrales.
  ...half({ x: -5, z: 8, halfWidth: 3, halfDepth: 0.6 }),
  ...half({ x: 5, z: 8, halfWidth: 3, halfDepth: 0.6 }),
  ...half({ x: 8, z: -5, halfWidth: 0.6, halfDepth: 3 }),
  ...half({ x: 8, z: 5, halfWidth: 0.6, halfDepth: 3 }),
  { x: 0, z: 0, halfWidth: 1.2, halfDepth: 1.2 },
  // Piliers sur les approches du centre.
  ...half({ x: 14, z: 14, halfWidth: 1, halfDepth: 1 }),
  ...half({ x: 18, z: -8, halfWidth: 1, halfDepth: 1 }),
  // Flancs : murs et blocs.
  ...half({ x: 24, z: -26, halfWidth: 0.6, halfDepth: 5 }),
  ...half({ x: 8, z: -30, halfWidth: 4, halfDepth: 0.6 }),
  ...half({ x: 36, z: -14, halfWidth: 2, halfDepth: 2 }),
  // Un seul abri près de chaque zone de départ.
  ...half({ x: 22, z: 34, halfWidth: 4, halfDepth: 0.6 }),
];

export const OBSTACLE_HEIGHT = 3;

// Repousse un cercle (un personnage) hors des obstacles qu'il chevauche.
export function resolveObstacleCollisions(pos: Position, radius: number): Position {
  let { x, z } = pos;
  for (const o of OBSTACLES) {
    const closestX = clamp(x, o.x - o.halfWidth, o.x + o.halfWidth);
    const closestZ = clamp(z, o.z - o.halfDepth, o.z + o.halfDepth);
    const dx = x - closestX;
    const dz = z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;

    if (distSq > 1e-9) {
      const dist = Math.sqrt(distSq);
      x = closestX + (dx / dist) * radius;
      z = closestZ + (dz / dist) * radius;
    } else {
      // Centre à l'intérieur de l'obstacle : on sort par le côté le plus proche.
      const pushX = o.halfWidth + radius - Math.abs(x - o.x);
      const pushZ = o.halfDepth + radius - Math.abs(z - o.z);
      if (pushX < pushZ) x += Math.sign(x - o.x || 1) * pushX;
      else z += Math.sign(z - o.z || 1) * pushZ;
    }
  }
  return { x, z };
}

// Vrai si aucun obstacle ne coupe le segment entre les deux positions.
// Ligne de vue : ni obstacle (plus hauts que les yeux) ni relief entre les deux.
// obstacles : liste à vérifier, réductible à ceux du voisinage pour les calculs en masse (brouillard).
export function hasLineOfSight(a: Position, b: Position, obstacles: Obstacle[] = OBSTACLES): boolean {
  return obstacles.every((o) => !segmentIntersectsObstacle(a, b, o, 0)) && !terrainBlocksSight(a, b);
}

// Vrai si un personnage de rayon "margin" peut aller de a à b en ligne droite sans toucher d'obstacle.
export function hasClearPath(a: Position, b: Position, margin: number): boolean {
  return OBSTACLES.every((o) => !segmentIntersectsObstacle(a, b, o, margin));
}

// Vrai si la position est dans un obstacle élargi de "margin".
export function isInsideObstacle(pos: Position, margin: number): boolean {
  return OBSTACLES.some(
    (o) => Math.abs(pos.x - o.x) <= o.halfWidth + margin && Math.abs(pos.z - o.z) <= o.halfDepth + margin,
  );
}

// Méthode des "slabs" : on intersecte le segment avec chaque paire de bords du rectangle
// (élargi de "margin" de chaque côté).
function segmentIntersectsObstacle(a: Position, b: Position, o: Obstacle, margin: number): boolean {
  let tMin = 0;
  let tMax = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, o.x - o.halfWidth - margin, o.x + o.halfWidth + margin],
    [a.z, b.z - a.z, o.z - o.halfDepth - margin, o.z + o.halfDepth + margin],
  ];
  for (const [start, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (start < min || start > max) return false;
      continue;
    }
    let t1 = (min - start) / delta;
    let t2 = (max - start) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
