import { schema, t, type SchemaType } from "@colyseus/schema";

// Effet actif affiché par les clients (durée restante en secondes, -1 = permanent).
export const EffectState = schema(
  {
    kind: t.string().default(""),
    remaining: t.float32().default(0),
  },
  "EffectState",
);
export type EffectState = SchemaType<typeof EffectState>;

// L'état synchronisé automatiquement vers tous les clients.
// Colyseus n'envoie que les champs modifiés à chaque patch.
export const PlayerState = schema(
  {
    name: t.string().default(""),
    classId: t.string().default(""),
    team: t.uint8().default(0),
    x: t.float32().default(0),
    z: t.float32().default(0),
    // Orientation en radians, déduite de la dernière direction de déplacement.
    facing: t.float32().default(0),
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
    // Chant de vitesse du Barde activé.
    songActive: t.boolean().default(false),
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
    players: t.map(PlayerState),
  },
  "ArenaState",
);
export type ArenaState = SchemaType<typeof ArenaState>;
