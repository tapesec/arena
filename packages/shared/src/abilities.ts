import { MELEE_RANGE, SPELL_RANGE } from "./combat";

export type ResourceType = "mana" | "endurance";

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
  effect: { kind: "damage" | "heal"; amount: number };
  // "enemy" : nécessite une cible ; "self" : s'applique au lanceur.
  target: "enemy" | "self";
}

// Compétences provisoires pour tester le système, en attendant les classes (étape 4).
export const ABILITIES: Record<string, AbilityDef> = {
  firebolt: {
    id: "firebolt",
    name: "Trait de feu",
    castTime: 2.5,
    resource: "mana",
    cost: 80,
    range: SPELL_RANGE,
    cooldown: 0,
    effect: { kind: "damage", amount: 250 },
    target: "enemy",
  },
  strike: {
    id: "strike",
    name: "Frappe",
    castTime: 0,
    resource: "endurance",
    cost: 25,
    range: MELEE_RANGE,
    cooldown: 4,
    effect: { kind: "damage", amount: 120 },
    target: "enemy",
  },
  heal: {
    id: "heal",
    name: "Soin",
    castTime: 2,
    resource: "mana",
    cost: 80,
    range: SPELL_RANGE,
    cooldown: 0,
    effect: { kind: "heal", amount: 300 },
    target: "self",
  },
};

export function getAbility(id: string): AbilityDef | undefined {
  return Object.hasOwn(ABILITIES, id) ? ABILITIES[id] : undefined;
}
