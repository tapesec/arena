import { MAX_ENDURANCE, MAX_MANA, type ResourceType } from "./combat";

export type ClassId = "gardien" | "arcaniste" | "pretre" | "barde" | "lame";

export type Passive = "shieldBlock";

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  // Une phrase pour présenter la classe à un nouveau joueur (écran de choix ; reprise du GDD).
  summary: string;
  maxHp: number;
  resource: ResourceType;
  // Attaque automatique de mêlée (valeurs provisoires, non fixées par le GDD).
  autoAttack: { damage: number; interval: number };
  // Compétences dans l'ordre de la barre (touches 1, 2, 3…), sur deux rangées de 4 (décidé le 2026-11-19) : 1 à 4, ce
  // qu'on enchaîne pour attaquer ou soigner, dans l'ordre d'usage (combos côte à côte) ; 5 à 7, contrôle, défense et
  // soutien ; 8, l'ultime.
  abilities: string[];
  // Compétences « à débloquer » déjà programmées, pas encore dans la barre (la progression viendra plus tard).
  unlockable?: string[];
  passives: Passive[];
}

// L'ordre compte : c'est celui de l'écran de choix (de gauche à droite), et la première classe est celle qu'un joueur
// a d'office en arrivant (voir ArenaRoom.onJoin).
const list: ClassDef[] = [
  {
    id: "gardien",
    name: "Gardien",
    role: "Tank",
    summary: "Protège les alliés vulnérables et tient la ligne de front.",
    maxHp: 1600,
    resource: "endurance",
    autoAttack: { damage: 55, interval: 2 },
    abilities: ["powerStrike", "shieldBash", "cripplingStrike", "charge", "guard", "taunt", "rallyCry", "rampart"],
    // Interception : retirée de la barre (8 compétences par classe), gardée pour plus tard.
    unlockable: ["intercept"],
    passives: ["shieldBlock"],
  },
  {
    id: "arcaniste",
    name: "Arcaniste",
    role: "Dégâts magiques",
    summary: "Gros dégâts à distance, à condition d'être protégé.",
    maxHp: 900,
    resource: "mana",
    autoAttack: { damage: 30, interval: 2.5 },
    abilities: ["firebolt", "burn", "frostbolt", "blast", "frostNova", "nearSight", "concentration", "arcanePower"],
    unlockable: ["freeze", "bubble"],
    passives: [],
  },
  {
    id: "pretre",
    name: "Prêtre",
    role: "Healer",
    summary: "Garde le groupe en vie, relève les morts et le renforce.",
    maxHp: 1100,
    resource: "mana",
    autoAttack: { damage: 30, interval: 2.5 },
    abilities: ["heal", "renew", "instantHeal", "groupHeal", "buffHp", "buffStrength", "resurrect", "divineIntervention"],
    passives: [],
  },
  {
    id: "barde",
    name: "Barde",
    role: "Contrôle de foule",
    summary: "Neutralise le groupe adverse et contrôle le rythme du combat.",
    maxHp: 1000,
    resource: "mana",
    autoAttack: { damage: 30, interval: 2.5 },
    abilities: ["mez", "aoeMez", "silence", "awaken", "speedSong", "secondWind", "buffDexterity", "ballad"],
    passives: [],
  },
  {
    id: "lame",
    name: "Lame",
    role: "Dégâts mêlée",
    summary: "Traque et élimine les cibles fragiles, en priorité les casters.",
    maxHp: 1300,
    resource: "endurance",
    autoAttack: { damage: 70, interval: 2 },
    abilities: ["backstab", "poisonBlade", "gangrene", "flankStrike", "kick", "evasion", "sprint", "rage"],
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
