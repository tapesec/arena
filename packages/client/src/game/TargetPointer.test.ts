import assert from "node:assert/strict";
import { test } from "node:test";
import { edgePoint } from "./TargetPointer";

test("flèche vers la cible : rien si elle est à l'écran, sinon au bord, dans sa direction", () => {
  assert.equal(edgePoint(400, 300, false, 800, 600), null);
  const right = edgePoint(2000, 300, false, 800, 600)!;
  assert.equal(right.x, 800 - 48);
  assert.equal(right.y, 300);
  assert.equal(right.angle, 0);
  const above = edgePoint(400, -500, false, 800, 600)!;
  assert.equal(above.y, 48);
  assert.ok(Math.abs(above.angle + Math.PI / 2) < 1e-9);
});

test("flèche vers la cible : derrière la caméra, la direction est inversée", () => {
  // Projetée en haut à gauche alors qu'elle est derrière : la flèche pointe en bas à droite.
  const point = edgePoint(300, 200, true, 800, 600)!;
  assert.ok(point.x > 400 && point.y > 300);
  // Pile derrière : en bas.
  const behind = edgePoint(400, 300, true, 800, 600)!;
  assert.equal(behind.y, 600 - 48);
});
