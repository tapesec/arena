import { MELEE_RANGE, SPELL_RANGE, type ResourceType } from "./combat";

// À qui s'applique la compétence :
// - enemy : la cible actuelle, qui doit être un ennemi vivant
// - ally : la cible actuelle si c'est un allié vivant, sinon soi-même
// - otherAlly : la cible actuelle, qui doit être un autre allié vivant
// - deadAlly : la cible actuelle, qui doit être un allié mort
// - self : le lanceur
// - enemiesAround : les ennemis autour du lanceur, sans cible ni ligne de vue (zone d'effet centrée sur soi)
export type AbilityTarget = "enemy" | "ally" | "otherAlly" | "deadAlly" | "self" | "enemiesAround";

export type CrowdControl = "mez" | "stun" | "root";

export type AbilityEffect =
  // edgeAmount : dégâts en bordure d'une zone d'effet, qui décroissent depuis amount au centre.
  | { type: "damage"; amount: number; edgeAmount?: number }
  | { type: "heal"; amount: number }
  | { type: "cc"; cc: CrowdControl; duration: number }
  | { type: "snare"; slow: number; duration: number }
  | { type: "interrupt" }
  | { type: "cleanse" }
  | { type: "resurrect"; hpRatio: number }
  | { type: "buff"; buff: "buffHp" | "buffStrength" }
  | { type: "status"; status: "evasion" | "rage" | "concentration"; duration: number }
  | { type: "guard" }
  | { type: "intercept"; duration: number }
  | { type: "toggleSong" };

export interface AbilityDef {
  id: string;
  name: string;
  // Temps d'incantation en secondes ; 0 = instantané.
  castTime: number;
  resource: ResourceType;
  cost: number;
  range: number;
  // Temps de recharge en secondes ; 0 = aucun.
  cooldown: number;
  target: AbilityTarget;
  // Attaque de mêlée : peut être esquivée, bloquée, et profite du buff de force et des critiques.
  melee?: boolean;
  // Position exigée par rapport à la cible.
  position?: "back" | "side";
  // Zone d'effet : autour de la cible pour une compétence visant un ennemi, autour du lanceur sinon.
  radius?: number;
  effects: AbilityEffect[];
}

const INFINITE = Number.POSITIVE_INFINITY;

const list: AbilityDef[] = [
  // --- Gardien ---
  {
    id: "guard",
    name: "Garde",
    castTime: 0,
    resource: "endurance",
    cost: 0,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "otherAlly",
    effects: [{ type: "guard" }],
  },
  {
    id: "intercept",
    name: "Interception",
    castTime: 0,
    resource: "endurance",
    cost: 15,
    range: SPELL_RANGE,
    cooldown: 20,
    target: "otherAlly",
    effects: [{ type: "intercept", duration: 10 }],
  },
  {
    id: "shieldBash",
    name: "Coup de bouclier",
    castTime: 0,
    resource: "endurance",
    cost: 40,
    range: MELEE_RANGE,
    cooldown: 0,
    target: "enemy",
    melee: true,
    effects: [{ type: "cc", cc: "stun", duration: 4 }],
  },
  // --- Arcaniste ---
  {
    id: "firebolt",
    name: "Trait de feu",
    castTime: 2.5,
    resource: "mana",
    cost: 80,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    effects: [{ type: "damage", amount: 250 }],
  },
  {
    id: "blast",
    name: "Déflagration",
    castTime: 2.5,
    resource: "mana",
    cost: 150,
    range: 0,
    cooldown: 0,
    target: "enemiesAround",
    radius: 5,
    effects: [{ type: "damage", amount: 350, edgeAmount: 100 }],
  },
  {
    id: "freeze",
    name: "Gel",
    castTime: 1.5,
    resource: "mana",
    cost: 60,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    effects: [{ type: "cc", cc: "root", duration: 10 }],
  },
  {
    id: "concentration",
    name: "Concentration",
    castTime: 0,
    resource: "mana",
    cost: 0,
    range: 0,
    cooldown: 180,
    target: "self",
    effects: [{ type: "status", status: "concentration", duration: INFINITE }],
  },
  // --- Prêtre ---
  {
    id: "heal",
    name: "Soin",
    castTime: 2,
    resource: "mana",
    cost: 80,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "ally",
    effects: [{ type: "heal", amount: 300 }],
  },
  {
    id: "groupHeal",
    name: "Soin de groupe",
    castTime: 3,
    resource: "mana",
    cost: 200,
    range: 0,
    cooldown: 0,
    target: "self",
    radius: 20,
    effects: [{ type: "heal", amount: 200 }],
  },
  {
    id: "instantHeal",
    name: "Soin instantané",
    castTime: 0,
    resource: "mana",
    cost: 60,
    range: SPELL_RANGE,
    cooldown: 180,
    target: "ally",
    effects: [{ type: "heal", amount: 200 }],
  },
  {
    id: "purify",
    name: "Purification",
    castTime: 0,
    resource: "mana",
    cost: 30,
    range: SPELL_RANGE,
    cooldown: 5,
    target: "otherAlly",
    effects: [{ type: "cleanse" }],
  },
  {
    id: "buffHp",
    name: "Buff de vie",
    castTime: 2,
    resource: "mana",
    cost: 100,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "ally",
    effects: [{ type: "buff", buff: "buffHp" }],
  },
  {
    id: "buffStrength",
    name: "Buff de force",
    castTime: 2,
    resource: "mana",
    cost: 100,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "ally",
    effects: [{ type: "buff", buff: "buffStrength" }],
  },
  {
    id: "resurrect",
    name: "Résurrection",
    castTime: 4,
    resource: "mana",
    cost: 400,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "deadAlly",
    effects: [{ type: "resurrect", hpRatio: 0.5 }],
  },
  // --- Barde ---
  {
    id: "aoeMez",
    name: "Mez de zone",
    castTime: 3,
    resource: "mana",
    cost: 200,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    radius: 6,
    effects: [{ type: "cc", cc: "mez", duration: 20 }],
  },
  {
    id: "mez",
    name: "Mez ciblé",
    castTime: 2,
    resource: "mana",
    cost: 100,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    effects: [{ type: "cc", cc: "mez", duration: 20 }],
  },
  {
    id: "aoeRoot",
    name: "Root de zone",
    castTime: 2.5,
    resource: "mana",
    cost: 120,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    radius: 6,
    effects: [{ type: "cc", cc: "root", duration: 12 }],
  },
  {
    id: "silence",
    name: "Silence",
    castTime: 1,
    resource: "mana",
    cost: 40,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    effects: [{ type: "interrupt" }],
  },
  {
    id: "speedSong",
    name: "Chant de vitesse",
    castTime: 0,
    resource: "mana",
    cost: 0,
    range: 0,
    cooldown: 0,
    target: "self",
    effects: [{ type: "toggleSong" }],
  },
  // --- Lame ---
  {
    id: "backstab",
    name: "Attaque dans le dos",
    castTime: 0,
    resource: "endurance",
    cost: 25,
    range: MELEE_RANGE,
    cooldown: 0,
    target: "enemy",
    melee: true,
    position: "back",
    effects: [{ type: "damage", amount: 200 }],
  },
  {
    id: "flankStrike",
    name: "Attaque de flanc",
    castTime: 0,
    resource: "endurance",
    cost: 20,
    range: MELEE_RANGE,
    cooldown: 0,
    target: "enemy",
    melee: true,
    position: "side",
    effects: [
      { type: "damage", amount: 120 },
      { type: "snare", slow: 0.4, duration: 8 },
    ],
  },
  {
    id: "evasion",
    name: "Évasion",
    castTime: 0,
    resource: "endurance",
    cost: 20,
    range: 0,
    cooldown: 60,
    target: "self",
    effects: [{ type: "status", status: "evasion", duration: 8 }],
  },
  {
    id: "rage",
    name: "Rage",
    castTime: 0,
    resource: "endurance",
    cost: 0,
    range: 0,
    cooldown: 180,
    target: "self",
    effects: [{ type: "status", status: "rage", duration: 10 }],
  },
];

export const ABILITIES: Record<string, AbilityDef> = Object.fromEntries(list.map((a) => [a.id, a]));

export function getAbility(id: string): AbilityDef | undefined {
  return Object.hasOwn(ABILITIES, id) ? ABILITIES[id] : undefined;
}

// Compétence dirigée contre un ennemi : soumise au cône de vision, interrompt le chant du Barde.
export function isOffensive(ability: AbilityDef): boolean {
  return ability.target === "enemy" || ability.target === "enemiesAround";
}
