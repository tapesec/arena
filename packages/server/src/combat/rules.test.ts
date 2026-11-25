import assert from "node:assert/strict";
import { test } from "node:test";
import { STRENGTH_BUFF_BONUS, type AbilityDef, type AbilityEffect } from "@arena/shared";
import type { PlayerRuntime } from "../PlayerRuntime";
import { splitHealShares, withFalloff } from "./rules";

// Joueur réduit à ce que lisent ces règles : identifiant, position, points de vie, effets.
function fake(id: string, hp: number, maxHp: number, effects: string[] = [], x = 0): PlayerRuntime {
  return { id, state: { hp, maxHp, x, z: 0 }, has: (kind: string) => effects.includes(kind) } as unknown as PlayerRuntime;
}

test("soin réparti au prorata des points de vie manquants, sans dépasser ce qui manque", () => {
  const caster = fake("c", 100, 100);
  const shares = splitHealShares(caster, 300, [fake("a", 0, 200), fake("b", 100, 200)]);
  // 300 manquent en tout, 300 à répartir : chacun reçoit ce qui lui manque.
  assert.deepEqual([...shares], [["a", 200], ["b", 100]]);
  const short = splitHealShares(caster, 150, [fake("a", 0, 200), fake("b", 100, 200)]);
  assert.deepEqual([...short], [["a", 100], ["b", 50]]);
  // Le buff de puissance augmente le total ; l'arrondi se fait à l'unité inférieure.
  const buffed = splitHealShares(fake("c", 100, 100, ["buffStrength"]), 100, [fake("a", 0, 1000), fake("b", 0, 1000)]);
  const each = Math.floor((100 * (1 + STRENGTH_BUFF_BONUS)) / 2);
  assert.deepEqual([...buffed], [["a", each], ["b", each]]);
});

test("dégâts de zone : pleins au centre, edgeAmount au bord du rayon", () => {
  const ability = { radius: 10 } as AbilityDef;
  const effect = { type: "damage", amount: 100, edgeAmount: 40 } as AbilityEffect;
  const center = fake("c", 1, 1, [], 0);
  assert.equal((withFalloff(effect, ability, center, fake("t", 1, 1, [], 0)) as { amount: number }).amount, 100);
  assert.equal((withFalloff(effect, ability, center, fake("t", 1, 1, [], 5)) as { amount: number }).amount, 70);
  assert.equal((withFalloff(effect, ability, center, fake("t", 1, 1, [], 20)) as { amount: number }).amount, 40);
  // Sans edgeAmount : inchangé.
  const flat = { type: "damage", amount: 100 } as AbilityEffect;
  assert.equal(withFalloff(flat, ability, center, fake("t", 1, 1, [], 5)), flat);
});
