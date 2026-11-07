import type { Position } from "./movement";

// Obstacle rectangulaire aligné sur les axes, vu de dessus.
export interface Obstacle {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
}

// Disposition provisoire : des piliers et des murets autour du centre,
// laissés à distance de la zone d'apparition (rayon de 5 m autour de l'origine).
export const OBSTACLES: Obstacle[] = [
  { x: 10, z: 0, halfWidth: 1, halfDepth: 1 },
  { x: -10, z: 0, halfWidth: 1, halfDepth: 1 },
  { x: 0, z: 10, halfWidth: 1, halfDepth: 1 },
  { x: 0, z: -10, halfWidth: 1, halfDepth: 1 },
  { x: 16, z: 16, halfWidth: 4, halfDepth: 0.75 },
  { x: -16, z: -16, halfWidth: 4, halfDepth: 0.75 },
  { x: 16, z: -16, halfWidth: 0.75, halfDepth: 4 },
  { x: -16, z: 16, halfWidth: 0.75, halfDepth: 4 },
  { x: 28, z: 4, halfWidth: 2, halfDepth: 2 },
  { x: -28, z: -4, halfWidth: 2, halfDepth: 2 },
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
export function hasLineOfSight(a: Position, b: Position): boolean {
  return OBSTACLES.every((o) => !segmentIntersectsObstacle(a, b, o, 0));
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
