import assert from "node:assert/strict";
import { test } from "node:test";
import { bestCandidate } from "./targeting";

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
