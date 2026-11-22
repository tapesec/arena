import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forwardOf, rightOf } from "@arena/shared";
import { edgeOf, hitDirection, hitStrength } from "./HitGlow";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

describe("lueur des coups reçus", () => {
  it("place la lueur sur le bord, du côté du coup", () => {
    const at = (a: { x: number; y: number }, b: { x: number; y: number }) => (near(a.x, b.x), near(a.y, b.y));
    at(edgeOf(0), { x: 50, y: 0 });
    at(edgeOf(Math.PI / 2), { x: 100, y: 50 });
    at(edgeOf(Math.PI), { x: 50, y: 100 });
    at(edgeOf(-Math.PI / 4), { x: 0, y: 0 });
  });

  it("direction de l'attaquant par rapport à la caméra", () => {
    for (const yaw of [0, 1.2, -2.5]) {
      near(hitDirection(forwardOf(yaw), yaw)!, 0);
      near(hitDirection(rightOf(yaw), yaw)!, Math.PI / 2);
      const left = rightOf(yaw);
      near(hitDirection({ x: -left.x, z: -left.z }, yaw)!, -Math.PI / 2);
    }
    assert.equal(hitDirection({ x: 0, z: 0 }, 1), null);
  });

  it("plus vive quand le coup retire beaucoup de vie", () => {
    assert.equal(hitStrength(0, 1000), 0.45);
    assert.ok(hitStrength(100, 1000) > 0.45 && hitStrength(100, 1000) < 1);
    assert.equal(hitStrength(250, 1000), 1);
    assert.equal(hitStrength(900, 1000), 1);
  });
});
