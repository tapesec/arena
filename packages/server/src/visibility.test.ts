import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

  it("un pilier entre les deux bloque la vue", () => {
    // Pilier au centre des ruines, en (0, 0).
    const seen = computeTeamVisibility([unit("a", 0, -5, 0), unit("e", 1, 5, 0)]);
    assert.ok(!seen.get(0)!.has("e"));
  });

  it("un allié mort ne fournit plus de vision", () => {
    const seen = computeTeamVisibility([unit("mort", 0, 5, 0, false), unit("vivant", 0, -40, -40), unit("e", 1, 5, 5)]);
    assert.ok(!seen.get(0)!.has("e"));
  });
});
