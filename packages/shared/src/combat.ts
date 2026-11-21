import type { Position } from "./movement";

export type ResourceType = "mana" | "endurance";

// Taille des réserves de ressource (la classe détermine laquelle elle utilise).
export const MAX_MANA = 1000;
export const MAX_ENDURANCE = 100;

// Régénération de base par seconde : le tiers de celle sous Chant de second souffle (base + bonus du chant), pour
// qu'un joueur sans Barde ne reste pas à sec (décidé le 2026-11-19 ; avant : 5 mana et 2 endurance).
export const MANA_REGEN = 25;
export const ENDURANCE_REGEN = 2.5;

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
export const GUARD_BLOCK_CHANCE = 0.75;
export const SHIELD_BLOCK_CHANCE = 0.3;
export const INTERCEPT_RANGE = 4;
// Charge : vitesse de course (+500 %) et durée maximale avant d'abandonner (cible hors d'atteinte, obstacle).
export const CHARGE_SPEED_MULTIPLIER = 6;
export const CHARGE_MAX_DURATION = 3;
// Provocation : dégâts infligés par la cible à tout autre que le Gardien, et arrêt net au moment de la provocation.
export const TAUNT_DAMAGE_FACTOR = 0.5;
export const TAUNT_HALT_DURATION = 0.5;

// Ralentissement de tous les snares.
export const SNARE_SLOW = 0.4;

// Arcaniste : portée des sorts restante sous Near sight (réduite de 75 %), intervalle entre deux tics d'un dot.
export const NEAR_SIGHT_FACTOR = 0.25;
export const DOT_INTERVAL = 1;

// Prêtre
export const HP_BUFF_AMOUNT = 200;
// Buff de puissance : +15 % de dégâts (mêlée et sorts, tics compris) et de soins.
export const STRENGTH_BUFF_BONUS = 0.15;
// Soin sur la durée (Renouveau) : un tic de soin toutes les HOT_INTERVAL secondes.
export const HOT_INTERVAL = 1;

// Barde : portée des chants, vitesse du Chant de vitesse (et de la Ballade rythmée), régénération en plus sous le
// Chant de second souffle, durées multipliées par le Buff dextérité (intervalle d'attaque, incantation).
export const SONG_RANGE = 30;
export const SONG_SPEED_MULTIPLIER = 2;
// Chant de vitesse : un bénéficiaire touché (attaque ou effet hostile, même évité) ou qui agit (hors déplacement et
// chants) le perd, et ne le retrouve qu'après ce temps sans être touché ni agir (secondes).
export const SONG_SPEED_CALM = 5;
export const BALLAD_SPEED_MULTIPLIER = 2;
export const SECOND_WIND_MANA_REGEN = 50;
export const SECOND_WIND_ENDURANCE_REGEN = 5;
export const DEXTERITY_FACTOR = 0.85;
// Sprint de la Lame : vitesse doublée (ne se cumule pas avec le chant ni la Ballade du Barde : le plus fort compte).
export const SPRINT_SPEED_MULTIPLIER = 2;
// Gangrène : soins reçus multipliés par ce facteur.
export const GANGRENE_HEAL_FACTOR = 0.5;
// Brise armure : dégâts de mêlée reçus augmentés de ce bonus.
export const ARMOR_BREAK_BONUS = 0.25;

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

// Événement diffusé à tous les clients pour les textes flottants, les sons et les effets.
// abilityId vaut "auto" pour l'attaque automatique.
export type CombatEventKind =
  | "damage"
  | "heal"
  | "blocked" // bloqué par le bouclier ou par la garde d'un Gardien (detail = id du bloqueur)
  | "evaded"
  | "absorbed" // absorbé par la bulle de l'Arcaniste
  | "intercepted" // un Gardien prend le coup à la place de sa cible (detail = id de la cible d'origine)
  | "cc" // contrôle appliqué (detail = type)
  | "immune" // cible immunisée (detail = type de contrôle, "magic" ou "melee")
  | "taunt" // provocation d'un Gardien
  | "cleanse"
  | "resurrect"
  | "buff" // detail = type de buff
  | "debuff" // effet néfaste qui n'est pas un contrôle (detail = type, ex. "nearSight")
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
  // Tic d'un dégât sur la durée (Brûlure, poison) : pas un coup.
  dot?: boolean;
  detail?: string;
}

// Élimination, annoncée à tous les joueurs quel que soit le brouillard de guerre (annonce au centre de l'écran et
// fil des éliminations, décidés le 2026-11-21). abilityId : la compétence qui a achevé ("auto" pour l'attaque
// automatique).
export interface KillEvent {
  victimName: string;
  victimTeam: number;
  killerName: string;
  killerTeam: number;
  abilityId: string;
  // Pseudo du seul survivant de l'équipe de la victime, s'il n'en reste qu'un (bandeau « Dernier survivant »).
  lastStanding?: string;
}

export type InterruptReason = "damage" | "move" | "silence" | "cc" | "taunt";

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
