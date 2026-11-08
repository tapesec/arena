import {
  AURA_ENDURANCE_REGEN,
  AURA_MANA_REGEN,
  AURA_RANGE,
  BUBBLE_COOLDOWN,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  ENDURANCE_REGEN,
  EVASION_CHANCE,
  GUARD_BLOCK_CHANCE,
  GUARD_RANGE,
  HP_BUFF_AMOUNT,
  IMMUNITY_DURATION,
  INTERCEPT_RANGE,
  MANA_REGEN,
  NO_INPUT,
  PERMANENT,
  SHIELD_BLOCK_CHANCE,
  SONG_RANGE,
  SONG_SPEED_MULTIPLIER,
  SONG_SUPPRESS_DURATION,
  STICK_DISTANCE,
  STRENGTH_BUFF_BONUS,
  distance,
  facingTowards,
  forwardOf,
  inputSpeedFactor,
  isTurning,
  moveDirection,
  turnFacing,
  getAbility,
  hasLineOfSight,
  isFacing,
  isInMeleeRange,
  isOffensive,
  positionRelativeTo,
  stepMovement,
  type AbilityDef,
  type AbilityEffect,
  type AbilityUsedEvent,
  type CombatEvent,
  type CooldownEvent,
  type CrowdControl,
  type EffectKind,
  type InterruptEvent,
  type InterruptReason,
  type MoveInput,
  type Position,
} from "@arena/shared";
import type { ActiveEffect, PlayerRuntime } from "./PlayerRuntime";
import { EffectState } from "./state";

// Ce dont le système de combat a besoin pour communiquer avec les clients.
export interface CombatOutput {
  // involved : joueurs concernés, pour ne prévenir que ceux qui peuvent voir l'événement.
  broadcast(type: string, message: unknown, involved: string[]): void;
  sendTo(playerId: string, type: string, message: unknown): void;
}

// Immunité associée à chaque type de contrôle.
const IMMUNITY_EFFECTS: Record<CrowdControl, EffectKind> = { mez: "immuneMez", stun: "immuneStun", root: "immuneRoot" };

// Effets posés par un joueur sur d'autres, qui disparaissent à sa mort ou à son départ.
const LINKED_EFFECTS: EffectKind[] = ["buffHp", "buffStrength", "guarded", "intercept"];

// Toutes les règles de combat. La salle Colyseus ne fait que lui transmettre les commandes.
export class CombatSystem {
  readonly players = new Map<string, PlayerRuntime>();
  // Limite de déplacement optionnelle (zone de départ pendant la préparation).
  confine: ((player: PlayerRuntime, pos: Position) => Position) | null = null;
  // Temps écoulé depuis le début de la partie, en secondes.
  private time = 0;

  get now(): number {
    return this.time;
  }

  constructor(
    private out: CombatOutput,
    private random: () => number = Math.random,
  ) {}

  add(player: PlayerRuntime) {
    this.players.set(player.id, player);
  }

  remove(id: string) {
    const player = this.players.get(id);
    if (!player) return;
    this.removeLinkedEffects(player);
    this.players.delete(id);
  }

  // --- Commandes des joueurs ---

  setInput(id: string, input: MoveInput) {
    const player = this.players.get(id);
    if (player) player.input = input;
  }

  setTarget(id: string, targetId: string | null) {
    const player = this.players.get(id);
    if (!player) return;
    const next = targetId && targetId !== id && this.players.has(targetId) ? targetId : null;
    // Changer de cible lâche le verrou (F ou C).
    if (next !== player.targetId) player.state.lock = "";
    player.targetId = next;
  }

  // F : faire face à la cible en permanence. C : la suivre (stick), en lui faisant face.
  // Rappuyer ne les annule pas : ils s'arrêtent quand on avance, recule ou pivote,
  // quand on meurt, quand on est contrôlé ou quand la cible disparaît (voir updateLock).
  lockOnTarget(id: string, lock: "face" | "stick") {
    const player = this.players.get(id);
    if (!player?.alive) return;
    const target = player.targetId ? this.players.get(player.targetId) : undefined;
    if (!target?.alive) return this.sendError(player, "Aucune cible");
    if (player.incapacitated || (lock === "stick" && player.has("root"))) return;
    player.state.lock = lock;
  }

  toggleAttack(id: string) {
    const player = this.players.get(id);
    if (player?.alive) player.state.attacking = !player.state.attacking;
  }

  // Tourne le personnage vers sa cible sans le déplacer (équivalent du /face de DAoC).
  faceTarget(id: string) {
    const player = this.players.get(id);
    const target = player?.targetId ? this.players.get(player.targetId) : undefined;
    if (player?.alive && !player.incapacitated && target) {
      player.state.facing = facingTowards(player.state, target.state);
    }
  }

  // Vrai si la compétence peut être utilisée maintenant sur la cible actuelle (utilisé par les bots).
  // ignoreMovement : vérifier comme si le lanceur était immobile (il s'arrêtera juste avant d'incanter).
  canUse(casterId: string, abilityId: string, ignoreMovement = false): boolean {
    const caster = this.players.get(casterId);
    const ability = getAbility(abilityId);
    if (!caster?.alive || !ability || !caster.classDef.abilities.includes(abilityId)) return false;
    if (this.checkCanUse(caster, ability, ignoreMovement)) return false;
    const targetId = this.pickTarget(caster, ability);
    return !!targetId && !this.validateTarget(caster, ability, targetId);
  }

  useAbility(casterId: string, abilityId: string) {
    const caster = this.players.get(casterId);
    const ability = getAbility(abilityId);
    if (!caster?.alive || !ability || !caster.classDef.abilities.includes(abilityId)) return;

    const error = this.checkCanUse(caster, ability);
    if (error) return this.sendError(caster, error);

    const targetId = this.pickTarget(caster, ability);
    if (!targetId) return this.sendError(caster, "Aucune cible");
    const targetError = this.validateTarget(caster, ability, targetId);
    if (targetError) return this.sendError(caster, targetError);

    if (ability.castTime === 0) {
      this.resolveAbility(caster, ability, targetId);
      return;
    }
    // Concentration protège la prochaine incantation, puis disparaît.
    const concentration = caster.getEffect("concentration");
    caster.castProtected = !!concentration;
    if (concentration) this.removeEffect(caster, concentration);

    caster.state.castAbility = ability.id;
    caster.state.castElapsed = 0;
    caster.state.castDuration = ability.castTime;
    caster.castTargetId = targetId;
  }

  // --- Simulation ---

  tick(dt: number) {
    this.time += dt;
    const alive = [...this.players.values()].filter((p) => p.alive);
    for (const p of alive) this.updateEffectTimers(p, dt);
    for (const p of alive) this.updateDerivedEffects(p);
    for (const p of alive) {
      this.updateMovement(p, dt);
      this.updateRegen(p, dt);
    }
    // Les actions sont résolues après tous les déplacements, sur des positions à jour.
    for (const p of alive) {
      if (!p.alive) continue;
      this.updateCast(p, dt);
      this.updateAutoAttack(p, dt);
    }
  }

  private updateMovement(player: PlayerRuntime, dt: number) {
    const state = player.state;
    player.stickMoving = false;
    this.updateLock(player);
    if (player.incapacitated) return;

    // Orientation : verrou sur la cible, sinon la souris (clic droit), sinon la rotation au clavier.
    // Pivoter n'interrompt pas l'incantation.
    const input = player.input;
    const target = state.lock && player.targetId ? this.players.get(player.targetId) : undefined;
    if (target) state.facing = facingTowards(state, target.state);
    else if (input.steer && input.yaw !== undefined) state.facing = input.yaw;
    else state.facing = turnFacing(state.facing, input, dt);

    if (player.has("root")) return;
    const direction = moveDirection(input, state.facing);
    // Stick : on avance vers la cible tant qu'on n'est pas assez près (les pas de côté restent possibles).
    if (target && state.lock === "stick" && distance(state, target.state) > STICK_DISTANCE) {
      const forward = forwardOf(state.facing);
      direction.x += forward.x;
      direction.z += forward.z;
      player.stickMoving = true;
    }

    const snare = player.getEffect("snare");
    const speed =
      (player.has("speed") ? SONG_SPEED_MULTIPLIER : 1) * (snare ? 1 - snare.value : 1) * inputSpeedFactor(input);
    let next = stepMovement(state, direction, dt, speed);
    if (this.confine) next = this.confine(player, next);
    if (next.x === state.x && next.z === state.z) return;

    state.x = next.x;
    state.z = next.z;
    // Comme dans DAoC, bouger interrompt l'incantation.
    if (state.castAbility) this.interrupt(player, "move");
  }

  // Lâche le verrou F/C quand il n'a plus lieu d'être.
  private updateLock(player: PlayerRuntime) {
    const state = player.state;
    if (!state.lock) return;
    const target = player.targetId ? this.players.get(player.targetId) : undefined;
    const input = player.input;
    const released =
      !target?.alive ||
      player.incapacitated ||
      (state.lock === "stick" && player.has("root")) ||
      input.up !== input.down ||
      isTurning(input);
    if (released) state.lock = "";
  }

  private updateRegen(player: PlayerRuntime, dt: number) {
    const state = player.state;
    const aura = player.has("regenAura");
    if (state.maxMana > 0) {
      state.mana = Math.min(state.maxMana, state.mana + (MANA_REGEN + (aura ? AURA_MANA_REGEN : 0)) * dt);
    }
    if (state.maxEndurance > 0) {
      const regen = ENDURANCE_REGEN + (aura ? AURA_ENDURANCE_REGEN : 0);
      state.endurance = Math.min(state.maxEndurance, state.endurance + regen * dt);
    }
  }

  private updateCast(caster: PlayerRuntime, dt: number) {
    const state = caster.state;
    if (!state.castAbility) return;
    state.castElapsed = Math.min(state.castDuration, state.castElapsed + dt);
    if (state.castElapsed < state.castDuration) return;

    const ability = getAbility(state.castAbility)!;
    const targetId = caster.castTargetId!;
    this.endCast(caster);

    // Les conditions sont revérifiées à la fin : la cible a pu s'éloigner ou se cacher.
    const error =
      state[ability.resource] < ability.cost ? "Ressource insuffisante" : this.validateTarget(caster, ability, targetId);
    if (error) return this.sendError(caster, error);
    this.resolveAbility(caster, ability, targetId);
  }

  private updateAutoAttack(attacker: PlayerRuntime, dt: number) {
    // Le délai entre deux coups s'écoule même hors portée : le premier coup part dès le contact.
    attacker.swingTimer = Math.max(0, attacker.swingTimer - dt);
    if (!attacker.state.attacking || attacker.incapacitated) return;

    const target = attacker.targetId ? this.players.get(attacker.targetId) : undefined;
    if (!target?.alive || !this.areEnemies(attacker, target)) {
      attacker.state.attacking = false;
      return;
    }
    if (attacker.swingTimer > 0) return;
    if (!isInMeleeRange(attacker.state, target.state) || !hasLineOfSight(attacker.state, target.state)) return;
    if (!isFacing(attacker.state, target.state)) return;

    const auto = attacker.classDef.autoAttack;
    this.dealDamage(attacker, target, auto.damage, "auto", true);
    attacker.swingTimer = auto.interval;
  }

  // --- Compétences ---

  private checkCanUse(caster: PlayerRuntime, ability: AbilityDef, ignoreMovement = false): string | null {
    if (caster.incapacitated) return "Vous êtes neutralisé";
    if (caster.state.castAbility) return "Incantation déjà en cours";
    if ((caster.cooldowns.get(ability.id) ?? 0) > this.time) return "Compétence en recharge";
    if (caster.state[ability.resource] < ability.cost) {
      return ability.resource === "mana" ? "Pas assez de mana" : "Pas assez d'endurance";
    }
    if (ability.castTime > 0 && caster.isMoving && !ignoreMovement) return "Impossible d'incanter en mouvement";
    return null;
  }

  // Détermine la cible de la compétence selon son type.
  private pickTarget(caster: PlayerRuntime, ability: AbilityDef): string | null {
    if (ability.target === "self") return caster.id;
    const current = caster.targetId ? this.players.get(caster.targetId) : undefined;
    if (ability.target === "ally") {
      // Sans allié vivant ciblé, un soin ou un buff s'applique au lanceur.
      return current?.alive && !this.areEnemies(caster, current) ? current.id : caster.id;
    }
    return current?.id ?? null;
  }

  // Retourne le message d'erreur à afficher au joueur, ou null si la cible convient.
  private validateTarget(caster: PlayerRuntime, ability: AbilityDef, targetId: string): string | null {
    const target = this.players.get(targetId);
    if (!target) return "Cible introuvable";
    if (ability.target === "self") return null;

    const enemy = this.areEnemies(caster, target);
    if (ability.target === "enemy" && !enemy) return "Cible non hostile";
    if (ability.target !== "enemy" && enemy) return "Cible hostile";
    if (ability.target === "otherAlly" && target === caster) return "Ciblez un autre allié";
    if (ability.target === "deadAlly") {
      if (target.alive) return "La cible n'est pas morte";
    } else if (!target.alive) {
      return "La cible est morte";
    }

    if (target !== caster) {
      if (distance(caster.state, target.state) > ability.range) return "Cible hors de portée";
      if (!hasLineOfSight(caster.state, target.state)) return "Cible hors de vue";
    }
    if (isOffensive(ability) && !isFacing(caster.state, target.state)) return "Vous devez faire face à la cible";
    if (ability.position && positionRelativeTo(target.state, caster.state) !== ability.position) {
      return ability.position === "back" ? "Placez-vous dans le dos de la cible" : "Placez-vous sur le flanc de la cible";
    }
    return null;
  }

  private resolveAbility(caster: PlayerRuntime, ability: AbilityDef, targetId: string) {
    caster.state[ability.resource] -= ability.cost;
    const used: AbilityUsedEvent = { casterId: caster.id, abilityId: ability.id, targetId };
    this.out.broadcast("ability", used, [caster.id, targetId]);
    if (ability.cooldown > 0) {
      caster.cooldowns.set(ability.id, this.time + ability.cooldown);
      const event: CooldownEvent = { abilityId: ability.id, duration: ability.cooldown };
      this.out.sendTo(caster.id, "cooldown", event);
    }
    if (isOffensive(ability)) this.noteHostileAction(caster);

    for (const target of this.affectedBy(caster, ability, targetId)) {
      for (const effect of ability.effects) {
        // Les effets suivants ne s'appliquent pas à une cible tuée par le premier.
        if (!target.alive && effect.type !== "resurrect") break;
        this.applyEffect(caster, ability, target, effect);
      }
    }
  }

  // Cible unique, ou tous les personnages concernés dans la zone d'effet.
  private affectedBy(caster: PlayerRuntime, ability: AbilityDef, targetId: string): PlayerRuntime[] {
    const target = this.players.get(targetId);
    if (!target) return [];
    if (!ability.radius) return [target];

    const offensive = isOffensive(ability);
    const center = offensive ? target : caster;
    return [...this.players.values()].filter(
      (p) =>
        p.alive &&
        this.areEnemies(caster, p) === offensive &&
        distance(center.state, p.state) <= ability.radius! &&
        hasLineOfSight(center.state, p.state),
    );
  }

  private applyEffect(caster: PlayerRuntime, ability: AbilityDef, target: PlayerRuntime, effect: AbilityEffect) {
    switch (effect.type) {
      case "damage":
        this.dealDamage(caster, target, effect.amount, ability.id, !!ability.melee);
        break;
      case "heal":
        this.heal(caster, target, effect.amount, ability.id);
        break;
      case "cc":
        this.applyControl(caster, target, effect.cc, effect.duration, ability.id);
        break;
      case "snare":
        this.addEffect(target, "snare", effect.duration, caster.id, effect.slow);
        break;
      case "interrupt":
        this.noteHostileAction(target);
        if (target.state.castAbility && !target.castProtected) this.interrupt(target, "silence");
        break;
      case "cleanse":
        for (const kind of ["mez", "stun"] as const) {
          const control = target.getEffect(kind);
          if (control) this.removeEffect(target, control);
        }
        this.emit({ kind: "cleanse", sourceId: caster.id, targetId: target.id, abilityId: ability.id });
        break;
      case "resurrect":
        if (target.alive) break;
        target.state.hp = Math.round(target.state.maxHp * effect.hpRatio);
        this.emit({ kind: "resurrect", sourceId: caster.id, targetId: target.id, abilityId: ability.id });
        break;
      case "buff":
        this.addEffect(target, effect.buff, Infinity, caster.id);
        this.emit({ kind: "buff", sourceId: caster.id, targetId: target.id, abilityId: ability.id, detail: effect.buff });
        break;
      case "status":
        this.addEffect(target, effect.status, effect.duration, caster.id);
        break;
      case "guard":
        this.toggleGuard(caster, target, ability.id);
        break;
      case "intercept":
        this.addEffect(target, "intercept", effect.duration, caster.id);
        break;
      case "toggleSong":
        caster.state.songActive = !caster.state.songActive;
        break;
    }
  }

  // Un Gardien ne protège qu'un allié à la fois ; regarder le même allié retire la garde.
  private toggleGuard(guardian: PlayerRuntime, target: PlayerRuntime, abilityId: string) {
    let wasGuardingTarget = false;
    for (const p of this.players.values()) {
      const guard = p.getEffect("guarded");
      if (guard?.sourceId !== guardian.id) continue;
      if (p === target) wasGuardingTarget = true;
      this.removeEffect(p, guard);
    }
    if (wasGuardingTarget) {
      this.emit({ kind: "unguard", sourceId: guardian.id, targetId: target.id, abilityId });
      return;
    }
    this.addEffect(target, "guarded", Infinity, guardian.id);
    this.emit({ kind: "guard", sourceId: guardian.id, targetId: target.id, abilityId });
  }

  // --- Dégâts, soins, contrôles ---

  private dealDamage(source: PlayerRuntime, target: PlayerRuntime, amount: number, abilityId: string, melee: boolean) {
    if (!target.alive) return;
    this.noteHostileAction(source);
    this.noteHostileAction(target);

    // Interception : le Gardien prend le coup s'il est assez proche.
    const intercept = target.getEffect("intercept");
    const interceptor = intercept ? this.players.get(intercept.sourceId) : undefined;
    if (intercept && interceptor?.alive && distance(interceptor.state, target.state) <= INTERCEPT_RANGE) {
      this.removeEffect(target, intercept);
      this.emit({ kind: "intercepted", sourceId: source.id, targetId: interceptor.id, abilityId, detail: target.id });
      target = interceptor;
    }

    let crit = false;
    if (melee) {
      target.lastMeleeHitAt = this.time;
      target.lastMeleeAttackerId = source.id;
      const avoided = this.avoidMelee(source, target, abilityId);
      if (avoided) return;
      if (source.has("buffStrength")) amount *= 1 + STRENGTH_BUFF_BONUS;
      crit = source.has("rage") || this.random() < CRIT_CHANCE;
      if (crit) amount *= CRIT_MULTIPLIER;
    }
    amount = Math.round(amount);

    const state = target.state;
    state.hp = Math.max(0, state.hp - amount);
    const killed = state.hp === 0;
    this.emit({ kind: "damage", sourceId: source.id, targetId: target.id, abilityId, amount, crit, killed });

    if (killed) {
      this.handleDeath(target);
      return;
    }
    // Tout dégât interrompt l'incantation (sauf Concentration) et brise mez et root.
    if (state.castAbility && !target.castProtected) this.interrupt(target, "damage");
    for (const kind of ["mez", "root"] as const) {
      const control = target.getEffect(kind);
      if (control) this.removeEffect(target, control);
    }
  }

  // Esquive, bulle, bouclier puis garde. Retourne vrai si le coup est évité.
  private avoidMelee(source: PlayerRuntime, target: PlayerRuntime, abilityId: string): boolean {
    const base = { sourceId: source.id, targetId: target.id, abilityId };
    if (target.has("evasion") && this.random() < EVASION_CHANCE) {
      this.emit({ kind: "evaded", ...base });
      return true;
    }
    if (target.classDef.passives.includes("bubble") && this.time >= target.bubbleReadyAt) {
      target.bubbleReadyAt = this.time + BUBBLE_COOLDOWN;
      this.emit({ kind: "absorbed", ...base });
      return true;
    }
    if (target.classDef.passives.includes("shieldBlock") && this.random() < SHIELD_BLOCK_CHANCE) {
      this.emit({ kind: "blocked", ...base, detail: target.id });
      return true;
    }
    const guard = target.getEffect("guarded");
    const guardian = guard ? this.players.get(guard.sourceId) : undefined;
    if (
      guardian?.alive &&
      !guardian.incapacitated &&
      distance(guardian.state, target.state) <= GUARD_RANGE &&
      this.random() < GUARD_BLOCK_CHANCE
    ) {
      this.emit({ kind: "blocked", ...base, detail: guardian.id });
      return true;
    }
    return false;
  }

  private heal(source: PlayerRuntime, target: PlayerRuntime, amount: number, abilityId: string) {
    const healed = Math.min(amount, target.state.maxHp - target.state.hp);
    target.state.hp += healed;
    this.emit({ kind: "heal", sourceId: source.id, targetId: target.id, abilityId, amount: healed });
  }

  private applyControl(source: PlayerRuntime, target: PlayerRuntime, cc: CrowdControl, duration: number, abilityId: string) {
    this.noteHostileAction(target);
    const immunity = IMMUNITY_EFFECTS[cc];
    if (target.has(immunity)) {
      this.emit({ kind: "immune", sourceId: source.id, targetId: target.id, abilityId, detail: cc });
      return;
    }
    this.addEffect(target, cc, duration, source.id);
    // L'immunité démarre dès l'application : impossible de prolonger le contrôle en le relançant.
    // Elle couvre la durée du contrôle, puis IMMUNITY_DURATION de répit après sa fin normale.
    this.addEffect(target, immunity, duration + IMMUNITY_DURATION, source.id);
    if (cc !== "root" && target.state.castAbility) this.interrupt(target, "cc");
    this.emit({ kind: "cc", sourceId: source.id, targetId: target.id, abilityId, detail: cc });
  }

  private handleDeath(player: PlayerRuntime) {
    const state = player.state;
    state.attacking = false;
    state.songActive = false;
    state.lock = "";
    player.input = NO_INPUT;
    this.endCast(player);
    for (const effect of [...player.effects]) this.removeEffect(player, effect);
    this.removeLinkedEffects(player);
  }

  // Retire les buffs, gardes et interceptions qu'un joueur avait posés sur les autres.
  private removeLinkedEffects(source: PlayerRuntime) {
    for (const p of this.players.values()) {
      for (const effect of [...p.effects]) {
        if (effect.sourceId === source.id && LINKED_EFFECTS.includes(effect.kind)) this.removeEffect(p, effect);
      }
    }
  }

  // Le chant du Barde se coupe un moment quand il attaque ou est attaqué.
  private noteHostileAction(player: PlayerRuntime) {
    if (player.classDef.id === "barde") player.songSuppressedUntil = this.time + SONG_SUPPRESS_DURATION;
  }

  // --- Effets ---

  private updateEffectTimers(player: PlayerRuntime, dt: number) {
    for (const effect of [...player.effects]) {
      if (!Number.isFinite(effect.remaining)) continue;
      effect.remaining -= dt;
      if (effect.remaining <= 0) this.removeEffect(player, effect);
      else effect.view.remaining = effect.remaining;
    }
  }

  // Effets qui dépendent de la situation : chant du Barde, aura du Prêtre, bulle prête.
  private updateDerivedEffects(player: PlayerRuntime) {
    const allies = [...this.players.values()].filter((p) => p.alive && !this.areEnemies(p, player));
    const near = (p: PlayerRuntime, range: number) => distance(p.state, player.state) <= range;

    this.setDerivedEffect(
      player,
      "speed",
      allies.some(
        (p) => p.classDef.id === "barde" && p.state.songActive && this.time >= p.songSuppressedUntil && near(p, SONG_RANGE),
      ),
    );
    this.setDerivedEffect(
      player,
      "regenAura",
      allies.some((p) => p.classDef.passives.includes("regenAura") && near(p, AURA_RANGE)),
    );
    this.setDerivedEffect(
      player,
      "bubble",
      player.classDef.passives.includes("bubble") && this.time >= player.bubbleReadyAt,
    );
  }

  private setDerivedEffect(player: PlayerRuntime, kind: EffectKind, active: boolean) {
    const effect = player.getEffect(kind);
    if (active && !effect) this.addEffect(player, kind, Infinity, player.id);
    if (!active && effect) this.removeEffect(player, effect);
  }

  // Un effet déjà présent est rafraîchi plutôt que cumulé.
  private addEffect(player: PlayerRuntime, kind: EffectKind, duration: number, sourceId: string, value = 0) {
    const existing = player.getEffect(kind);
    if (existing) {
      existing.remaining = duration;
      existing.sourceId = sourceId;
      existing.value = value;
      existing.view.remaining = Number.isFinite(duration) ? duration : PERMANENT;
      existing.view.source = sourceId;
      return;
    }
    const view = new EffectState();
    view.kind = kind;
    view.remaining = Number.isFinite(duration) ? duration : PERMANENT;
    view.source = sourceId;
    player.state.effects.push(view);
    player.effects.push({ kind, remaining: duration, sourceId, value, view });

    if (kind === "buffHp") {
      player.state.maxHp += HP_BUFF_AMOUNT;
      player.state.hp += HP_BUFF_AMOUNT;
    }
  }

  private removeEffect(player: PlayerRuntime, effect: ActiveEffect) {
    player.effects = player.effects.filter((e) => e !== effect);
    const index = player.state.effects.indexOf(effect.view);
    if (index >= 0) player.state.effects.splice(index, 1);

    if (effect.kind === "buffHp") {
      player.state.maxHp -= HP_BUFF_AMOUNT;
      player.state.hp = Math.min(player.state.hp, player.state.maxHp);
    }
  }

  // --- Utilitaires ---

  private interrupt(caster: PlayerRuntime, reason: InterruptReason) {
    const event: InterruptEvent = { casterId: caster.id, abilityId: caster.state.castAbility, reason };
    this.endCast(caster);
    this.out.broadcast("interrupt", event, [caster.id]);
  }

  private endCast(caster: PlayerRuntime) {
    caster.state.castAbility = "";
    caster.state.castElapsed = 0;
    caster.state.castDuration = 0;
    caster.castTargetId = null;
    caster.castProtected = false;
  }

  private areEnemies(a: PlayerRuntime, b: PlayerRuntime): boolean {
    return a.state.team !== b.state.team;
  }

  private emit(event: CombatEvent) {
    this.out.broadcast("combat", event, [event.sourceId, event.targetId]);
  }

  private sendError(player: PlayerRuntime, message: string) {
    this.out.sendTo(player.id, "error", { message });
  }
}
