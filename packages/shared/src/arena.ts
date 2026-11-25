import type { Position } from "./movement";
import { terrainBlocksSight } from "./terrain";

// Nature d'un obstacle : sans effet sur les règles (tous bloquent le passage et la vue), elle dit au client
// comment l'habiller.
export type ObstacleKind = "house" | "stall" | "crates" | "wall" | "shed" | "fence";

// Obstacle rectangulaire aligné sur les axes, vu de dessus.
export interface Obstacle {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  kind: ObstacleKind;
}

// Place pavée au centre du hameau, dégagée : rien n'y cache la vue, hormis deux étals sur ses bords.
export const PLAZA = { x: 0, z: 0, radius: 14 };

// Carte symétrique par rotation de 180° autour du centre : (x, z) ↔ (-x, -z), pour qu'aucune équipe
// ne soit avantagée. Première équipe en (-36, -36), seconde en (36, 36).
//  - au centre, un hameau : six maisons fermées autour de la place. Par moitié de carte, une large entrée,
//    un coin ouvert et une ruelle étroite ; la grande maison cache la place à qui arrive de son départ ;
//  - sur les approches, des piles de caisses qui coupent les lignes de vue ;
//  - sur les flancs, des murets pour contourner à couvert, et des cabanes ;
//  - deux grandes zones ouvertes, en (37, 10) et (-37, -10), où un groupe est exposé ;
//  - peu de couvert près des zones de départ.
const half = (o: Obstacle): Obstacle[] => [o, { ...o, x: -o.x, z: -o.z }];

export const OBSTACLES: Obstacle[] = [
  // Hameau : grandes maisons face aux départs (8 × 8 m), maisons moyennes (8 × 6 m) et petites (6 × 8 m).
  ...half({ x: 14, z: 14, halfWidth: 4, halfDepth: 4, kind: "house" }),
  ...half({ x: -6, z: 16, halfWidth: 4, halfDepth: 3, kind: "house" }),
  ...half({ x: 16, z: 3, halfWidth: 3, halfDepth: 4, kind: "house" }),
  // Étals de marché devant les petites maisons, au bord de la place.
  ...half({ x: 10, z: 3, halfWidth: 0.5, halfDepth: 0.9, kind: "stall" }),
  // Caisses et chariots sur les approches.
  ...half({ x: 22, z: 22, halfWidth: 1, halfDepth: 1, kind: "crates" }),
  ...half({ x: 18, z: -8, halfWidth: 1, halfDepth: 1, kind: "crates" }),
  // Flancs : murets et cabanes.
  ...half({ x: 24, z: -26, halfWidth: 0.4, halfDepth: 5, kind: "wall" }),
  ...half({ x: 8, z: -30, halfWidth: 4, halfDepth: 0.4, kind: "wall" }),
  ...half({ x: 36, z: -14, halfWidth: 2, halfDepth: 2, kind: "shed" }),
  // Un seul abri près de chaque zone de départ.
  ...half({ x: 22, z: 34, halfWidth: 4, halfDepth: 0.4, kind: "fence" }),
];

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
// (élargi de "margin" de chaque côté). Appelée des dizaines de milliers de fois par seconde (lignes de vue, chemins des
// bots) : calcul en nombres simples, sans tableau.
function segmentIntersectsObstacle(a: Position, b: Position, o: Obstacle, margin: number): boolean {
  let tMin = 0;
  let tMax = 1;
  // Axe x, puis axe z.
  for (let axis = 0; axis < 2; axis++) {
    const start = axis === 0 ? a.x : a.z;
    const delta = axis === 0 ? b.x - a.x : b.z - a.z;
    const center = axis === 0 ? o.x : o.z;
    const half = (axis === 0 ? o.halfWidth : o.halfDepth) + margin;
    const min = center - half;
    const max = center + half;
    if (Math.abs(delta) < 1e-9) {
      if (start < min || start > max) return false;
      continue;
    }
    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return false;
  }
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
