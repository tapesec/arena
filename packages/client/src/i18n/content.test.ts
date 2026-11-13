import assert from "node:assert/strict";
import { test } from "node:test";
import { ABILITIES } from "@arena/shared";
import { ABILITIES_EN } from "./content.en";

// Effets et classes sont typés (Record sur EffectKind et ClassId) ; les compétences n'ont pas de type d'identifiant.
test("chaque compétence a un nom et une description en anglais, sans entrée en trop", () => {
  for (const id of Object.keys(ABILITIES)) {
    assert.ok(ABILITIES_EN[id]?.name && ABILITIES_EN[id]?.description, `${id} : texte anglais manquant`);
  }
  for (const id of Object.keys(ABILITIES_EN)) assert.ok(ABILITIES[id], `${id} : compétence inconnue`);
});
