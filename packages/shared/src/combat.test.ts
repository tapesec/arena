import assert from "node:assert/strict";
import { test } from "node:test";
import { LAST_STAND_MAX_BONUS, facingTowards, isFacing, lastStandBonus, positionRelativeTo } from "./combat";

test("dernier carré : bonus par joueur d'écart, plafonné, seulement en infériorité à 4 survivants ou moins", () => {
  assert.equal(lastStandBonus(3, 4), 0.05);
  assert.equal(lastStandBonus(2, 4), 0.1);
  assert.equal(lastStandBonus(1, 8), LAST_STAND_MAX_BONUS);
  // Égalité, supériorité, trop de survivants, équipe éliminée : pas de bonus.
  assert.equal(lastStandBonus(3, 3), 0);
  assert.equal(lastStandBonus(4, 2), 0);
  assert.equal(lastStandBonus(5, 8), 0);
  assert.equal(lastStandBonus(0, 3), 0);
});

test("orientation vers une position : 0 vers +z, π/2 vers +x", () => {
  assert.equal(facingTowards({ x: 0, z: 0 }, { x: 0, z: 5 }), 0);
  assert.ok(Math.abs(facingTowards({ x: 0, z: 0 }, { x: 5, z: 0 }) - Math.PI / 2) < 1e-9);
});

test("cône de vision de 180° devant le personnage", () => {
  const observer = { x: 0, z: 0, facing: 0 };
  assert.equal(isFacing(observer, { x: 0, z: 5 }), true);
  assert.equal(isFacing(observer, { x: 5, z: 0 }), true);
  assert.equal(isFacing(observer, { x: 0, z: -5 }), false);
});

test("position de l'attaquant : devant, de côté ou dans le dos de la cible", () => {
  const target = { x: 0, z: 0, facing: 0 };
  assert.equal(positionRelativeTo(target, { x: 0, z: 3 }), "front");
  assert.equal(positionRelativeTo(target, { x: 3, z: 0 }), "side");
  assert.equal(positionRelativeTo(target, { x: -3, z: 0 }), "side");
  assert.equal(positionRelativeTo(target, { x: 0, z: -3 }), "back");
  // La cible tournée vers +x : un attaquant en +x est devant elle.
  assert.equal(positionRelativeTo({ ...target, facing: Math.PI / 2 }, { x: 3, z: 0 }), "front");
});
