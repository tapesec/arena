import type { Position } from "./movement";

// Valeurs communes à tous les personnages en attendant les classes (étape 4).
export const MAX_HP = 1000;
export const MAX_MANA = 1000;
export const MAX_ENDURANCE = 100;

// Régénération par seconde.
export const MANA_REGEN = 5;
export const ENDURANCE_REGEN = 2;

// Distance maximale entre les centres de deux personnages pour frapper au corps à corps.
export const MELEE_RANGE = 3;

export const SPELL_RANGE = 30;

export const AUTO_ATTACK_DAMAGE = 60;

// Temps entre deux coups d'attaque automatique, en secondes.
export const AUTO_ATTACK_INTERVAL = 2;

// Portée maximale de sélection d'une cible avec Tab.
export const TAB_TARGET_RANGE = 40;

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

// Vrai si la cible se trouve dans le cône de vision de l'observateur.
export function isFacing(observer: Position & { facing: number }, target: Position): boolean {
  const dx = target.x - observer.x;
  const dz = target.z - observer.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return true;
  // Produit scalaire entre la direction du regard et la direction de la cible.
  const dot = (Math.sin(observer.facing) * dx + Math.cos(observer.facing) * dz) / length;
  return dot >= Math.cos(FACING_HALF_ANGLE) - 1e-6;
}

// Événement diffusé à tous les clients à chaque dégât ou soin.
// abilityId vaut "auto" pour l'attaque automatique.
export interface CombatEvent {
  sourceId: string;
  targetId: string;
  abilityId: string;
  kind: "damage" | "heal";
  amount: number;
  killed: boolean;
}

export type InterruptReason = "damage" | "move";

export interface InterruptEvent {
  casterId: string;
  abilityId: string;
  reason: InterruptReason;
}

// Envoyé uniquement au joueur concerné quand une compétence entre en recharge.
export interface CooldownEvent {
  abilityId: string;
  duration: number;
}
