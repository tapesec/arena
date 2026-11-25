import assert from "node:assert/strict";
import { test } from "node:test";
import { ARENA_SIZE, MOVE_SPEED, PLAYER_RADIUS } from "./constants";
import { NO_INPUT, directionToInput, moveDirection, movesBody, normalizeAngle, stepMovement } from "./movement";

test("angle ramené dans ]-π, π]", () => {
  assert.ok(Math.abs(normalizeAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(normalizeAngle(-Math.PI / 2 - 2 * Math.PI) + Math.PI / 2) < 1e-9);
});

test("une direction devient une commande qui avance en s'orientant, une direction nulle n'en donne aucune", () => {
  const input = directionToInput({ x: 1, z: 0 });
  assert.equal(input.up, true);
  assert.equal(input.steer, true);
  assert.ok(Math.abs((input.yaw ?? 0) - Math.PI / 2) < 1e-9);
  assert.equal(directionToInput({ x: 0, z: 0 }), NO_INPUT);
});

test("pivoter ne déplace pas le corps ; le pas de côté seulement en orientant à la souris", () => {
  assert.equal(movesBody({ ...NO_INPUT, left: true }), false);
  assert.equal(movesBody({ ...NO_INPUT, left: true, steer: true }), true);
  assert.equal(movesBody({ ...NO_INPUT, up: true, down: true }), false);
  const strafe = moveDirection({ ...NO_INPUT, right: true, steer: true }, 0);
  assert.ok(Math.abs(strafe.x - 1) < 1e-9 && Math.abs(strafe.z) < 1e-9);
});

test("un pas avance à la vitesse de déplacement et reste dans l'arène", () => {
  const moved = stepMovement({ x: 0, z: -40 }, { x: 0, z: -1 }, 1);
  assert.ok(Math.abs(moved.z - (-40 - MOVE_SPEED)) < 1e-9);
  const limit = ARENA_SIZE / 2 - PLAYER_RADIUS;
  const blocked = stepMovement({ x: 0, z: -limit + 0.1 }, { x: 0, z: -1 }, 1);
  assert.equal(blocked.z, -limit);
  // Vitesse nulle (root) : on ne bouge pas.
  assert.deepEqual(stepMovement({ x: 1, z: 2 }, { x: 1, z: 0 }, 1, 0), { x: 1, z: 2 });
});
