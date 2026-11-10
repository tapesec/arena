import { getAbility } from "@arena/shared";
import type { CharacterAnimationSet } from "./characterAssets";

// Calage de l'animation d'une compétence, réglé sur la page animation-lab.html et enregistré dans
// animationTuning.json (par classe, puis par compétence). Les temps sont en secondes dans l'animation.
// - Sort incanté : le geste part de start au début de l'incantation et avance à la vitesse rate ; le sort part
//   au moment release = start + temps d'incantation × rate. Le geste continue ensuite jusqu'à end, à la même
//   vitesse, puis le personnage revient en fondu à sa pose normale.
// - Compétence instantanée : la portion de start à end est jouée à la vitesse rate.
// - effects : effets à particules portés par le personnage pendant le geste (voir abilityEffects.ts). Absents, le
//   sort garde ses effets d'incantation prévus dans le code (formation du Trait de feu et du Trait de givre).
export interface AbilityAnimation {
  animation: string;
  start: number;
  rate: number;
  end: number;
  effects?: AnimationEffect[];
}

// Point du personnage où s'accroche un effet.
export type EffectAnchor = "hands" | "hand_r" | "hand_l" | "weapon" | "head" | "chest" | "feet";

// Effet joué de start à end (secondes dans l'animation, dans la portion jouée), accroché à anchor, décalé de
// offset (droite, haut, avant, en mètres, dans le repère du personnage). Avec des points clés (keys, triés par
// temps), sa position va de l'un à l'autre à vitesse constante, chacun avec son accroche et son décalage ; avant le
// premier et après le dernier, elle reste sur celui-ci.
export interface AnimationEffect {
  recipe: string;
  start: number;
  end: number;
  anchor: EffectAnchor;
  offset: [number, number, number];
  keys?: EffectKey[];
}

export interface EffectKey {
  time: number;
  anchor: EffectAnchor;
  offset: [number, number, number];
}

// Effet décalé dans le temps, avec ses points clés.
export function shiftEffect(effect: AnimationEffect, shift: number): AnimationEffect {
  return {
    ...effect,
    start: effect.start + shift,
    end: effect.end + shift,
    keys: effect.keys?.map((key) => ({ ...key, time: key.time + shift })),
  };
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

// Effets d'incantation prévus dans le code : le trait se forme entre les mains pendant toute l'incantation.
const LEGACY_CHARGES: Record<string, string> = { firebolt: "fireCharge", frostbolt: "frostCharge" };

// Le sort a des effets réglés sur la page de réglage (ils remplacent alors ceux prévus dans le code).
export function hasTunedEffects(tuning: AnimationTuning, classId: string, abilityId: string): boolean {
  return tuning[classId]?.[abilityId]?.effects !== undefined;
}

// Effets d'un réglage : les siens, sinon ceux prévus dans le code.
export function effectsOf(entry: AbilityAnimation, abilityId: string): AnimationEffect[] {
  if (entry.effects) return entry.effects;
  const recipe = LEGACY_CHARGES[abilityId];
  if (!recipe) return [];
  return [{ recipe, start: entry.start, end: releaseTime(entry, castTimeOf(abilityId)), anchor: "hands", offset: [0, 0, 0] }];
}

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
  if (legacy) return { ...legacy, effects: effectsOf(legacy, abilityId) };
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
  const clamped: AbilityAnimation = { animation: entry.animation, start, rate, end };
  // Les effets restent dans la portion jouée.
  if (entry.effects) {
    clamped.effects = entry.effects.map((effect) => {
      const effectStart = Math.min(Math.max(effect.start, start), end - MIN_EFFECT);
      const effectEnd = Math.min(end, Math.max(effect.end, effectStart + MIN_EFFECT));
      const clampedEffect: AnimationEffect = { ...effect, start: effectStart, end: effectEnd };
      // Les points clés restent dans l'effet.
      if (effect.keys) clampedEffect.keys = effect.keys.map((key) => ({ ...key, time: Math.min(effectEnd, Math.max(effectStart, key.time)) }));
      return clampedEffect;
    });
  }
  return clamped;
}

// Durée minimale d'un effet (secondes dans l'animation).
const MIN_EFFECT = 0.02;
