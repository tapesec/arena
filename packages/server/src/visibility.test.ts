import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { START_ZONES, terrainHeight } from "@arena/shared";
import { computeTeamVisibility, type VisibilityUnit } from "./visibility";

const unit = (id: string, team: number, x: number, z: number, alive = true): VisibilityUnit => ({ id, team, x, z, alive });

describe("Brouillard de guerre", () => {
  it("une équipe voit toujours ses membres, même éloignés", () => {
    const seen = computeTeamVisibility([unit("a", 0, -40, -40), unit("b", 0, 40, 40)]);
    assert.deepEqual([...seen.get(0)!].sort(), ["a", "b"]);
  });

  it("un ennemi est vu à portée de vue, pas au-delà", () => {
    const seen = computeTeamVisibility([unit("a", 0, 37, -9), unit("near", 1, 37, 21), unit("far", 1, 37, 30)]);
    assert.ok(seen.get(0)!.has("near"));
    assert.ok(!seen.get(0)!.has("far"));
  });

  it("une maison entre les deux bloque la vue", () => {
    // Grande maison du hameau, en (14, 14) sur 8 × 8 m.
    const seen = computeTeamVisibility([unit("a", 0, 8, 14), unit("e", 1, 20, 14)]);
    assert.ok(!seen.get(0)!.has("e"));
  });

  it("un allié mort ne fournit plus de vision", () => {
    const seen = computeTeamVisibility([unit("mort", 0, 5, 0, false), unit("vivant", 0, -40, -40), unit("e", 1, 5, 5)]);
    assert.ok(!seen.get(0)!.has("e"));
  });
});

describe("Relief", () => {
  it("le centre, les zones de départ et les zones ouvertes sont plats", () => {
    for (const p of [{ x: 0, z: 0 }, ...START_ZONES, { x: 37, z: 10 }, { x: -37, z: -10 }]) {
      assert.ok(Math.abs(terrainHeight(p.x, p.z)) < 0.01, `sol non plat en (${p.x}, ${p.z})`);
    }
  });

  it("le relief est symétrique, comme la carte", () => {
    for (const p of [{ x: 38, z: -34 }, { x: 3, z: -40 }, { x: -20, z: -18.5 }, { x: 30, z: -25 }]) {
      assert.ok(Math.abs(terrainHeight(p.x, p.z) - terrainHeight(-p.x, -p.z)) < 1e-6);
    }
  });

  it("un plateau a un large dessus plat", () => {
    for (const p of [{ x: 38, z: -34 }, { x: 33, z: -28 }, { x: 43, z: -40 }]) {
      assert.ok(Math.abs(terrainHeight(p.x, p.z) - 3) < 0.05, `pas sur le dessus en (${p.x}, ${p.z})`);
    }
  });

  it("un plateau cache un ennemi placé derrière", () => {
    const seen = computeTeamVisibility([unit("a", 0, 18, -36), unit("e", 1, 32, -34)]);
    assert.ok(terrainHeight(18, -36) < 0.5 && terrainHeight(32, -34) > 2.5);
    // Ennemi au pied du plateau, de l'autre côté : caché par le plateau.
    const hidden = computeTeamVisibility([unit("a", 0, 38, -12), unit("e", 1, 38, -46)]);
    assert.ok(seen.get(0)!.has("e"), "un ennemi au bord du plateau se voit depuis la plaine");
    assert.ok(!hidden.get(0)!.has("e"));
  });

  it("depuis le plateau, on voit par-dessus la crête", () => {
    const seen = computeTeamVisibility([unit("a", 0, 38, -34), unit("e", 1, 12, -48)]);
    assert.ok(seen.get(0)!.has("e"));
  });
});
