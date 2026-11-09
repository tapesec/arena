import type { Position } from "./movement";

export type ResourceType = "mana" | "endurance";

// Taille des réserves de ressource (la classe détermine laquelle elle utilise).
export const MAX_MANA = 1000;
export const MAX_ENDURANCE = 100;

// Régénération de base par seconde.
export const MANA_REGEN = 5;
export const ENDURANCE_REGEN = 2;

// Distance maximale entre les centres de deux personnages pour frapper au corps à corps.
export const MELEE_RANGE = 3;
// Distance à laquelle le stick (touche C) suit sa cible : bien à portée de mêlée.
export const STICK_DISTANCE = 2;

export const SPELL_RANGE = 30;

// Portée maximale de sélection d'une cible avec Tab.
export const TAB_TARGET_RANGE = 40;

// --- Règles de combat (valeurs du GDD, provisoires) ---

// Répit après la fin normale d'un contrôle (mez, stun, root) : l'immunité démarre dès l'application
// et dure le temps du contrôle plus cette valeur.
export const IMMUNITY_DURATION = 30;

// Gardien
export const GUARD_RANGE = 4;
export const GUARD_BLOCK_CHANCE = 0.5;
export const SHIELD_BLOCK_CHANCE = 0.3;
export const INTERCEPT_RANGE = 4;

// Arcaniste : délai de reformation de la bulle.

// Prêtre
export const HP_BUFF_AMOUNT = 200;
export const STRENGTH_BUFF_BONUS = 0.15;
export const AURA_RANGE = 30;
export const AURA_MANA_REGEN = 5;
export const AURA_ENDURANCE_REGEN = 2;

// Barde
export const SONG_RANGE = 30;
export const SONG_SPEED_MULTIPLIER = 1.4;
export const SONG_SUPPRESS_DURATION = 5;

// Lame
export const EVASION_CHANCE = 0.75;

// Coups critiques de mêlée.
export const CRIT_CHANCE = 0.1;
export const CRIT_MULTIPLIER = 1.5;

export function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function isInMeleeRange(a: Position, b: Position): boolean {
  return distance(a, b) <= MELEE_RANGE;
}

// Demi-angle du cône de vision devant le personnage : 90° donne un cône de 180°.
export const FACING_HALF_ANGLE = Math.PI / 2;

// Orientation vers une position, dans la même convention que le champ "facing" du serveur.
export function facingTowards(from: Position, to: Position): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

// Angle (en radians, entre 0 et π) entre le regard de l'observateur et la direction de la cible.
function angleToTarget(observer: Position & { facing: number }, target: Position): number {
  const dx = target.x - observer.x;
  const dz = target.z - observer.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return 0;
  const dot = (Math.sin(observer.facing) * dx + Math.cos(observer.facing) * dz) / length;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

// Vrai si la cible se trouve dans le cône de vision de l'observateur.
export function isFacing(observer: Position & { facing: number }, target: Position): boolean {
  return angleToTarget(observer, target) <= FACING_HALF_ANGLE + 1e-6;
}

export type RelativePosition = "front" | "side" | "back";

// Où se trouve l'attaquant par rapport à la cible : devant (±60°), de côté, ou dans le dos (±60° arrière).
export function positionRelativeTo(target: Position & { facing: number }, attacker: Position): RelativePosition {
  const angle = angleToTarget(target, attacker);
  if (angle < Math.PI / 3) return "front";
  if (angle > (2 * Math.PI) / 3) return "back";
  return "side";
}

// Événement diffusé à tous les clients pour le journal de combat.
// abilityId vaut "auto" pour l'attaque automatique.
export type CombatEventKind =
  | "damage"
  | "heal"
  | "blocked" // bloqué par le bouclier ou par la garde d'un Gardien (detail = id du bloqueur)
  | "evaded"
  | "absorbed" // absorbé par la bulle de l'Arcaniste
  | "intercepted" // un Gardien prend le coup à la place de sa cible (detail = id de la cible d'origine)
  | "cc" // contrôle appliqué (detail = type)
  | "immune" // cible immunisée (detail = type)
  | "cleanse"
  | "resurrect"
  | "buff" // detail = type de buff
  | "guard"
  | "unguard";

export interface CombatEvent {
  kind: CombatEventKind;
  sourceId: string;
  targetId: string;
  abilityId: string;
  amount?: number;
  crit?: boolean;
  killed?: boolean;
  detail?: string;
}

export type InterruptReason = "damage" | "move" | "silence" | "cc";

export interface InterruptEvent {
  casterId: string;
  abilityId: string;
  reason: InterruptReason;
}

// Diffusé quand une compétence est utilisée (fin d'incantation ou compétence instantanée),
// pour que les clients puissent afficher son effet visuel.
export interface AbilityUsedEvent {
  casterId: string;
  abilityId: string;
  targetId: string;
}

// Envoyé uniquement au joueur concerné quand une compétence entre en recharge.
export interface CooldownEvent {
  abilityId: string;
  duration: number;
}

// Envoyé uniquement au joueur concerné : secondes avant que son arme puisse frapper de nouveau.
// Envoyé à chaque coup d'arme et quand il active l'attaque automatique, pour la jauge de coup de la barre d'action.
export interface SwingEvent {
  remaining: number;
  // Vrai si l'arme vient de frapper (faux quand l'attaque vient d'être activée).
  struck: boolean;
}
