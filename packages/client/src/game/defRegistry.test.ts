import assert from "node:assert/strict";
import { test } from "node:test";
import { createDefRegistry } from "./defRegistry";

interface Def {
  label: string;
  size: number;
  color: string;
}

const DEFAULT: Def = { label: "Nouveau", size: 1, color: "#fff" };

test("réglage enregistré, sinon de départ ; les réglages absents reprennent ceux de départ puis par défaut", () => {
  const registry = createDefRegistry<Def>(DEFAULT, { ring: { ...DEFAULT, label: "Anneau", size: 2 } });
  assert.deepEqual(registry.get("ring"), { label: "Anneau", size: 2, color: "#fff" });
  assert.equal(registry.get("absent"), null);
  registry.set({ ring: { size: 3 } as Def, spark: { label: "Étincelle", size: 5 } as Def });
  assert.deepEqual(registry.get("ring"), { label: "Anneau", size: 3, color: "#fff" });
  assert.deepEqual(registry.get("spark"), { label: "Étincelle", size: 5, color: "#fff" });
  assert.deepEqual(registry.choices(), [
    { id: "ring", label: "Anneau" },
    { id: "spark", label: "Étincelle" },
  ]);
  assert.equal(registry.label("inconnu"), "inconnu");
});
