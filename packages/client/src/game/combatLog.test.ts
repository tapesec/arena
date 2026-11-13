import assert from "node:assert/strict";
import { test } from "node:test";
import type { CombatEvent } from "@arena/shared";
import { setLanguage, t } from "../i18n";
import { formatCombatEvent, formatInterrupt } from "./combatLog";

const SELF = "me";
const nameOf = (id: string) => (id === SELF ? t("log.you") : id);
const event = (e: Partial<CombatEvent>): CombatEvent => ({ kind: "damage", sourceId: "Kael", targetId: SELF, abilityId: "firebolt", ...e });

test("journal en anglais : sujet « You », pseudos intacts, attaque et auteur", () => {
  setLanguage("en");
  assert.deepEqual(formatCombatEvent(event({ amount: 250, killed: true }), nameOf, SELF), ["Kael → you: Fire Bolt 250", "You died"]);
  assert.deepEqual(formatCombatEvent(event({ sourceId: SELF, targetId: "young42", amount: 40 }), nameOf, SELF), ["You → young42: Fire Bolt 40"]);
  assert.deepEqual(formatCombatEvent(event({ kind: "evaded", abilityId: "auto" }), nameOf, SELF), ["You evade Kael's attack"]);
  assert.deepEqual(formatCombatEvent(event({ kind: "blocked", sourceId: SELF, targetId: "Bob", abilityId: "auto" }), nameOf, SELF), ["Blocked: your attack"]);
  assert.deepEqual(formatCombatEvent(event({ kind: "debuff", targetId: "Bob", abilityId: "gangrene", detail: "gangrene" }), nameOf, SELF), ["Bob: healing reduced (Gangrene)"]);
  assert.deepEqual(formatCombatEvent(event({ kind: "cc", targetId: "Bob", abilityId: "silence", detail: "oblivion" }), nameOf, SELF), ["Bob: Oblivion"]);
  assert.equal(formatInterrupt({ casterId: SELF, abilityId: "firebolt", reason: "damage" }, nameOf, SELF), "You: Fire Bolt interrupted (damage)");
});

test("journal en français : conjugaison et ponctuation", () => {
  setLanguage("fr");
  assert.deepEqual(formatCombatEvent(event({ kind: "evaded", abilityId: "auto" }), nameOf, SELF), ["Vous esquivez l'attaque de Kael"]);
  assert.deepEqual(formatCombatEvent(event({ kind: "blocked", sourceId: SELF, targetId: "Bob", abilityId: "firebolt" }), nameOf, SELF), ["Bloqué : votre Trait de feu"]);
  assert.deepEqual(formatCombatEvent(event({ kind: "cc", targetId: "Bob", abilityId: "silence", detail: "oblivion" }), nameOf, SELF), ["Bob : Oubli"]);
  setLanguage("en");
});
