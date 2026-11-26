import assert from "node:assert/strict";
import { test } from "node:test";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { Scene } from "@babylonjs/core/scene";
import { ScreenProjector } from "./screenProjection";

// Scène minimale : caméra plein écran, aucune transformation (le point (0, 0) du monde est au centre de l'écran), rendu
// en 400 × 200 pour un canvas affiché en 200 × 100 (écran haute densité).
function projector() {
  const scene = {
    activeCamera: { viewport: new Viewport(0, 0, 1, 1) },
    getEngine: () => ({ getRenderWidth: () => 400, getRenderHeight: () => 200 }),
    getTransformMatrix: () => Matrix.Identity(),
  } as unknown as Scene;
  return new ScreenProjector(scene, { clientWidth: 200, clientHeight: 100 } as HTMLCanvasElement);
}

test("un point se projette en pixels CSS du canvas, pas en coordonnées normalisées", () => {
  const point = projector().project(0, 0, 0.5);
  assert.equal(point.visible, true);
  assert.equal(point.x, 100);
  assert.equal(point.y, 50);
  const corner = projector().project(1, 1, 0.5);
  assert.equal(corner.x, 200);
  assert.equal(corner.y, 0);
});

test("un point derrière la caméra n'est pas visible", () => {
  assert.equal(projector().project(0, 0, -2).visible, false);
});
