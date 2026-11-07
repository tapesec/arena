import { Room, type Client } from "colyseus";
import { NO_INPUT, TICK_RATE, stepMovement, type MoveInput } from "@arena/shared";
import { ArenaState, PlayerState } from "./state";

const MAX_PLAYERS = 16;

export class ArenaRoom extends Room<{ state: ArenaState }> {
  maxClients = MAX_PLAYERS;
  state = new ArenaState();

  // Dernier état des touches reçu pour chaque joueur, appliqué à chaque tick.
  private moveInputs = new Map<string, MoveInput>();

  messages = {
    input: (client: Client, message: unknown) => {
      this.moveInputs.set(client.sessionId, sanitizeInput(message));
    },
  };

  onCreate() {
    // Le serveur fait autorité : lui seul calcule les positions.
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / TICK_RATE);
    this.setPatchRate(1000 / TICK_RATE);
  }

  onJoin(client: Client) {
    const player = new PlayerState();
    player.x = (Math.random() - 0.5) * 10;
    player.z = (Math.random() - 0.5) * 10;
    player.colorIndex = this.state.players.size % MAX_PLAYERS;
    this.state.players.set(client.sessionId, player);
    this.moveInputs.set(client.sessionId, NO_INPUT);
    console.log(`[arena] ${client.sessionId} a rejoint (${this.state.players.size} joueurs)`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.moveInputs.delete(client.sessionId);
    console.log(`[arena] ${client.sessionId} est parti (${this.state.players.size} joueurs)`);
  }

  private update(dt: number) {
    this.state.players.forEach((player, sessionId) => {
      const input = this.moveInputs.get(sessionId) ?? NO_INPUT;
      const next = stepMovement(player, input, dt);
      if (next.x !== player.x || next.z !== player.z) {
        player.facing = Math.atan2(next.x - player.x, next.z - player.z);
        player.x = next.x;
        player.z = next.z;
      }
    });
  }
}

// Ne jamais faire confiance au client : on reconstruit un input propre.
function sanitizeInput(message: unknown): MoveInput {
  const raw = (message ?? {}) as Partial<Record<keyof MoveInput, unknown>>;
  return {
    up: raw.up === true,
    down: raw.down === true,
    left: raw.left === true,
    right: raw.right === true,
  };
}
