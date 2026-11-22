import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edgeOf, hitStrength } from "./HitGlow";

describe("lueur des coups reçus", () => {
  it("place la lueur sur le bord, du côté du coup", () => {
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, JSON.stringify(a));
    near(edgeOf(0), { x: 50, y: 0 });
    near(edgeOf(Math.PI / 2), { x: 100, y: 50 });
    near(edgeOf(Math.PI), { x: 50, y: 100 });
    near(edgeOf(-Math.PI / 4), { x: 0, y: 0 });
  });

  it("plus vive quand le coup retire beaucoup de vie", () => {
    assert.equal(hitStrength(0, 1000), 0.45);
    assert.ok(hitStrength(100, 1000) > 0.45 && hitStrength(100, 1000) < 1);
    assert.equal(hitStrength(250, 1000), 1);
    assert.equal(hitStrength(900, 1000), 1);
  });
});
