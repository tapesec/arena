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
  | { type: "status"; status: "evasion" | "rage" | "concentration" | "bubble"; duration: number }
  | { type: "guard" }
  | { type: "intercept"; duration: number }
  | { type: "toggleSong" };

export interface AbilityDef {
  id: string;
  name: string;
  // Texte de l'infobulle de la barre d'action.
  description: string;
  // Temps d'incantation en secondes ; 0 = instantané.
  castTime: number;
  resource: ResourceType;
  cost: number;
  range: number;
  // Temps de recharge en secondes ; 0 = aucun.
  cooldown: number;
  target: AbilityTarget;
  // Technique de mêlée (comme les styles de DAoC) : elle part au prochain coup d'arme, à la place du coup normal
  // (aussitôt si l'arme est prête). Peut être esquivée, bloquée, et profite du buff de force et des critiques.
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
    description: "50 % de chances de bloquer les attaques de mêlée visant l'allié protégé (à 4 m au plus). Relancer sur le même allié retire la protection.",
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
    description: "Encaisse à la place d'un allié le prochain coup qui le vise (10 s, à 4 m au plus).",
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
    description: "Étourdit la cible 4 s. Technique de mêlée : part au prochain coup d'arme.",
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
    description: "Projectile de feu : 250 dégâts.",
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
    description: "Explosion autour de soi, sans cible : 350 dégâts au centre, jusqu'à 100 au bord, sur les ennemis à 5 m.",
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
    description: "Enracine la cible 10 s : elle repart lentement, puis à pleine vitesse. Les dégâts la libèrent.",
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
    description: "Le prochain sort ne peut pas être interrompu.",
    castTime: 0,
    resource: "mana",
    cost: 0,
    range: 0,
    cooldown: 180,
    target: "self",
    effects: [{ type: "status", status: "concentration", duration: INFINITE }],
  },
  // Bulle (comme le bladeturn de DAoC), sur l'Arcaniste seulement : absorbe entièrement le prochain coup de mêlée,
  // puis disparaît.
  {
    id: "bubble",
    name: "Bulle",
    description: "Sur soi : absorbe entièrement le prochain coup de mêlée, effets compris, puis disparaît. Ne protège pas des sorts.",
    castTime: 2,
    resource: "mana",
    cost: 80,
    range: 0,
    cooldown: 10,
    target: "self",
    effects: [{ type: "status", status: "bubble", duration: INFINITE }],
  },
  // --- Prêtre ---
  {
    id: "heal",
    name: "Soin",
    description: "Rend 300 points de vie à un allié (à soi, sans allié ciblé).",
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
    description: "Rend 200 points de vie aux alliés à 20 m.",
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
    description: "Rend aussitôt 200 points de vie à un allié.",
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
    description: "Retire le mez d'un allié (pas le stun).",
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
    description: "+200 points de vie maximum, jusqu'à la mort du Prêtre ou de la cible.",
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
    description: "+15 % de dégâts de mêlée, jusqu'à la mort du Prêtre ou de la cible.",
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
    description: "Relève un allié mort à 50 % de vie, sans aucun buff.",
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
    description: "Endort 20 s les ennemis à 6 m de la cible. Les dégâts les réveillent.",
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
    description: "Endort la cible 20 s. Les dégâts la réveillent.",
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
    description: "Enracine 12 s les ennemis à 6 m de la cible. Les dégâts les libèrent.",
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
    description: "Interrompt l'incantation en cours de la cible.",
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
    description: "Active ou coupe le chant : +40 % de vitesse aux alliés à 30 m. Se tait 5 s quand le Barde attaque ou est attaqué.",
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
    description: "270 dégâts, à la place du coup normal. Dans le dos de la cible. Technique de mêlée : part au prochain coup d'arme.",
    castTime: 0,
    resource: "endurance",
    cost: 25,
    range: MELEE_RANGE,
    cooldown: 0,
    target: "enemy",
    melee: true,
    position: "back",
    effects: [{ type: "damage", amount: 270 }],
  },
  {
    id: "flankStrike",
    name: "Attaque de flanc",
    description: "190 dégâts, à la place du coup normal, et ralentit de 40 % pendant 8 s. Sur le flanc de la cible. Technique de mêlée : part au prochain coup d'arme.",
    castTime: 0,
    resource: "endurance",
    cost: 20,
    range: MELEE_RANGE,
    cooldown: 0,
    target: "enemy",
    melee: true,
    position: "side",
    effects: [
      { type: "damage", amount: 190 },
      { type: "snare", slow: 0.4, duration: 8 },
    ],
  },
  {
    id: "evasion",
    name: "Évasion",
    description: "75 % de chances d'esquiver les attaques de mêlée pendant 8 s.",
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
    description: "Tous les coups sont critiques pendant 10 s.",
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
