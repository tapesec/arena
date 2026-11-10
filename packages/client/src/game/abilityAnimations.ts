import { getAbility } from "@arena/shared";
import type { CharacterAnimationSet } from "./characterAssets";

// Calage de l'animation d'une compétence, réglé sur la page animation-lab.html et enregistré dans
// animationTuning.json (par classe, puis par compétence). Les temps sont en secondes dans l'animation.
// - Sort incanté : le geste part de start au début de l'incantation et avance à la vitesse rate ; le sort part
//   au moment release = start + temps d'incantation × rate. Le geste continue ensuite jusqu'à end, à la même
//   vitesse, puis le personnage revient en fondu à sa pose normale.
// - Compétence instantanée : la portion de start à end est jouée à la vitesse rate.
export interface AbilityAnimation {
  animation: string;
  start: number;
  rate: number;
  end: number;
}

export type ClassAnimationTuning = Record<string, AbilityAnimation>;
export type AnimationTuning = Record<string, ClassAnimationTuning>;

// Bornes de la réglette de vitesse.
export const MIN_RATE = 0.2;
export const MAX_RATE = 3;

// Anciens gestes d'incantation (CastGesture) : vitesse permise pour caler leur moment fort sur le départ du sort,
// et durée jouée après lui.
const LEGACY_MIN_RATE = 0.6;
const LEGACY_MAX_RATE = 1.6;
const LEGACY_FOLLOW_THROUGH = 0.5;

export function castTimeOf(abilityId: string): number {
  return getAbility(abilityId)?.castTime ?? 0;
}

// Moment (dans l'animation) où le sort part.
export function releaseTime(entry: AbilityAnimation, castTime: number): number {
  return entry.start + castTime * entry.rate;
}

// Calage d'un sort incanté sans réglage enregistré, d'après son geste d'incantation déclaré dans le code.
export function legacyCastGesture(set: CharacterAnimationSet, abilityId: string): AbilityAnimation | null {
  const gesture = set.castGestures?.[abilityId];
  const castTime = castTimeOf(abilityId);
  if (!gesture || castTime <= 0) return null;
  const rate = Math.min(LEGACY_MAX_RATE, Math.max(LEGACY_MIN_RATE, gesture.release / castTime));
  return {
    animation: gesture.animation,
    start: Math.max(0, gesture.release - castTime * rate),
    rate,
    end: gesture.release + LEGACY_FOLLOW_THROUGH,
  };
}

// Point de départ proposé sur la page de réglage pour une compétence pas encore réglée : l'ancien geste
// d'incantation, sinon l'animation jouée au lancement, en entier.
export function suggestedAbilityAnimation(
  set: CharacterAnimationSet,
  abilityId: string,
  clipLength: (animation: string) => number,
): AbilityAnimation | null {
  const legacy = legacyCastGesture(set, abilityId);
  if (legacy) return legacy;
  const animation = set.abilities[abilityId] ?? set.abilities.default;
  if (!animation) return null;
  const length = clipLength(animation);
  const castTime = castTimeOf(abilityId);
  const baseRate = set.abilityRates?.[abilityId] ?? 1;
  if (castTime <= 0) return { animation, start: 0, rate: baseRate, end: length };
  // Incanté : fenêtre d'incantation au début de l'animation, ralentie s'il le faut pour y tenir.
  const rate = Math.max(MIN_RATE, Math.min(baseRate, length / castTime));
  return { animation, start: 0, rate, end: Math.min(length, castTime * rate + LEGACY_FOLLOW_THROUGH) };
}

// Garde un réglage dans les limites de son animation : la fenêtre d'incantation y tient, la fin suit le départ.
export function clampAbilityAnimation(entry: AbilityAnimation, castTime: number, length: number): AbilityAnimation {
  const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, castTime > 0 ? Math.min(entry.rate, length / castTime) : entry.rate));
  const start = Math.min(Math.max(0, entry.start), Math.max(0, length - castTime * rate));
  const release = start + castTime * rate;
  const end = Math.min(length, Math.max(entry.end, release + (castTime > 0 ? 0 : 0.05)));
  return { animation: entry.animation, start, rate, end };
}
