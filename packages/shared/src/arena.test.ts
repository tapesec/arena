import assert from "node:assert/strict";
import { test } from "node:test";
import { OBSTACLES, hasClearPath, hasLineOfSight, isInsideObstacle, resolveObstacleCollisions } from "./arena";

// Première maison du hameau : 8 × 8 m centrée en (14, 14).
const house = OBSTACLES[0];

test("une maison coupe le passage et la ligne de vue", () => {
  assert.deepEqual([house.x, house.z, house.halfWidth, house.halfDepth], [14, 14, 4, 4]);
  const south = { x: 14, z: 5 };
  const north = { x: 14, z: 23 };
  assert.equal(hasClearPath(south, north, 0.5), false);
  assert.equal(hasLineOfSight(south, north), false);
  // Le long de la façade, à plus d'une marge de distance : le passage est libre.
  assert.equal(hasClearPath({ x: 19, z: 9 }, { x: 19, z: 19 }, 0.5), true);
  // Même segment, marge plus large que l'écart : il frôle la maison.
  assert.equal(hasClearPath({ x: 19, z: 9 }, { x: 19, z: 19 }, 1.5), false);
});

test("un personnage qui chevauche un mur en est repoussé", () => {
  assert.equal(isInsideObstacle({ x: 14, z: 14 }, 0), true);
  assert.equal(isInsideObstacle({ x: 18.3, z: 14 }, 0.5), true);
  const pushed = resolveObstacleCollisions({ x: 18.3, z: 14 }, 0.5);
  assert.ok(Math.abs(pushed.x - 18.5) < 1e-9);
  assert.equal(pushed.z, 14);
  // Centre à l'intérieur : sortie par le côté le plus proche.
  const inside = resolveObstacleCollisions({ x: 17.5, z: 14 }, 0.5);
  assert.ok(Math.abs(inside.x - 18.5) < 1e-9);
});
