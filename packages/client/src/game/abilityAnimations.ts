import { getAbility } from "@arena/shared";
import type { CharacterAnimationSet } from "./characterAssets";

// Calage du geste d'une compétence, réglé sur la page animation-lab.html et enregistré dans animationTuning.json
// (par classe, puis par compétence). Les temps du lanceur sont en secondes réelles depuis le début du geste : le
// début de l'incantation pour un sort incanté (le sort part à castTime), le lancement pour une compétence
// instantanée (le sort part à 0).
// - clips : les animations jouées l'une après l'autre, chacune sur sa portion et à sa vitesse. Elles vont jusqu'au
//   bout, même après le départ du sort ; après la dernière, le personnage revient en fondu à sa pose normale (et
//   pendant une incantation plus longue que les animations, il attend dans sa pose normale). Aucune : pas de geste.
// - effects : effets portés par le personnage (voir abilityEffects.ts). Absents, le sort garde ses effets
//   d'incantation prévus dans le code (formation du Trait de feu et du Trait de givre).
export interface AbilityAnimation {
  clips: AbilityClip[];
  effects?: AnimationEffect[];
  // Vol vers la cible (PROJECTILE_TRAVEL_TIME, 0,3 s), seulement pour une compétence qui vise un autre que son
  // lanceur. Absent : le jeu garde son projectile du code (les « bolts ») ou son absence ; enabled false : pas de
  // projectile, l'impact est immédiat.
  projectile?: ProjectileVisual;
  // Ce que subit chaque cible touchée, à partir de l'impact (arrivée du projectile, sinon départ du sort).
  // Présent, il remplace les effets d'impact prévus dans le code.
  impact?: ImpactVisual;
  // Effets sur la cible tant que dure l'état laissé par la compétence (mez, root, buff…), en secondes depuis le
  // début de l'état. Ils s'ajoutent aux visuels d'état prévus dans le code.
  status?: AnimationEffect[];
  // Effets sur la zone d'effet, une seule fois en son centre, en secondes depuis l'impact. Présents, ils remplacent
  // les particules de zone prévues dans le code (le disque qui montre la portée reste).
  zone?: AnimationEffect[];
}

// Trajet du projectile, du lanceur (point from, au départ du sort) à la cible (point to, qu'il suit) :
// - straight : en ligne droite ; arc : en cloche, de hauteur height ; spiral : en vrille autour de la ligne, de
//   rayon height et turns tours ; wave : en ondulant sur le côté, d'amplitude height et turns ondulations ;
//   zigzag : en turns cassures au hasard, d'amplitude height ; curve : en partant
//   sur le côté (height mètres ; négatif : de l'autre côté) puis en revenant.
// - speed : vitesse constante, qui accélère ou qui ralentit.
// - align : les objets 3D du projectile pointent (leur profondeur, axe z) dans le sens du trajet.
// - effects : effets portés par le projectile (temps de 0 à 0,3 s ; leur décalage est autour du projectile).
export interface ProjectileVisual {
  enabled: boolean;
  path: ProjectilePath;
  height: number;
  turns: number;
  speed: "constant" | "accelerate" | "decelerate";
  from: EffectAnchor;
  fromOffset: [number, number, number];
  to: EffectAnchor;
  align: boolean;
  effects: AnimationEffect[];
}

export type ProjectilePath = "straight" | "arc" | "spiral" | "wave" | "zigzag" | "curve";

// Une animation du geste : la portion start → end (secondes dans l'animation), jouée à la vitesse rate.
export interface AbilityClip {
  animation: string;
  start: number;
  end: number;
  rate: number;
}

// Durée à l'écran d'une animation du geste.
export function clipDuration(clip: AbilityClip): number {
  return Math.max(0, clip.end - clip.start) / clip.rate;
}

// Durée à l'écran de toutes les animations du geste.
export function sequenceLength(entry: AbilityAnimation): number {
  return entry.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
}

// Animation jouée à l'instant time (secondes depuis le début du geste), son rang, son début à l'écran et l'instant
// montré dans l'animation ; null avant le début ou après la dernière.
export function clipAt(entry: AbilityAnimation, time: number): { clip: AbilityClip; index: number; offset: number; clipTime: number } | null {
  if (time < 0) return null;
  let offset = 0;
  for (let index = 0; index < entry.clips.length; index++) {
    const clip = entry.clips[index];
    const duration = clipDuration(clip);
    if (time < offset + duration) return { clip, index, offset, clipTime: clip.start + (time - offset) * clip.rate };
    offset += duration;
  }
  return null;
}

// Durée du moment du lanceur : jusqu'à la fin de la dernière animation ou du dernier effet.
export function casterLength(entry: AbilityAnimation): number {
  let length = sequenceLength(entry);
  for (const effect of entry.effects ?? []) length = Math.max(length, effect.end);
  return length;
}

// Ancien format (une seule animation, temps en secondes dans l'animation) : converti au format actuel. Les effets
// passent en secondes réelles depuis le début du geste (t → (t - start) / rate).
interface LegacyAbilityAnimation extends Omit<AbilityAnimation, "clips">, AbilityClip {}
export function normalizeAbilityAnimation(raw: AbilityAnimation | LegacyAbilityAnimation): AbilityAnimation {
  if ("clips" in raw && Array.isArray(raw.clips)) return raw as AbilityAnimation;
  const legacy = raw as LegacyAbilityAnimation;
  const { animation, start, rate, end, ...rest } = legacy;
  const toReal = (time: number) => (time - start) / rate;
  const entry: AbilityAnimation = { ...rest, clips: animation ? [{ animation, start, end, rate }] : [] };
  if (legacy.effects) {
    entry.effects = legacy.effects.map((effect) => ({
      ...effect,
      start: toReal(effect.start),
      end: toReal(effect.end),
      ...(effect.keys && { keys: effect.keys.map((key) => ({ ...key, time: toReal(key.time) })) }),
    }));
  }
  return entry;
}
export function normalizeTuning(raw: unknown): AnimationTuning {
  const tuning: AnimationTuning = {};
  for (const [classId, entries] of Object.entries((raw ?? {}) as Record<string, Record<string, AbilityAnimation>>)) {
    tuning[classId] = {};
    for (const [abilityId, entry] of Object.entries(entries)) tuning[classId][abilityId] = normalizeAbilityAnimation(entry);
  }
  return tuning;
}

// La compétence peut avoir un projectile : elle vise quelqu'un d'autre que son lanceur (un ennemi, un allié…).
export function canHaveProjectile(abilityId: string): boolean {
  const target = getAbility(abilityId)?.target;
  return target === "enemy" || target === "ally" || target === "otherAlly" || target === "deadAlly";
}

// Réaction de la cible à l'impact : la portion start → end (secondes dans l'animation) jouée à la vitesse rate.
export type TargetReaction = AbilityClip;

export interface ImpactVisual {
  reaction?: TargetReaction;
  effects: AnimationEffect[];
}

// Point du personnage où s'accroche un effet.
export type EffectAnchor = "hands" | "hand_r" | "hand_l" | "weapon" | "head" | "chest" | "feet";

// Effet joué de start à end (secondes réelles depuis le début du geste ou du moment), accroché à anchor, décalé de
// offset (droite, haut, avant, en mètres, dans le repère du personnage). Avec des points clés (keys, triés par
// temps), sa position va de l'un à l'autre à vitesse constante, chacun avec son accroche et son décalage ; avant le
// premier et après le dernier, elle reste sur celui-ci.
export interface AnimationEffect {
  // Effet à particules (par défaut), marque au sol ou objet 3D (recipe : nom de la marque ou de l'objet, voir
  // groundMarks.ts et objects3d.ts).
  type?: "ground" | "object" | "overlay" | "sound";
  recipe: string;
  start: number;
  end: number;
  anchor: EffectAnchor;
  offset: [number, number, number];
  keys?: EffectKey[];
  // Pendant un état : l'effet dure jusqu'à la fin de l'état (end ne compte plus).
  untilEnd?: boolean;
  // Sur une zone : l'effet prend le rayon de la zone.
  fitZone?: boolean;
  // Marque au sol ou objet 3D : couleur imposée (sinon, celle de la marque ou de l'objet), et taille (× la sienne).
  tint?: string;
  scale?: number;
  // Son : volume (1 : normal), vitesse de lecture (plus lente = plus grave ; un léger écart au hasard s'y ajoute).
  // Coupé à la fin de sa barre (par défaut), joué jusqu'au bout même après sa barre (full), ou en boucle jusqu'à la
  // fin de sa barre (loop).
  volume?: number;
  rate?: number;
  loop?: boolean;
  full?: boolean;
  // Son : instant du son où commence la lecture (secondes ; le début est sauté).
  skip?: number;
  // Marque, objet ou affichage 2D : couleur du camp de celui qui le porte (bleu dans le camp du joueur, rouge chez
  // l'adversaire), à la place de tint.
  teamColor?: boolean;
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

// Effets d'un réglage : les siens, sinon ceux prévus dans le code (la formation du trait pendant l'incantation).
export function effectsOf(entry: AbilityAnimation, abilityId: string): AnimationEffect[] {
  if (entry.effects) return entry.effects;
  const recipe = LEGACY_CHARGES[abilityId];
  if (!recipe) return [];
  return [{ recipe, start: 0, end: castTimeOf(abilityId), anchor: "hands", offset: [0, 0, 0] }];
}

// Durée d'incantation : instant (secondes depuis le début du geste) où le sort part.
export function castTimeOf(abilityId: string): number {
  return getAbility(abilityId)?.castTime ?? 0;
}

// Calage d'un sort incanté sans réglage enregistré, d'après son geste d'incantation déclaré dans le code : le moment
// fort de l'animation (gesture.release) tombe au départ du sort.
export function legacyCastGesture(set: CharacterAnimationSet, abilityId: string): AbilityAnimation | null {
  const gesture = set.castGestures?.[abilityId];
  const castTime = castTimeOf(abilityId);
  if (!gesture || castTime <= 0) return null;
  const rate = Math.min(LEGACY_MAX_RATE, Math.max(LEGACY_MIN_RATE, gesture.release / castTime));
  const start = Math.max(0, gesture.release - castTime * rate);
  return { clips: [{ animation: gesture.animation, start, end: gesture.release + LEGACY_FOLLOW_THROUGH, rate }] };
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
  if (castTime <= 0) return { clips: [{ animation, start: 0, end: length, rate: baseRate }] };
  // Incanté : l'animation couvre l'incantation, ralentie s'il le faut, et un peu après.
  const rate = Math.max(MIN_RATE, Math.min(baseRate, length / castTime));
  return { clips: [{ animation, start: 0, end: Math.min(length, castTime * rate + LEGACY_FOLLOW_THROUGH), rate }] };
}

// Garde un réglage dans ses limites : chaque animation dans sa longueur, à une vitesse permise ; les effets entre
// 0 et maxTime secondes.
export function clampAbilityAnimation(entry: AbilityAnimation, clipLength: (animation: string) => number, maxTime: number): AbilityAnimation {
  const clips = entry.clips.map((clip) => {
    const length = clipLength(clip.animation);
    const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, clip.rate));
    const start = Math.min(Math.max(0, clip.start), Math.max(0, length - MIN_CLIP));
    const end = Math.min(length, Math.max(clip.end, start + MIN_CLIP));
    return { animation: clip.animation, start, end, rate };
  });
  const clamped: AbilityAnimation = { clips };
  // Les moments de la cible ne dépendent pas du geste du lanceur.
  if (entry.projectile) clamped.projectile = entry.projectile;
  if (entry.impact) clamped.impact = entry.impact;
  if (entry.status) clamped.status = entry.status;
  if (entry.zone) clamped.zone = entry.zone;
  if (entry.effects) clamped.effects = clampMomentEffects(entry.effects, maxTime);
  return clamped;
}

// Portion minimale d'une animation (secondes dans l'animation).
const MIN_CLIP = 0.05;
// Durée minimale d'un effet (secondes).
const MIN_EFFECT = 0.02;
// La timeline du lanceur va jusqu'à tant de secondes après la fin des animations et de l'incantation (effets et sons
// qui les dépassent).
export const CASTER_AFTER = 3;

// Effets d'un moment (geste du lanceur, impact, état, zone) gardés entre 0 et length secondes ; leurs points clés
// restent dans l'effet.
export function clampMomentEffects(effects: AnimationEffect[], length: number): AnimationEffect[] {
  return effects.map((effect) => {
    const start = Math.min(Math.max(0, effect.start), length - MIN_EFFECT);
    const end = Math.min(length, Math.max(effect.end, start + MIN_EFFECT));
    const clamped: AnimationEffect = { ...effect, start, end };
    if (effect.keys) clamped.keys = effect.keys.map((key) => ({ ...key, time: Math.min(end, Math.max(start, key.time)) }));
    return clamped;
  });
}

// Réglage d'une compétence, quelle que soit la classe qui l'a (les identifiants de compétence sont uniques).
export function tuningOf(tuning: AnimationTuning, abilityId: string): AbilityAnimation | undefined {
  for (const entries of Object.values(tuning)) if (entries[abilityId]) return entries[abilityId];
  return undefined;
}

// Durée d'un moment de la cible : jusqu'à la fin de son dernier effet (et de la réaction, pour l'impact).
export function momentLength(effects: readonly AnimationEffect[] | undefined, reaction?: TargetReaction): number {
  let length = reaction ? clipDuration(reaction) : 0;
  for (const effect of effects ?? []) length = Math.max(length, effect.end);
  return length;
}

// États (EffectKind) que laisse une compétence sur ses cibles, pour reconnaître ceux qu'elle a posés.
export function statusKindsOf(abilityId: string): string[] {
  const kinds: string[] = [];
  for (const effect of getAbility(abilityId)?.effects ?? []) {
    if (effect.type === "cc") kinds.push(effect.cc);
    else if (effect.type === "snare") kinds.push("snare");
    else if (effect.type === "dot") kinds.push(effect.effect ?? "burning");
    else if (effect.type === "silence") kinds.push("silenced");
    else if (effect.type === "debuff") kinds.push(effect.debuff);
    else if (effect.type === "hot") kinds.push("renew");
    else if (effect.type === "nearSight") kinds.push("nearSight");
    else if (effect.type === "buff") kinds.push(effect.buff);
    else if (effect.type === "status") kinds.push(effect.status);
    else if (effect.type === "intercept") kinds.push("intercept");
    else if (effect.type === "taunt") kinds.push("taunted");
    else if (effect.type === "rallyCry") kinds.push("magicImmune");
    else if (effect.type === "rampart") kinds.push("rampart");
    else if (effect.type === "charge") kinds.push("stun");
    else if (effect.type === "guard") kinds.push("guarded");
  }
  return kinds;
}

// Durée de l'état le plus long laissé par une compétence (secondes ; Infinity pour un buff permanent, 0 sans état).
export function statusDurationOf(abilityId: string): number {
  let longest = 0;
  for (const effect of getAbility(abilityId)?.effects ?? []) {
    if (effect.type === "buff") longest = Infinity;
    else if (effect.type === "charge") longest = Math.max(longest, effect.stun);
    else if ("duration" in effect) longest = Math.max(longest, effect.duration);
  }
  return longest;
}

// Une zone d'effet est centrée sur la cible d'un sort offensif à cible unique, sinon sur le lanceur (comme sur le
// serveur, CombatSystem.areaCenter).
export function zoneCenterIsTarget(abilityId: string): boolean {
  return getAbility(abilityId)?.target === "enemy";
}

// La compétence agit sur son lanceur (buff personnel) : il est sa propre cible.
export function targetsSelf(abilityId: string): boolean {
  return getAbility(abilityId)?.target === "self" && !getAbility(abilityId)?.radius;
}
