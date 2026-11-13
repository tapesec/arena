import assert from "node:assert/strict";
import { test } from "node:test";
import { wheelSlot } from "./OrderWheel";

test("roue des ordres : la case pointée suit la souris, la première en haut, dans le sens horaire", () => {
  assert.equal(wheelSlot(0, -100, 8), 0);
  assert.equal(wheelSlot(70, -70, 8), 1);
  assert.equal(wheelSlot(100, 0, 8), 2);
  assert.equal(wheelSlot(0, 100, 8), 4);
  assert.equal(wheelSlot(-100, 0, 8), 6);
  assert.equal(wheelSlot(-70, -70, 8), 7);
  // Juste à gauche du haut : encore la case 0.
  assert.equal(wheelSlot(-10, -100, 8), 0);
});

test("roue des ordres : rien n'est pointé près du centre", () => {
  assert.equal(wheelSlot(5, -10, 8), null);
});
