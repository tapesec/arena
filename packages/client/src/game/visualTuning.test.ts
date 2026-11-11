import assert from "node:assert/strict";
import { test } from "node:test";
import { getAbility } from "@arena/shared";
import { statusKindsOf, type AbilityAnimation, type AnimationEffect, type AnimationTuning } from "./abilityAnimations";
import { BUILTIN_DEFS, CODE_RECIPES } from "./particleDefs";
import { AFFLICTIONS, STATUS_CODE, VISUALS, codeImpact } from "./codeVisuals";
import animationTuning from "./animationTuning.json";
import particleEffects from "./particleEffects.json";
import groundMarks from "./groundMarks.json";
import { BUILTIN_MARKS } from "./groundMarks";
import objects3d from "./objects3d.json";
import { BUILTIN_OBJECTS } from "./objects3d";

// Les réglages enregistrés depuis animation-lab.html restent cohérents avec le jeu : chaque effet utilisé existe,
// chaque moment réglé correspond à ce que fait la compétence.

const tuning = animationTuning as unknown as AnimationTuning;
const known = new Set([...Object.keys(CODE_RECIPES), ...Object.keys(BUILTIN_DEFS), ...Object.keys(particleEffects)]);
const knownMarks = new Set([...Object.keys(BUILTIN_MARKS), ...Object.keys(groundMarks)]);
const knownObjects = new Set([...Object.keys(BUILTIN_OBJECTS), ...Object.keys(objects3d)]);

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
          if (effect.type === "object") assert.ok(knownObjects.has(effect.recipe), `${classId}/${abilityId} (${moment}) utilise l'objet 3D introuvable « ${effect.recipe} »`);
          else if (effect.type === "ground") assert.ok(knownMarks.has(effect.recipe), `${classId}/${abilityId} (${moment}) utilise la marque au sol introuvable « ${effect.recipe} »`);
          else assert.ok(known.has(effect.recipe), `${classId}/${abilityId} (${moment}) utilise l'effet introuvable « ${effect.recipe} »`);
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

test("les visuels du code nomment des effets qui existent", () => {
  const names = [
    ...Object.values(VISUALS).flatMap((v) => [...(v.trail ?? []), ...(v.impact ?? []), ...(v.ground ?? []), ...(v.area ?? [])]),
    ...Object.values(AFFLICTIONS).flatMap((a) => a.recipes),
    ...Object.values(STATUS_CODE).flatMap((s) => s.particles.map((p) => p.recipe)),
  ];
  for (const name of names) assert.ok(name in CODE_RECIPES, `effet du code introuvable : « ${name} »`);
  // Les objets nommés par les conversions d'impact (estafilade, rayon, sphère, éclair).
  for (const ability of ["backstab", "resurrect", "guard", "shieldBash", "instantHeal"]) {
    for (const effect of codeImpact(ability).effects) {
      if (effect.type === "object") assert.ok(effect.recipe in BUILTIN_OBJECTS, `objet du code introuvable : « ${effect.recipe} »`);
    }
  }
  for (const status of Object.values(STATUS_CODE)) {
    for (const { id } of status.objects ?? []) assert.ok(id in BUILTIN_OBJECTS, `objet du code introuvable : « ${id} »`);
  }
});
