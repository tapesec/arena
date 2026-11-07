import { Room, type Client } from "colyseus";
import {
  AUTO_ATTACK_DAMAGE,
  AUTO_ATTACK_INTERVAL,
  ENDURANCE_REGEN,
  MANA_REGEN,
  NO_INPUT,
  TICK_RATE,
  distance,
  facingTowards,
  getAbility,
  hasLineOfSight,
  isFacing,
  isInMeleeRange,
  stepMovement,
  type AbilityDef,
  type CombatEvent,
  type CooldownEvent,
  type InterruptEvent,
  type InterruptReason,
  type MoveInput,
} from "@arena/shared";
import { ArenaState, PlayerState } from "./state";

const MAX_PLAYERS = 16;
const IS_DEV = process.env.NODE_ENV !== "production";

// Joueurs apparaissant dans un rayon de 5 m autour du centre, zone laissée libre d'obstacles.
const SPAWN_RADIUS = 5;

export class ArenaRoom extends Room<{ state: ArenaState }> {
  maxClients = MAX_PLAYERS;
  state = new ArenaState();

  // Données internes au serveur, jamais envoyées aux clients.
  private moveInputs = new Map<string, MoveInput>();
  private targets = new Map<string, string | null>();
  // Temps restant avant le prochain coup possible, en secondes.
  private swingTimers = new Map<string, number>();
  // Cible verrouillée au début de l'incantation.
  private castTargets = new Map<string, string>();
  // Instant (en ms) à partir duquel chaque compétence est de nouveau disponible.
  private cooldowns = new Map<string, Map<string, number>>();

  messages = {
    input: (client: Client, message: unknown) => {
      this.moveInputs.set(client.sessionId, sanitizeInput(message));
    },

    target: (client: Client, message: unknown) => {
      const targetId = (message as { targetId?: unknown } | null)?.targetId;
      const valid = typeof targetId === "string" && targetId !== client.sessionId && this.state.players.has(targetId);
      this.targets.set(client.sessionId, valid ? targetId : null);
    },

    // Tourne le personnage vers sa cible sans le déplacer (équivalent du /face de DAoC).
    faceTarget: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      const targetId = this.targets.get(client.sessionId);
      const target = targetId ? this.state.players.get(targetId) : undefined;
      if (player && isAlive(player) && target) player.facing = facingTowards(player, target);
    },

    toggleAttack: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (player && isAlive(player)) player.attacking = !player.attacking;
    },

    cast: (client: Client, message: unknown) => {
      const abilityId = (message as { abilityId?: unknown } | null)?.abilityId;
      const ability = typeof abilityId === "string" ? getAbility(abilityId) : undefined;
      if (ability) this.tryStartAbility(client, ability);
    },

    // Outil de test : revenir à la vie sans relancer la partie.
    respawn: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!IS_DEV || !player || isAlive(player)) return;
      player.hp = player.maxHp;
      player.mana = player.maxMana;
      player.endurance = player.maxEndurance;
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
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SPAWN_RADIUS;
    player.x = Math.cos(angle) * radius;
    player.z = Math.sin(angle) * radius;
    this.state.players.set(client.sessionId, player);
    this.moveInputs.set(client.sessionId, NO_INPUT);
    this.swingTimers.set(client.sessionId, 0);
    this.cooldowns.set(client.sessionId, new Map());
    console.log(`[arena] ${player.name} a rejoint (${this.state.players.size} joueurs)`);
  }

  onLeave(client: Client) {
    const name = this.state.players.get(client.sessionId)?.name;
    this.state.players.delete(client.sessionId);
    for (const map of [this.moveInputs, this.targets, this.swingTimers, this.castTargets, this.cooldowns]) {
      map.delete(client.sessionId);
    }
    console.log(`[arena] ${name} est parti (${this.state.players.size} joueurs)`);
  }

  private update(dt: number) {
    this.state.players.forEach((player, id) => {
      if (!isAlive(player)) return;
      this.updateMovement(player, id, dt);
      this.updateRegen(player, dt);
    });
    // Les actions sont résolues après tous les déplacements, sur des positions à jour.
    this.state.players.forEach((player, id) => {
      if (!isAlive(player)) return;
      this.updateCast(player, id, dt);
      this.updateAutoAttack(player, id, dt);
    });
  }

  // --- Déplacement et ressources ---

  private updateMovement(player: PlayerState, id: string, dt: number) {
    const input = this.moveInputs.get(id) ?? NO_INPUT;
    const next = stepMovement(player, input, dt);
    if (next.x === player.x && next.z === player.z) return;

    player.facing = Math.atan2(next.x - player.x, next.z - player.z);
    player.x = next.x;
    player.z = next.z;
    // Comme dans DAoC, bouger interrompt l'incantation.
    if (player.castAbility) this.interruptCast(player, id, "move");
  }

  private updateRegen(player: PlayerState, dt: number) {
    player.mana = Math.min(player.maxMana, player.mana + MANA_REGEN * dt);
    player.endurance = Math.min(player.maxEndurance, player.endurance + ENDURANCE_REGEN * dt);
  }

  // --- Compétences ---

  private tryStartAbility(client: Client, ability: AbilityDef) {
    const casterId = client.sessionId;
    const caster = this.state.players.get(casterId);
    if (!caster || !isAlive(caster)) return;

    const error = this.checkAbilityStart(caster, casterId, ability);
    if (error) {
      client.send("error", { message: error });
      return;
    }

    const targetId = ability.target === "self" ? casterId : this.targets.get(casterId)!;
    if (ability.castTime === 0) {
      this.resolveAbility(caster, casterId, ability, targetId);
      return;
    }
    caster.castAbility = ability.id;
    caster.castElapsed = 0;
    caster.castDuration = ability.castTime;
    this.castTargets.set(casterId, targetId);
  }

  // Retourne le message d'erreur à afficher au joueur, ou null si l'action est possible.
  private checkAbilityStart(caster: PlayerState, casterId: string, ability: AbilityDef): string | null {
    if (caster.castAbility) return "Incantation déjà en cours";
    if ((this.cooldowns.get(casterId)?.get(ability.id) ?? 0) > Date.now()) return "Compétence en recharge";
    if (caster[ability.resource] < ability.cost) {
      return ability.resource === "mana" ? "Pas assez de mana" : "Pas assez d'endurance";
    }
    if (ability.castTime > 0 && isMoving(this.moveInputs.get(casterId))) return "Impossible d'incanter en mouvement";
    if (ability.target === "self") return null;

    const targetId = this.targets.get(casterId);
    const target = targetId ? this.state.players.get(targetId) : undefined;
    return this.checkTarget(caster, target, ability);
  }

  private checkTarget(caster: PlayerState, target: PlayerState | undefined, ability: AbilityDef): string | null {
    if (!target) return "Aucune cible";
    if (!isAlive(target)) return "La cible est morte";
    if (distance(caster, target) > ability.range) return "Cible hors de portée";
    if (!hasLineOfSight(caster, target)) return "Cible hors de vue";
    if (!isFacing(caster, target)) return "Vous devez faire face à la cible";
    return null;
  }

  private updateCast(caster: PlayerState, casterId: string, dt: number) {
    if (!caster.castAbility) return;
    caster.castElapsed = Math.min(caster.castDuration, caster.castElapsed + dt);
    if (caster.castElapsed < caster.castDuration) return;

    const ability = getAbility(caster.castAbility)!;
    const targetId = this.castTargets.get(casterId)!;
    this.endCast(caster, casterId);

    // Les conditions sont revérifiées à la fin : la cible a pu s'éloigner ou se cacher.
    const target = this.state.players.get(targetId);
    const error =
      caster[ability.resource] < ability.cost
        ? "Ressource insuffisante"
        : ability.target === "self"
          ? null
          : this.checkTarget(caster, target, ability);
    if (error) {
      this.clients.getById(casterId)?.send("error", { message: error });
      return;
    }
    this.resolveAbility(caster, casterId, ability, targetId);
  }

  private resolveAbility(caster: PlayerState, casterId: string, ability: AbilityDef, targetId: string) {
    caster[ability.resource] -= ability.cost;
    if (ability.cooldown > 0) {
      this.cooldowns.get(casterId)?.set(ability.id, Date.now() + ability.cooldown * 1000);
      const event: CooldownEvent = { abilityId: ability.id, duration: ability.cooldown };
      this.clients.getById(casterId)?.send("cooldown", event);
    }

    const target = this.state.players.get(targetId);
    if (!target) return;
    if (ability.effect.kind === "damage") {
      this.applyDamage(casterId, targetId, target, ability.effect.amount, ability.id);
    } else {
      this.applyHeal(casterId, targetId, target, ability.effect.amount, ability.id);
    }
  }

  private interruptCast(caster: PlayerState, casterId: string, reason: InterruptReason) {
    const event: InterruptEvent = { casterId, abilityId: caster.castAbility, reason };
    this.endCast(caster, casterId);
    this.broadcast("interrupt", event);
  }

  private endCast(caster: PlayerState, casterId: string) {
    caster.castAbility = "";
    caster.castElapsed = 0;
    caster.castDuration = 0;
    this.castTargets.delete(casterId);
  }

  // --- Attaque automatique ---

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
    if (timer > 0 || !isInMeleeRange(attacker, target) || !hasLineOfSight(attacker, target)) return;
    if (!isFacing(attacker, target)) return;

    this.applyDamage(attackerId, targetId, target, AUTO_ATTACK_DAMAGE, "auto");
    this.swingTimers.set(attackerId, AUTO_ATTACK_INTERVAL);
  }

  // --- Effets ---

  private applyDamage(sourceId: string, targetId: string, target: PlayerState, amount: number, abilityId: string) {
    target.hp = Math.max(0, target.hp - amount);
    const killed = target.hp === 0;
    // Tout dégât reçu interrompt l'incantation en cours.
    if (target.castAbility) this.interruptCast(target, targetId, "damage");
    if (killed) {
      // Un mort ne bouge plus et n'attaque plus.
      target.attacking = false;
      this.moveInputs.set(targetId, NO_INPUT);
    }
    const event: CombatEvent = { sourceId, targetId, abilityId, kind: "damage", amount, killed };
    this.broadcast("combat", event);
  }

  private applyHeal(sourceId: string, targetId: string, target: PlayerState, amount: number, abilityId: string) {
    const healed = Math.min(amount, target.maxHp - target.hp);
    target.hp += healed;
    const event: CombatEvent = { sourceId, targetId, abilityId, kind: "heal", amount: healed, killed: false };
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

function isMoving(input: MoveInput | undefined): boolean {
  return !!input && (input.up || input.down || input.left || input.right);
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
