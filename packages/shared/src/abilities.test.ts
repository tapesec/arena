import assert from "node:assert/strict";
import { test } from "node:test";
import { getAbility, spellRange } from "./abilities";
import { NEAR_SIGHT_FACTOR } from "./combat";

test("Near sight réduit la portée des sorts, pas celle des techniques", () => {
  const firebolt = getAbility("firebolt")!;
  assert.equal(spellRange(firebolt, false), firebolt.range);
  assert.equal(spellRange(firebolt, true), firebolt.range * NEAR_SIGHT_FACTOR);
  const charge = getAbility("charge")!;
  assert.equal(spellRange(charge, true), charge.range);
});
