import { schema, t, type SchemaType } from "@colyseus/schema";

// L'état synchronisé automatiquement vers tous les clients.
// Colyseus n'envoie que les champs modifiés à chaque patch.
export const PlayerState = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    // Orientation en radians, déduite de la dernière direction de déplacement.
    facing: t.float32().default(0),
    colorIndex: t.uint8().default(0),
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
