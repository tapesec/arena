import { Room, type Client } from "colyseus";
import {
  AUTO_ATTACK_DAMAGE,
  AUTO_ATTACK_INTERVAL,
  MAX_HP,
  NO_INPUT,
  TICK_RATE,
  isInMeleeRange,
  stepMovement,
  type CombatEvent,
  type MoveInput,
} from "@arena/shared";
import { ArenaState, PlayerState } from "./state";

const MAX_PLAYERS = 16;
const IS_DEV = process.env.NODE_ENV !== "production";

export class ArenaRoom extends Room<{ state: ArenaState }> {
  maxClients = MAX_PLAYERS;
  state = new ArenaState();

  // Données internes au serveur, jamais envoyées aux clients.
  private moveInputs = new Map<string, MoveInput>();
  private targets = new Map<string, string | null>();
  // Temps restant avant le prochain coup possible, en secondes.
  private swingTimers = new Map<string, number>();

  messages = {
    input: (client: Client, message: unknown) => {
      this.moveInputs.set(client.sessionId, sanitizeInput(message));
    },

    target: (client: Client, message: unknown) => {
      const targetId = (message as { targetId?: unknown } | null)?.targetId;
      const valid = typeof targetId === "string" && targetId !== client.sessionId && this.state.players.has(targetId);
      this.targets.set(client.sessionId, valid ? targetId : null);
    },

    toggleAttack: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (player && isAlive(player)) player.attacking = !player.attacking;
    },

    // Outil de test : revenir à la vie sans relancer la partie.
    respawn: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (IS_DEV && player && !isAlive(player)) player.hp = player.maxHp;
    },
  };

  onCreate() {
    // Le serveur fait autorité : lui seul calcule les positions et les dégâts.
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / TICK_RATE);
    this.setPatchRate(1000 / TICK_RATE);
  }

  onJoin(client: Client) {
    const player = new PlayerState();
    player.colorIndex = this.nextColorIndex();
    player.name = `Joueur ${player.colorIndex + 1}`;
    player.x = (Math.random() - 0.5) * 10;
    player.z = (Math.random() - 0.5) * 10;
    player.hp = MAX_HP;
    player.maxHp = MAX_HP;
    this.state.players.set(client.sessionId, player);
    this.moveInputs.set(client.sessionId, NO_INPUT);
    this.swingTimers.set(client.sessionId, 0);
    console.log(`[arena] ${player.name} a rejoint (${this.state.players.size} joueurs)`);
  }

  onLeave(client: Client) {
    const name = this.state.players.get(client.sessionId)?.name;
    this.state.players.delete(client.sessionId);
    this.moveInputs.delete(client.sessionId);
    this.targets.delete(client.sessionId);
    this.swingTimers.delete(client.sessionId);
    console.log(`[arena] ${name} est parti (${this.state.players.size} joueurs)`);
  }

  private update(dt: number) {
    this.state.players.forEach((player, sessionId) => {
      if (isAlive(player)) this.updateMovement(player, sessionId, dt);
    });
    this.state.players.forEach((player, sessionId) => {
      if (isAlive(player)) this.updateAutoAttack(player, sessionId, dt);
    });
  }

  private updateMovement(player: PlayerState, sessionId: string, dt: number) {
    const input = this.moveInputs.get(sessionId) ?? NO_INPUT;
    const next = stepMovement(player, input, dt);
    if (next.x !== player.x || next.z !== player.z) {
      player.facing = Math.atan2(next.x - player.x, next.z - player.z);
      player.x = next.x;
      player.z = next.z;
    }
  }

  private updateAutoAttack(attacker: PlayerState, attackerId: string, dt: number) {
    // Le délai entre deux coups s'écoule même hors portée : le premier coup part dès le contact.
    const timer = Math.max(0, (this.swingTimers.get(attackerId) ?? 0) - dt);
    this.swingTimers.set(attackerId, timer);
    if (!attacker.attacking) return;

    const targetId = this.targets.get(attackerId);
    const target = targetId ? this.state.players.get(targetId) : undefined;
    if (!targetId || !target || !isAlive(target)) {
      attacker.attacking = false;
      return;
    }
    if (timer > 0 || !isInMeleeRange(attacker, target)) return;

    this.applyDamage(attackerId, targetId, target, AUTO_ATTACK_DAMAGE);
    this.swingTimers.set(attackerId, AUTO_ATTACK_INTERVAL);
  }

  private applyDamage(attackerId: string, targetId: string, target: PlayerState, damage: number) {
    target.hp = Math.max(0, target.hp - damage);
    const killed = target.hp === 0;
    if (killed) {
      // Un mort ne bouge plus et n'attaque plus.
      target.attacking = false;
      this.moveInputs.set(targetId, NO_INPUT);
    }
    const event: CombatEvent = { attackerId, targetId, damage, killed };
    this.broadcast("combat", event);
  }

  private nextColorIndex(): number {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.colorIndex));
    let index = 0;
    while (used.has(index)) index++;
    return index;
  }
}

function isAlive(player: PlayerState): boolean {
  return player.hp > 0;
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
