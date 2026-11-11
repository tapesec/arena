import { MELEE_RANGE, NEAR_SIGHT_FACTOR, SNARE_SLOW, SPELL_RANGE, type ResourceType } from "./combat";

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
  // Dégâts sur la durée (dot) : amount au total, en tics d'une seconde pendant duration.
  | { type: "dot"; amount: number; duration: number }
  | { type: "heal"; amount: number }
  // Soin réparti entre les personnes touchées au prorata des points de vie qui leur manquent (le surplus est perdu).
  | { type: "splitHeal"; amount: number }
  // Soin sur la durée : amount au total, en tics d'une seconde pendant duration. Relancé par le même lanceur, il
  // repart de zéro ; ceux de lanceurs différents se cumulent.
  | { type: "hot"; amount: number; duration: number }
  | { type: "cc"; cc: CrowdControl; duration: number }
  | { type: "snare"; slow: number; duration: number }
  | { type: "interrupt" }
  | { type: "cleanse" }
  | { type: "resurrect"; hpRatio: number }
  | { type: "buff"; buff: "buffHp" | "buffStrength" }
  | { type: "status"; status: "evasion" | "rage" | "concentration" | "bubble" | "arcanePower"; duration: number }
  // Vision réduite : portée des sorts de la cible réduite (voir NEAR_SIGHT_FACTOR).
  | { type: "nearSight"; duration: number }
  | { type: "guard" }
  | { type: "intercept"; duration: number }
  | { type: "toggleSong" }
  // Le lanceur fonce sur la cible ; à l'arrivée, dégâts et stun, sans esquive ni blocage possibles.
  | { type: "charge"; damage: number; stun: number }
  | { type: "taunt"; duration: number }
  // Immunité aux contrôles magiques (et retrait de ceux déjà en place).
  | { type: "rallyCry"; duration: number }
  | { type: "rampart"; duration: number };

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
  // Distance minimale à la cible (Charge).
  minRange?: number;
  // Temps de recharge en secondes ; 0 = aucun.
  cooldown: number;
  target: AbilityTarget;
  // Technique de mêlée (comme les styles de DAoC) : elle part au prochain coup d'arme, à la place du coup normal
  // (aussitôt si l'arme est prête). Peut être esquivée, bloquée, et profite du buff de force et des critiques.
  melee?: boolean;
  // Position exigée par rapport à la cible.
  position?: "back" | "side";
  // Type des dégâts magiques (feu, givre) : pour l'affichage seulement, il n'y a pas encore de résistances.
  school?: "fire" | "frost";
  // Zone d'effet : autour de la cible pour une compétence visant un ennemi, autour du lanceur sinon. Une compétence
  // qui ressuscite touche les alliés morts de la zone.
  radius?: number;
  effects: AbilityEffect[];
}

const INFINITE = Number.POSITIVE_INFINITY;

const list: AbilityDef[] = [
  // --- Gardien ---
  {
    id: "guard",
    name: "Garde",
    description:
      "75 % de chances de bloquer les attaques de mêlée visant l'allié protégé (à 4 m au plus), quand l'allié et le Gardien sont immobiles. Relancer sur le même allié retire la protection.",
    castTime: 0,
    resource: "endurance",
    cost: 15,
    range: 10,
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
    cost: 25,
    range: 20,
    cooldown: 10,
    target: "otherAlly",
    effects: [{ type: "intercept", duration: 10 }],
  },
  {
    id: "shieldBash",
    name: "Coup de bouclier",
    description: "Stun 2 s. Technique de mêlée : part au prochain coup d'arme.",
    castTime: 0,
    resource: "endurance",
    cost: 40,
    range: MELEE_RANGE,
    cooldown: 10,
    target: "enemy",
    melee: true,
    effects: [{ type: "cc", cc: "stun", duration: 2 }],
  },
  {
    id: "charge",
    name: "Charge",
    description:
      "Fonce sur un ennemi entre 10 et 30 m. À l'arrivée : 100 dégâts et stun 4 s, impossibles à esquiver ou bloquer, même sur une cible immunisée au stun.",
    castTime: 0,
    resource: "endurance",
    cost: 30,
    range: SPELL_RANGE,
    minRange: 10,
    cooldown: 20,
    target: "enemy",
    effects: [{ type: "charge", damage: 100, stun: 4 }],
  },
  {
    id: "powerStrike",
    name: "Coup puissant",
    description: "100 dégâts, à la place du coup normal, quelle que soit la position. Technique de mêlée : part au prochain coup d'arme.",
    castTime: 0,
    resource: "endurance",
    cost: 20,
    range: MELEE_RANGE,
    cooldown: 0,
    target: "enemy",
    melee: true,
    effects: [{ type: "damage", amount: 100 }],
  },
  {
    id: "taunt",
    name: "Provocation",
    description:
      "Pendant 6 s, la cible inflige 50 % de dégâts en moins à tout autre que le Gardien. Sur le coup, elle s'arrête net, son incantation est interrompue, son attaque s'arrête et elle se tourne vers le Gardien.",
    castTime: 0,
    resource: "endurance",
    cost: 30,
    range: SPELL_RANGE,
    cooldown: 20,
    target: "enemy",
    effects: [{ type: "taunt", duration: 6 }],
  },
  {
    id: "rallyCry",
    name: "Cri de ralliement",
    description: "Le Gardien et les alliés à 20 m sont immunisés aux contrôles magiques pendant 6 s ; ceux déjà en place sont retirés.",
    castTime: 0,
    resource: "endurance",
    cost: 30,
    range: 0,
    cooldown: 60,
    target: "self",
    radius: 20,
    effects: [{ type: "rallyCry", duration: 6 }],
  },
  {
    id: "cripplingStrike",
    name: "Frappe handicapante",
    description: "100 dégâts, à la place du coup normal, et snare pendant 8 s. Dans le dos de la cible. Technique de mêlée : part au prochain coup d'arme.",
    castTime: 0,
    resource: "endurance",
    cost: 15,
    range: MELEE_RANGE,
    cooldown: 0,
    target: "enemy",
    melee: true,
    position: "back",
    effects: [
      { type: "damage", amount: 100 },
      { type: "snare", slow: SNARE_SLOW, duration: 8 },
    ],
  },
  {
    id: "rampart",
    name: "Rempart",
    description:
      "Pendant 10 s, le Gardien et les alliés à 30 m de lui ne subissent aucune attaque de mêlée. Le Gardien ne peut plus rien faire ; l'effet s'arrête s'il meurt ou s'il est mez ou stun.",
    castTime: 0,
    resource: "endurance",
    cost: 50,
    range: 0,
    cooldown: 180,
    target: "self",
    effects: [{ type: "rampart", duration: 10 }],
  },
  // --- Arcaniste ---
  {
    id: "firebolt",
    name: "Trait de feu",
    description: "Projectile de feu : 250 dégâts.",
    castTime: 2,
    resource: "mana",
    cost: 100,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    school: "fire",
    effects: [{ type: "damage", amount: 250 }],
  },
  {
    id: "blast",
    name: "Déflagration",
    description: "Explosion autour de soi, sans cible : 450 dégâts au centre, jusqu'à 100 au bord, sur les ennemis à 7 m.",
    castTime: 2,
    resource: "mana",
    cost: 150,
    range: 0,
    cooldown: 0,
    target: "enemiesAround",
    radius: 7,
    school: "fire",
    effects: [{ type: "damage", amount: 450, edgeAmount: 100 }],
  },
  {
    id: "concentration",
    name: "Concentration",
    description: "Le prochain sort ne peut pas être interrompu.",
    castTime: 0,
    resource: "mana",
    cost: 0,
    range: 0,
    cooldown: 90,
    target: "self",
    effects: [{ type: "status", status: "concentration", duration: INFINITE }],
  },
  {
    id: "frostbolt",
    name: "Trait de givre",
    description: "Projectile de givre : 150 dégâts, et ralentit la cible de 40 % pendant 4 s.",
    castTime: 2,
    resource: "mana",
    cost: 100,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    school: "frost",
    effects: [
      { type: "damage", amount: 150 },
      { type: "snare", slow: SNARE_SLOW, duration: 4 },
    ],
  },
  {
    id: "nearSight",
    name: "Near sight",
    description: `Pendant 15 s, la portée des sorts de la cible est réduite de ${Math.round((1 - NEAR_SIGHT_FACTOR) * 100)} %.`,
    castTime: 1.5,
    resource: "mana",
    cost: 100,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    effects: [{ type: "nearSight", duration: 15 }],
  },
  {
    id: "burn",
    name: "Brûlure",
    description: "La cible brûle : 400 dégâts en 10 s (40 par seconde). Libère du mez et du root, mais n'interrompt pas l'incantation.",
    castTime: 2,
    resource: "mana",
    cost: 200,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "enemy",
    school: "fire",
    effects: [{ type: "dot", amount: 400, duration: 10 }],
  },
  {
    id: "frostNova",
    name: "Nova de givre",
    description: "Enracine 12 s les ennemis à 15 m autour de soi : ils repartent lentement, puis à pleine vitesse. Les dégâts les libèrent.",
    castTime: 1.5,
    resource: "mana",
    cost: 200,
    range: 0,
    cooldown: 60,
    target: "enemiesAround",
    radius: 15,
    school: "frost",
    effects: [{ type: "cc", cc: "root", duration: 12 }],
  },
  {
    id: "arcanePower",
    name: "Puissance arcanique",
    description: "Pendant 15 s, tous les sorts de dégâts de l'Arcaniste sont critiques (× 1,5).",
    castTime: 0,
    resource: "mana",
    cost: 400,
    range: 0,
    cooldown: 180,
    target: "self",
    effects: [{ type: "status", status: "arcanePower", duration: 15 }],
  },
  // Sorts à débloquer (pas encore dans la barre, voir ClassDef.unlockable).
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
    school: "frost",
    effects: [{ type: "cc", cc: "root", duration: 10 }],
  },
  // Bulle (comme le bladeturn de DAoC) : absorbe entièrement le prochain coup de mêlée, puis disparaît.
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
  // TODO Barde : passe au Barde (étape suivante)
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
    id: "groupHeal",
    name: "Soin de groupe",
    description:
      "Rend 900 points de vie répartis entre les alliés à 30 m (Prêtre compris), selon les points de vie qui manquent à chacun. Le surplus est perdu.",
    castTime: 3,
    resource: "mana",
    cost: 300,
    range: 0,
    cooldown: 0,
    target: "self",
    radius: 30,
    effects: [{ type: "splitHeal", amount: 900 }],
  },
  {
    id: "buffHp",
    name: "Buff de vie",
    description: "+200 points de vie maximum, jusqu'à la mort du Prêtre ou de la cible.",
    castTime: 2,
    resource: "mana",
    cost: 50,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "ally",
    effects: [{ type: "buff", buff: "buffHp" }],
  },
  {
    id: "buffStrength",
    name: "Buff de puissance",
    description: "+15 % de dégâts (mêlée et sorts) et de soins, jusqu'à la mort du Prêtre ou de la cible.",
    castTime: 2,
    resource: "mana",
    cost: 50,
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
    cost: 300,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "deadAlly",
    effects: [{ type: "resurrect", hpRatio: 0.5 }],
  },
  {
    id: "renew",
    name: "Renouveau",
    description:
      "Rend 500 points de vie en 10 s à un allié, un tic par seconde. Relancé, il repart de zéro ; ceux de plusieurs Prêtres se cumulent.",
    castTime: 2,
    resource: "mana",
    cost: 100,
    range: SPELL_RANGE,
    cooldown: 0,
    target: "ally",
    effects: [{ type: "hot", amount: 500, duration: 10 }],
  },
  {
    id: "divineIntervention",
    name: "Intervention divine",
    description: "Relève tous les alliés morts à 30 m à 50 % de vie, sans aucun buff.",
    castTime: 5,
    resource: "mana",
    cost: 500,
    range: 0,
    cooldown: 180,
    target: "self",
    radius: 30,
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
      { type: "snare", slow: SNARE_SLOW, duration: 8 },
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

// Sort magique (lancé avec du mana, hors technique de mêlée) : ses contrôles sont « magiques » et le Cri de
// ralliement en protège. Les techniques et compétences d'endurance sont physiques.
export function isMagic(ability: AbilityDef): boolean {
  return !ability.melee && ability.resource === "mana";
}

// Rayon autour du Gardien protégé par le Rempart.
export const RAMPART_RADIUS = 30;

// Compétence dirigée contre un ennemi : soumise au cône de vision, interrompt le chant du Barde.
export function isOffensive(ability: AbilityDef): boolean {
  return ability.target === "enemy" || ability.target === "enemiesAround";
}

// Résurrection de zone (Intervention divine) : elle relève les alliés morts dans son rayon.
export function revivesInArea(ability: AbilityDef): boolean {
  return !!ability.radius && ability.effects.some((effect) => effect.type === "resurrect");
}

// Zone qui touche tout ce qui est dans son rayon, même derrière un obstacle : déflagration autour du lanceur,
// résurrection de zone et soin réparti (Soin de groupe).
export function ignoresLineOfSight(ability: AbilityDef): boolean {
  return (
    ability.target === "enemiesAround" ||
    revivesInArea(ability) ||
    ability.effects.some((effect) => effect.type === "splitHeal")
  );
}
