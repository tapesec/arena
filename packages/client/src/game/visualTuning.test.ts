import assert from "node:assert/strict";
import { test } from "node:test";
import { getAbility } from "@arena/shared";
import { statusKindsOf, type AbilityAnimation, type AnimationEffect, type AnimationTuning } from "./abilityAnimations";
import { BUILTIN_DEFS, CODE_RECIPES } from "./particleDefs";
import animationTuning from "./animationTuning.json";
import particleEffects from "./particleEffects.json";

// Les réglages enregistrés depuis animation-lab.html restent cohérents avec le jeu : chaque effet utilisé existe,
// chaque moment réglé correspond à ce que fait la compétence.

const tuning = animationTuning as unknown as AnimationTuning;
const known = new Set([...Object.keys(CODE_RECIPES), ...Object.keys(BUILTIN_DEFS), ...Object.keys(particleEffects)]);

function allEffects(entry: AbilityAnimation): [string, AnimationEffect[]][] {
  return [
    ["lanceur", entry.effects ?? []],
    ["impact", entry.impact?.effects ?? []],
    ["état", entry.status ?? []],
    ["zone", entry.zone ?? []],
  ];
}

test("chaque effet utilisé par une compétence existe", () => {
  for (const [classId, entries] of Object.entries(tuning)) {
    for (const [abilityId, entry] of Object.entries(entries)) {
      for (const [moment, effects] of allEffects(entry)) {
        for (const effect of effects) {
          assert.ok(known.has(effect.recipe), `${classId}/${abilityId} (${moment}) utilise l'effet introuvable « ${effect.recipe} »`);
          assert.ok(effect.end >= effect.start, `${classId}/${abilityId} (${moment}) : effet « ${effect.recipe} » qui finit avant de commencer`);
        }
      }
    }
  }
});

test("les moments réglés correspondent à la compétence", () => {
  for (const [classId, entries] of Object.entries(tuning)) {
    for (const [abilityId, entry] of Object.entries(entries)) {
      const ability = getAbility(abilityId);
      if (abilityId !== "chargeImpact") assert.ok(ability, `${classId}/${abilityId} : compétence inconnue`);
      if (entry.zone) assert.ok(ability?.radius, `${classId}/${abilityId} : zone réglée sur une compétence sans zone`);
      if (entry.status) assert.ok(statusKindsOf(abilityId).length, `${classId}/${abilityId} : état réglé sur une compétence qui n'en laisse pas`);
      const reaction = entry.impact?.reaction;
      if (reaction) assert.ok(reaction.end > reaction.start && reaction.rate > 0, `${classId}/${abilityId} : réaction vide`);
    }
  }
});
