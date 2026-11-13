import { CLASSES, EFFECTS, getAbility, type ClassId, type EffectKind } from "@arena/shared";
import { ABILITIES_EN, CLASSES_EN, EFFECTS_EN } from "./content.en";
import { currentLanguage } from "./language";

// Noms du contenu du jeu (compétences, effets, classes) dans la langue courante. Le français vient de @arena/shared ;
// l'identifiant sert de repli si un texte manque.

export function abilityName(id: string): string {
  if (currentLanguage() === "en") return ABILITIES_EN[id]?.name ?? id;
  return getAbility(id)?.name ?? id;
}

export function abilityDescription(id: string): string {
  if (currentLanguage() === "en") return ABILITIES_EN[id]?.description ?? "";
  return getAbility(id)?.description ?? "";
}

export function effectLabel(kind: string): string {
  if (currentLanguage() === "en") return EFFECTS_EN[kind as EffectKind] ?? kind;
  return EFFECTS[kind as EffectKind]?.label ?? kind;
}

export function className(id: string): string {
  if (currentLanguage() === "en") return CLASSES_EN[id as ClassId]?.name ?? id;
  return CLASSES[id as ClassId]?.name ?? id;
}

export function classRole(id: string): string {
  if (currentLanguage() === "en") return CLASSES_EN[id as ClassId]?.role ?? "";
  return CLASSES[id as ClassId]?.role ?? "";
}
