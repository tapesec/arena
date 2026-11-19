import assert from "node:assert/strict";
import { test } from "node:test";
import { bestCandidate, rankEnemies } from "./targeting";

test("ciblage à la souris : un vivant avant un mort, un ennemi avant un allié, puis le plus proche", () => {
  const ally = { id: "allié", alive: true, enemy: false, distance: 1 };
  const enemy = { id: "ennemi", alive: true, enemy: true, distance: 5 };
  const deadEnemy = { id: "mort", alive: false, enemy: true, distance: 0.5 };
  const farEnemy = { id: "loin", alive: true, enemy: true, distance: 9 };
  assert.equal(bestCandidate([ally, enemy]), "ennemi");
  assert.equal(bestCandidate([deadEnemy, ally]), "allié");
  assert.equal(bestCandidate([farEnemy, enemy, deadEnemy]), "ennemi");
  assert.equal(bestCandidate([]), null);
});

const enemy = (id: string, distance: number, more: Partial<import("./targeting").EnemyCandidate> = {}) => ({
  id,
  distance,
  lineOfSight: true,
  inRange: true,
  inFront: true,
  controlled: false,
  ...more,
});

test("ciblage automatique : la ligne de vue d'abord, puis le plus proche", () => {
  const cache = enemy("caché", 2, { lineOfSight: false });
  const loin = enemy("loin", 20);
  const proche = enemy("proche", 8);
  assert.deepEqual(rankEnemies([cache, loin, proche]), ["proche", "loin", "caché"]);
});

test("ciblage automatique : un ennemi libre avant un ennemi sous mez ou root, sinon ce dernier", () => {
  const mez = enemy("mez", 3, { controlled: true });
  const libre = enemy("libre", 12);
  assert.deepEqual(rankEnemies([mez, libre], { preferFree: true }), ["libre", "mez"]);
  assert.deepEqual(rankEnemies([mez], { preferFree: true }), ["mez"]);
  assert.deepEqual(rankEnemies([mez, libre]), ["mez", "libre"]);
});

test("ciblage automatique : à portée, puis devant soi, avant le plus proche", () => {
  const horsPortee = enemy("hors", 2, { inRange: false });
  const derriere = enemy("derrière", 3, { inFront: false });
  const devant = enemy("devant", 10);
  assert.deepEqual(rankEnemies([horsPortee, derriere, devant], { preferInRange: true, preferFront: true }), ["devant", "derrière", "hors"]);
});
