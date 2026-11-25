import assert from "node:assert/strict";
import { test } from "node:test";
import { hexToRgb } from "./color";
import { seededRandom } from "./seededRandom";

test("couleur hexadécimale en composantes", () => {
  assert.equal(hexToRgb("#2878ff"), "40,120,255");
  assert.equal(hexToRgb("eb2d14"), "235,45,20");
  assert.equal(hexToRgb("pas une couleur"), "0,0,0");
});

test("une même graine redonne les mêmes tirages, entre 0 et 1", () => {
  const a = seededRandom(3);
  const b = seededRandom(3);
  const draws = Array.from({ length: 5 }, () => a());
  assert.deepEqual(draws, Array.from({ length: 5 }, () => b()));
  for (const value of draws) assert.ok(value >= 0 && value < 1);
  // Suite figée : changer le générateur changerait l'allure des effets déjà réglés.
  assert.equal(seededRandom(1)(), ((((1 * 9301 + 49297) % 233280) * 9301 + 49297) % 233280) / 233280);
});
