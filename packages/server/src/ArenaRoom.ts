import { Room, type Client } from "colyseus";
import { CLASSES, TICK_RATE, getClass, maxResource, type MoveInput } from "@arena/shared";
import { CombatSystem } from "./CombatSystem";
import { PlayerRuntime } from "./PlayerRuntime";
import { ArenaState, PlayerState } from "./state";

const MAX_PLAYERS = 16;
const IS_DEV = process.env.NODE_ENV !== "production";

// Joueurs apparaissant dans un rayon de 5 m autour du centre, zone laissée libre d'obstacles.
const SPAWN_RADIUS = 5;

export class ArenaRoom extends Room<{ state: ArenaState }> {
  maxClients = MAX_PLAYERS;
  state = new ArenaState();

  private combat = new CombatSystem({
    broadcast: (type, message) => this.broadcast(type, message),
    sendTo: (playerId, type, message) => this.clients.getById(playerId)?.send(type, message),
  });

  messages = {
    input: (client: Client, message: unknown) => {
      this.combat.setInput(client.sessionId, sanitizeInput(message));
    },
    target: (client: Client, message: unknown) => {
      const targetId = (message as { targetId?: unknown } | null)?.targetId;
      this.combat.setTarget(client.sessionId, typeof targetId === "string" ? targetId : null);
    },
    toggleAttack: (client: Client) => this.combat.toggleAttack(client.sessionId),
    faceTarget: (client: Client) => this.combat.faceTarget(client.sessionId),
    cast: (client: Client, message: unknown) => {
      const abilityId = (message as { abilityId?: unknown } | null)?.abilityId;
      if (typeof abilityId === "string") this.combat.useAbility(client.sessionId, abilityId);
    },
    // Outil de test : revenir à la vie sans relancer la partie.
    respawn: (client: Client) => {
      if (IS_DEV) this.combat.respawn(client.sessionId);
    },
  };

  onCreate() {
    // Le serveur fait autorité : lui seul calcule les positions et les dégâts.
    this.setSimulationInterval((deltaMs) => this.combat.tick(deltaMs / 1000), 1000 / TICK_RATE);
    this.setPatchRate(1000 / TICK_RATE);
  }

  onJoin(client: Client, options?: { classId?: unknown }) {
    // Classe choisie par le joueur avant de rejoindre (provisoire, en attendant la phase de sélection).
    const classDef = getClass(typeof options?.classId === "string" ? options.classId : "") ?? CLASSES.gardien;

    const player = new PlayerState();
    player.colorIndex = this.nextColorIndex();
    player.name = `Joueur ${player.colorIndex + 1}`;
    player.classId = classDef.id;
    player.team = this.smallestTeam();
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPAWN_RADIUS;
    player.x = Math.cos(angle) * radius;
    player.z = Math.sin(angle) * radius;
    player.hp = player.maxHp = classDef.maxHp;
    if (classDef.resource === "mana") player.mana = player.maxMana = maxResource("mana");
    else player.endurance = player.maxEndurance = maxResource("endurance");

    this.state.players.set(client.sessionId, player);
    this.combat.add(new PlayerRuntime(client.sessionId, player, classDef));
    console.log(`[arena] ${player.name} (${classDef.name}, équipe ${player.team + 1}) a rejoint`);
  }

  onLeave(client: Client) {
    const name = this.state.players.get(client.sessionId)?.name;
    this.combat.remove(client.sessionId);
    this.state.players.delete(client.sessionId);
    console.log(`[arena] ${name} est parti (${this.state.players.size} joueurs)`);
  }

  // Équipe provisoire : on complète la moins nombreuse (le matchmaking viendra à l'étape 6).
  private smallestTeam(): number {
    const counts = [0, 0];
    this.state.players.forEach((p) => counts[p.team]++);
    return counts[0] <= counts[1] ? 0 : 1;
  }

  private nextColorIndex(): number {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.colorIndex));
    let index = 0;
    while (used.has(index)) index++;
    return index;
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
