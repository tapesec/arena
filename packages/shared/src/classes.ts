import { MAX_ENDURANCE, MAX_MANA, type ResourceType } from "./combat";

export type ClassId = "gardien" | "arcaniste" | "pretre" | "barde" | "lame";

export type Passive = "shieldBlock";

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  maxHp: number;
  resource: ResourceType;
  // Attaque automatique de mêlée (valeurs provisoires, non fixées par le GDD).
  autoAttack: { damage: number; interval: number };
  // Compétences dans l'ordre de la barre (touches 1, 2, 3…).
  abilities: string[];
  // Compétences « à débloquer » déjà programmées, pas encore dans la barre (la progression viendra plus tard).
  unlockable?: string[];
  passives: Passive[];
}

const list: ClassDef[] = [
  {
    id: "gardien",
    name: "Gardien",
    role: "Tank",
    maxHp: 1600,
    resource: "endurance",
    autoAttack: { damage: 55, interval: 2 },
    abilities: ["guard", "intercept", "shieldBash", "charge", "powerStrike", "taunt", "rallyCry", "cripplingStrike", "rampart"],
    passives: ["shieldBlock"],
  },
  {
    id: "arcaniste",
    name: "Arcaniste",
    role: "Dégâts magiques",
    maxHp: 900,
    resource: "mana",
    autoAttack: { damage: 30, interval: 2.5 },
    abilities: ["firebolt", "blast", "concentration", "frostbolt", "nearSight", "burn", "frostNova", "arcanePower"],
    unlockable: ["freeze", "bubble"],
    passives: [],
  },
  {
    id: "pretre",
    name: "Prêtre",
    role: "Healer",
    maxHp: 1100,
    resource: "mana",
    autoAttack: { damage: 30, interval: 2.5 },
    abilities: ["heal", "instantHeal", "resurrect", "groupHeal", "buffHp", "buffStrength", "renew", "divineIntervention"],
    passives: [],
  },
  {
    id: "barde",
    name: "Barde",
    role: "Contrôle de foule",
    maxHp: 1000,
    resource: "mana",
    autoAttack: { damage: 30, interval: 2.5 },
    abilities: ["mez", "awaken", "aoeMez", "silence", "speedSong", "secondWind", "buffDexterity", "ballad"],
    passives: [],
  },
  {
    id: "lame",
    name: "Lame",
    role: "Dégâts mêlée",
    maxHp: 1300,
    resource: "endurance",
    autoAttack: { damage: 70, interval: 2 },
    abilities: ["backstab", "flankStrike", "evasion", "kick", "sprint", "poisonBlade", "gangrene", "rage"],
    unlockable: ["armorBreak"],
    passives: [],
  },
];

export const CLASSES: Record<ClassId, ClassDef> = Object.fromEntries(list.map((c) => [c.id, c])) as Record<
  ClassId,
  ClassDef
>;

export const CLASS_LIST = list;

export function getClass(id: string): ClassDef | undefined {
  return Object.hasOwn(CLASSES, id) ? CLASSES[id as ClassId] : undefined;
}

export function maxResource(resource: ResourceType): number {
  return resource === "mana" ? MAX_MANA : MAX_ENDURANCE;
}
