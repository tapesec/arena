import { schema, t, type SchemaType } from "@colyseus/schema";

// Effet actif affiché par les clients (durée restante en secondes, -1 = permanent).
export const EffectState = schema(
  {
    kind: t.string().default(""),
    remaining: t.float32().default(0),
    // Durée totale à la pose ou au dernier rafraîchissement (-1 = permanent) : cadran qui se vide dans le HUD.
    duration: t.float32().default(-1),
    // Joueur à l'origine de l'effet (affichage du lien entre un Gardien et son protégé).
    source: t.string().default(""),
  },
  "EffectState",
);
export type EffectState = SchemaType<typeof EffectState>;

// L'état synchronisé automatiquement vers tous les clients.
// Colyseus n'envoie que les champs modifiés à chaque patch.
export const PlayerState = schema(
  {
    name: t.string().default(""),
    // Joueur contrôlé par le serveur.
    isBot: t.boolean().default(false),
    // Chef d'équipe (premier joueur arrivé dans l'équipe) : il choisit la classe des bots de son équipe.
    leader: t.boolean().default(false),
    classId: t.string().default(""),
    team: t.uint8().default(0),
    x: t.float32().default(0),
    z: t.float32().default(0),
    // Orientation en radians (0 = vers +z, angle croissant en tournant à droite).
    facing: t.float32().default(0),
    // Verrou sur la cible : "face" (F, lui faire face en permanence), "stick" (C, la suivre), "" sinon.
    lock: t.string().default(""),
    colorIndex: t.uint8().default(0),
    hp: t.uint16().default(0),
    maxHp: t.uint16().default(0),
    // Les ressources se régénèrent par fractions : on les garde en flottant.
    // Une classe n'utilise qu'une des deux ; l'autre a un maximum à 0.
    mana: t.float32().default(0),
    maxMana: t.uint16().default(0),
    endurance: t.float32().default(0),
    maxEndurance: t.uint16().default(0),
    // Mode attaque activé : le personnage frappe sa cible dès qu'elle est à portée.
    attacking: t.boolean().default(false),
    // Technique de mêlée en attente du prochain coup d'arme ("" si aucune).
    queuedAbility: t.string().default(""),
    // Technique qui a porté au dernier coup d'arme : un combo qui la suit peut partir au coup suivant ("" si aucune).
    comboAbility: t.string().default(""),
    // Sa cible : le combo ne part que sur elle.
    comboTarget: t.string().default(""),
    // Le Gardien fonce sur sa cible (Charge).
    charging: t.boolean().default(false),
    // Chant du Barde en cours (id de la compétence : speedSong, secondWind ; "" si aucun).
    song: t.string().default(""),
    // Incantation en cours ("" si aucune), visible de tous pour pouvoir l'interrompre.
    castAbility: t.string().default(""),
    castElapsed: t.float32().default(0),
    castDuration: t.float32().default(0),
    effects: t.array(EffectState),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const ArenaState = schema(
  {
    // Phase de la partie (voir MatchPhase) et secondes restantes avant la suivante.
    phase: t.string().default("classSelect"),
    phaseTimeLeft: t.float32().default(0),
    // Équipe gagnante une fois la partie terminée (-1 tant qu'il n'y en a pas).
    winner: t.int8().default(-1),
    // Nombre de joueurs humains dans la partie et nombre maximal (le reste est joué par des bots).
    playerCount: t.uint8().default(0),
    matchSize: t.uint8().default(0),
    // Filtrée par client (StateView) : chacun ne reçoit que les joueurs que son équipe voit.
    players: t.map(PlayerState).view(),
  },
  "ArenaState",
);
export type ArenaState = SchemaType<typeof ArenaState>;
