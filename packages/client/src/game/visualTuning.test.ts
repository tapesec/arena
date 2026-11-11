import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAbility } from "@arena/shared";
import { canHaveProjectile, statusKindsOf, type AbilityAnimation, type AnimationEffect, type AnimationTuning } from "./abilityAnimations";
import { BUILTIN_DEFS, CODE_RECIPES } from "./particleDefs";
import { AFFLICTIONS, STATUS_CODE, VISUALS, codeImpact } from "./codeVisuals";
import animationTuning from "./animationTuning.json";
import particleEffects from "./particleEffects.json";
import groundMarks from "./groundMarks.json";
import { BUILTIN_MARKS } from "./groundMarks";
import objects3d from "./objects3d.json";
import { BUILTIN_OBJECTS } from "./objects3d";
import overlays2d from "./overlays2d.json";
import soundCatalog from "../audio/soundCatalog.json";
import samples from "../audio/samples.json";
import { SOUNDS } from "../audio/sounds";
import { BUILTIN_OVERLAYS } from "./overlays2d";

// Les réglages enregistrés depuis animation-lab.html restent cohérents avec le jeu : chaque effet utilisé existe,
// chaque moment réglé correspond à ce que fait la compétence.

const tuning = animationTuning as unknown as AnimationTuning;
const known = new Set([...Object.keys(CODE_RECIPES), ...Object.keys(BUILTIN_DEFS), ...Object.keys(particleEffects)]);
const knownMarks = new Set([...Object.keys(BUILTIN_MARKS), ...Object.keys(groundMarks)]);
const knownObjects = new Set([...Object.keys(BUILTIN_OBJECTS), ...Object.keys(objects3d)]);
const knownSounds = new Set([
  ...(soundCatalog as { name: string }[]).map((s) => s.name),
  ...Object.keys(samples.groups).map((id) => `jeu:${id}`),
  ...Object.keys(SOUNDS).map((id) => `jeu:${id}`),
]);
const knownOverlays = new Set([...Object.keys(BUILTIN_OVERLAYS), ...Object.keys(overlays2d)]);

function allEffects(entry: AbilityAnimation): [string, AnimationEffect[]][] {
  return [
    ["lanceur", entry.effects ?? []],
    ["trajet", entry.projectile?.effects ?? []],
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
          if (effect.type === "sound") assert.ok(knownSounds.has(effect.recipe), `${classId}/${abilityId} (${moment}) utilise le son introuvable « ${effect.recipe} »`);
          else if (effect.type === "overlay") assert.ok(knownOverlays.has(effect.recipe), `${classId}/${abilityId} (${moment}) utilise l'affichage 2D introuvable « ${effect.recipe} »`);
          else if (effect.type === "object") assert.ok(knownObjects.has(effect.recipe), `${classId}/${abilityId} (${moment}) utilise l'objet 3D introuvable « ${effect.recipe} »`);
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
      if (entry.projectile?.enabled) assert.ok(canHaveProjectile(abilityId), `${classId}/${abilityId} : projectile sur une compétence sans autre cible que son lanceur`);
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
    for (const { id } of status.overlays ?? []) assert.ok(id in BUILTIN_OVERLAYS, `affichage du code introuvable : « ${id} »`);
    for (const { id } of status.marks ?? []) assert.ok(id in BUILTIN_MARKS, `marque du code introuvable : « ${id} »`);
  }
});

// Sons protégés (licence), et index du conteneur brouillé public/sounds/tuned/protected.bin (voir build-sounds.mjs).
const protectedNames = new Set((soundCatalog as { name: string; protected?: boolean }[]).filter((s) => s.protected).map((s) => s.name));
function containerIndex(): Record<string, [number, number]> {
  const file = fileURLToPath(new URL("../../public/sounds/tuned/protected.bin", import.meta.url));
  if (!existsSync(file)) return {};
  const data = readFileSync(file);
  const indexLength = data.readUInt32LE(4);
  const body = Uint8Array.from(data.subarray(8, 8 + indexLength));
  let state = 0x5eed1234;
  for (let i = 0; i < body.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    body[i] ^= state & 0xff;
  }
  return JSON.parse(new TextDecoder().decode(body)) as Record<string, [number, number]>;
}

test("chaque son du catalogue utilisé par une compétence est prêt pour le jeu publié", () => {
  // public/sounds/tuned/<nom>.m4a : produit par « node scripts/build-sounds.mjs --tuned ».
  const tuned = fileURLToPath(new URL("../../public/sounds/tuned/", import.meta.url));
  for (const [classId, entries] of Object.entries(tuning)) {
    for (const [abilityId, entry] of Object.entries(entries)) {
      for (const [moment, effects] of allEffects(entry)) {
        for (const effect of effects) {
          if (effect.type !== "sound" || effect.recipe.startsWith("jeu:")) continue;
          // Un son protégé (licence) n'existe jamais en fichier séparé, seulement dans le conteneur brouillé.
          if (protectedNames.has(effect.recipe)) {
            assert.ok(!existsSync(`${tuned}${effect.recipe}.m4a`), `« ${effect.recipe} » est protégé : il ne doit pas exister en fichier séparé`);
            assert.ok(containerIndex()[effect.recipe], `${classId}/${abilityId} (${moment}) : « ${effect.recipe} » n'est pas dans le conteneur protégé (node scripts/build-sounds.mjs --tuned)`);
            continue;
          }
          assert.ok(
            existsSync(`${tuned}${effect.recipe}.m4a`),
            `${classId}/${abilityId} (${moment}) : « ${effect.recipe} » n'est pas converti pour le jeu (node scripts/build-sounds.mjs --tuned)`,
          );
        }
      }
    }
  }
});
