import {
  ARMOR_BREAK_BONUS,
  CHARGE_MAX_DURATION,
  CHARGE_SPEED_MULTIPLIER,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  DEXTERITY_FACTOR,
  DOT_INTERVAL,
  ENDURANCE_REGEN,
  EVASION_CHANCE,
  GANGRENE_HEAL_FACTOR,
  GUARD_BLOCK_CHANCE,
  GUARD_RANGE,
  HOT_INTERVAL,
  HP_BUFF_AMOUNT,
  IMMUNITY_DURATION,
  INTERCEPT_RANGE,
  MOVE_SPEED,
  RAMPART_RADIUS,
  MANA_REGEN,
  NEAR_SIGHT_FACTOR,
  NO_INPUT,
  PERMANENT,
  SECOND_WIND_ENDURANCE_REGEN,
  SECOND_WIND_MANA_REGEN,
  SHIELD_BLOCK_CHANCE,
  SONG_RANGE,
  SONG_SPEED_CALM,
  STRENGTH_BUFF_BONUS,
  TAUNT_DAMAGE_FACTOR,
  TAUNT_HALT_DURATION,
  distance,
  facingTowards,
  getAbility,
  hasLineOfSight,
  isFacing,
  movesBody,
  isInMeleeRange,
  isMagic,
  isOffensive,
  ignoresLineOfSight,
  positionRelativeTo,
  revivesInArea,
  stepMovement,
  simulateMovement,
  lockReleased,
  type AbilityDef,
  type AbilityEffect,
  type AbilityUsedEvent,
  type CombatEvent,
  type CooldownEvent,
  type SwingEvent,
  type CrowdControl,
  type EffectKind,
  type GameErrorCode,
  type GameErrorMessage,
  type InterruptEvent,
  type InterruptReason,
  type KillEvent,
  lastStandBonus,
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
  // À tous les joueurs, sans tenir compte de ce qu'ils voient (annonce des éliminations).
  announce?(type: string, message: unknown): void;
}

// Immunité associée à chaque type de contrôle.
const IMMUNITY_EFFECTS: Record<CrowdControl, EffectKind> = { mez: "immuneMez", stun: "immuneStun", root: "immuneRoot" };

// Effets posés par un joueur sur d'autres, qui disparaissent à sa mort ou à son départ.
const LINKED_EFFECTS: EffectKind[] = ["buffHp", "buffStrength", "buffDexterity", "guarded", "intercept", "taunted"];

// Un combo se perd si le coup d'arme suivant part plus de COMBO_GRACE secondes après l'heure prévue (cible hors de
// portée, de face…) : c'est un round d'attaque manqué.
const COMBO_GRACE = 0.5;

// Distance à laquelle la Charge s'arrête devant sa cible (bien à portée de mêlée).
const CHARGE_STOP_DISTANCE = 1.5;

// Contrôles que le Cri de ralliement retire quand ils viennent d'un sort.
const MAGIC_CONTROLS: EffectKind[] = ["mez", "stun", "root", "snare", "oblivion"];

// Effets de mobilité dont la Ballade rythmée protège (et qu'elle retire).
const MOBILITY_EFFECTS: EffectKind[] = ["root", "snare"];

// Toutes les règles de combat. La salle Colyseus ne fait que lui transmettre les commandes.
// Comment une attaque de mêlée a été évitée (null : elle porte).
type Avoidance = "evaded" | "absorbed" | "blocked" | "immune" | null;

export class CombatSystem {
  readonly players = new Map<string, PlayerRuntime>();
  // Positions des joueurs au début du tic en cours.
  private tickStart = new Map<string, Position>();
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

  // seq : numéro de la commande envoyée par le client (prédiction de son déplacement) ; absent pour les bots.
  setInput(id: string, input: MoveInput, seq?: number) {
    const player = this.players.get(id);
    if (!player) return;
    player.input = input;
    if (seq !== undefined) {
      player.state.inputSeq = seq;
      player.state.inputTime = 0;
    }
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
    if (!target?.alive) return this.sendError(player, "noTarget");
    // Rooté, on peut quand même suivre : le personnage fait face à la cible et avance dès que le root le permet.
    if (player.incapacitated) return;
    player.state.lock = lock;
  }

  toggleAttack(id: string) {
    const player = this.players.get(id);
    if (!player?.alive) return;
    player.state.attacking = !player.state.attacking;
    if (player.state.attacking) {
      this.noteAction(player);
      if (player.targetId) this.turnTowardsEnemy(player, player.targetId);
    }
    // Couper l'attaque annule la technique en attente et l'enchaînement d'un combo.
    if (!player.state.attacking) {
      player.state.queuedAbility = "";
      this.clearCombo(player);
    }
    else this.sendSwing(player, false);
  }

  // Se tourner tout seul vers l'ennemi visé (décidé le 2026-11-19, pour les débutants) : en lançant une compétence
  // contre lui ou en activant l'attaque, le personnage qui ne lui fait pas face pivote une fois vers lui, comme un /face
  // automatique. Pas de verrou : il peut se détourner ensuite. Pas sous mez ni stun (rooté, il peut pivoter).
  private turnTowardsEnemy(player: PlayerRuntime, targetId: string) {
    const target = this.players.get(targetId);
    if (!target?.alive || !this.areEnemies(player, target) || player.incapacitated) return;
    if (isFacing(player.state, target.state)) return;
    player.state.facing = facingTowards(player.state, target.state);
    // Clic droit tenu : la commande impose l'orientation de la souris à chaque tic ; elle suit la rotation jusqu'à la
    // prochaine commande (le client tourne aussi sa caméra vers la cible avant d'envoyer la compétence).
    if (player.input.steer) player.input = { ...player.input, yaw: player.state.facing };
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
    return !!targetId && !this.validateTarget(caster, ability, targetId) && !this.comboError(ability, caster.state.comboAbility, caster.state.comboTarget, targetId);
  }

  useAbility(casterId: string, abilityId: string) {
    const caster = this.players.get(casterId);
    const ability = getAbility(abilityId);
    if (!caster?.alive || !ability || !caster.classDef.abilities.includes(abilityId)) return;

    // Suivre sa cible (C), c'est bouger : pas d'incantation tant que le suivi fait avancer. Mais lancer un sort à
    // incantation lâche le suivi (décidé le 2026-11-21) : si seul le suivi le faisait bouger, ce mouvement ne bloque pas
    // le sort ; le suivi n'est lâché qu'au démarrage réel de l'incantation (un sort refusé, hors de portée par exemple,
    // le laisse en place).
    const onlyStickMoves = caster.state.lock === "stick" && !movesBody(caster.input);
    const error = this.checkCanUse(caster, ability, onlyStickMoves);
    if (error) return this.sendError(caster, error);

    const targetId = this.pickTarget(caster, ability);
    if (!targetId) return this.sendError(caster, "noTarget");
    if (ability.target === "enemy") this.turnTowardsEnemy(caster, targetId);

    // Technique de mêlée : mise en attente du prochain coup d'arme, qui part aussitôt si l'arme est prête.
    // Ses conditions (portée, position, endurance) sont vérifiées au moment du coup.
    if (ability.melee) {
      const target = this.players.get(targetId);
      if (!target?.alive) return this.sendError(caster, "targetDead");
      if (!this.areEnemies(caster, target)) return this.sendError(caster, "notHostile");
      const comboError = this.comboError(ability, caster.state.comboAbility, caster.state.comboTarget, targetId);
      if (comboError) return this.sendError(caster, comboError, ability.after);
      this.noteAction(caster);
      caster.state.queuedAbility = ability.id;
      caster.state.attacking = true;
      this.updateAutoAttack(caster, 0);
      return;
    }

    const targetError = this.validateTarget(caster, ability, targetId);
    if (targetError) return this.sendError(caster, targetError);
    // Ballade rythmée : agir (autre chose que se déplacer) la fait perdre ; couper son chant ne compte pas.
    // Chant de vitesse : lancer ou couper un chant ne compte pas comme une action.
    if (!this.stopsSong(caster, ability)) this.endBallad(caster);
    if (!isSong(ability)) caster.lastEngagedAt = this.time;

    if (ability.castTime === 0) {
      this.resolveAbility(caster, ability, targetId);
      return;
    }
    // L'incantation lâche le suivi (C) : sinon, la cible qui s'éloigne ferait avancer le lanceur et l'interromprait.
    if (caster.state.lock === "stick") caster.state.lock = "";
    // Concentration protège la prochaine incantation, puis disparaît.
    const concentration = caster.getEffect("concentration");
    caster.castProtected = !!concentration;
    if (concentration) this.removeEffect(caster, concentration);

    caster.state.castAbility = ability.id;
    caster.state.castElapsed = 0;
    // Buff dextérité : incantation plus rapide.
    caster.state.castDuration = ability.castTime * this.dexterityFactor(caster);
    caster.castTargetId = targetId;
  }

  // --- Simulation ---

  tick(dt: number) {
    this.time += dt;
    const alive = [...this.players.values()].filter((p) => p.alive);
    for (const p of alive) this.updateEffectTimers(p, dt);
    for (const p of alive) this.updateDerivedEffects(p);
    // Le verrou F/C vise la cible là où elle était au début du tic, quel que soit l'ordre des déplacements : le client
    // prédit son propre déplacement de la même façon.
    this.tickStart = new Map(alive.map((p) => [p.id, { x: p.state.x, z: p.state.z }]));
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
    // Temps passé sous la dernière commande reçue : le client en déduit ce qu'il lui reste à rejouer (prédiction).
    // Pas pour les bots, qui n'envoient pas de commandes numérotées (inutile de synchroniser ce champ à chaque tic).
    if (state.inputSeq > 0) state.inputTime += dt;
    if (player.charge) return this.updateCharge(player, dt);
    this.updateLock(player);
    if (player.incapacitated) return;

    // Même calcul que la prédiction du client (voir simulateMovement). Pivoter n'interrompt pas l'incantation.
    const target = state.lock && player.targetId ? this.players.get(player.targetId) : undefined;
    const confine = this.confine;
    const next = simulateMovement(state, player.input, dt, {
      effects: player.effects,
      lock: state.lock,
      target: target ? (this.tickStart.get(target.id) ?? target.state) : null,
      confine: confine ? (pos) => confine(player, pos) : null,
    });
    state.facing = next.facing;
    player.stickMoving = next.stickMoving;
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
    if (lockReleased(player.input, !!target?.alive, player.effects)) state.lock = "";
  }

  private updateRegen(player: PlayerRuntime, dt: number) {
    const state = player.state;
    // Chant de second souffle d'un Barde proche : régénération en plus.
    const song = player.has("secondWind");
    if (state.maxMana > 0) {
      state.mana = Math.min(state.maxMana, state.mana + (MANA_REGEN + (song ? SECOND_WIND_MANA_REGEN : 0)) * dt);
    }
    if (state.maxEndurance > 0) {
      const regen = ENDURANCE_REGEN + (song ? SECOND_WIND_ENDURANCE_REGEN : 0);
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
    // La fin d'une incantation est une action, même si le sort ne part pas (Chant de vitesse).
    caster.lastEngagedAt = this.time;

    // Les conditions sont revérifiées à la fin : la cible a pu s'éloigner ou se cacher.
    const error =
      state[ability.resource] < this.costOf(caster, ability) ? (ability.resource === "mana" ? "noMana" : "noEndurance") : this.validateTarget(caster, ability, targetId);
    if (error) return this.sendError(caster, error);
    // Un sort commencé avant la Ballade rythmée la fait perdre en partant.
    this.noteAction(caster);
    this.resolveAbility(caster, ability, targetId);
  }

  private updateAutoAttack(attacker: PlayerRuntime, dt: number) {
    // Le délai entre deux coups s'écoule même hors portée : le premier coup part dès le contact.
    attacker.swingTimer = Math.max(0, attacker.swingTimer - dt);
    if (attacker.state.comboAbility && this.time > attacker.comboExpiresAt) this.clearCombo(attacker);
    if (!attacker.state.attacking || attacker.incapacitated) return;

    const target = attacker.targetId ? this.players.get(attacker.targetId) : undefined;
    if (!target?.alive || !this.areEnemies(attacker, target)) {
      attacker.state.attacking = false;
      return;
    }
    if (attacker.swingTimer > 0) return;
    if (!isInMeleeRange(attacker.state, target.state) || !hasLineOfSight(attacker.state, target.state)) return;
    if (!isFacing(attacker.state, target.state)) return;

    // Buff dextérité : coups d'arme plus rapprochés.
    const interval = attacker.classDef.autoAttack.interval * this.dexterityFactor(attacker);
    attacker.swingTimer = interval;
    this.noteAction(attacker);
    this.sendSwing(attacker, true);
    // Une technique en attente remplace le coup normal ; si ses conditions ne sont pas remplies, le coup reste normal.
    const queued = attacker.state.queuedAbility ? getAbility(attacker.state.queuedAbility) : undefined;
    attacker.state.queuedAbility = "";
    // Un combo ne suit que la technique qui a porté au coup d'arme précédent : chaque coup remet l'enchaînement à zéro.
    const opener = attacker.state.comboAbility;
    const openerTargetId = attacker.state.comboTarget;
    this.clearCombo(attacker);
    if (queued) {
      const error =
        this.checkCanUse(attacker, queued, true) ??
        this.validateTarget(attacker, queued, target.id) ??
        this.comboError(queued, opener, openerTargetId, target.id);
      if (!error) {
        if (this.resolveAbility(attacker, queued, target.id)) {
          attacker.state.comboAbility = queued.id;
          attacker.state.comboTarget = target.id;
          attacker.comboExpiresAt = this.time + interval + COMBO_GRACE;
        }
        return;
      }
      this.sendError(attacker, error, error === "combo" ? queued.after : undefined);
    }
    this.dealDamage(attacker, target, attacker.classDef.autoAttack.damage, "auto", true);
  }

  // --- Compétences ---

  private checkCanUse(caster: PlayerRuntime, ability: AbilityDef, ignoreMovement = false): GameErrorCode | null {
    if (caster.incapacitated) return "incapacitated";
    if (caster.charge) return "charging";
    if (ability.effects.some((e) => e.type === "charge") && caster.has("root")) return "rooted";
    if (caster.state.castAbility) return "alreadyCasting";
    if (caster.has("silenced") && isMagic(ability)) return "silenced";
    if ((caster.cooldowns.get(ability.id) ?? 0) > this.time) return "cooldown";
    if (caster.state[ability.resource] < this.costOf(caster, ability)) {
      return ability.resource === "mana" ? "noMana" : "noEndurance";
    }
    if (ability.castTime > 0 && caster.isMoving && !ignoreMovement) return "castWhileMoving";
    return null;
  }

  // Couper son chant ne coûte rien : seule l'activation se paie.
  private costOf(caster: PlayerRuntime, ability: AbilityDef): number {
    return this.stopsSong(caster, ability) ? 0 : ability.cost;
  }

  private stopsSong(caster: PlayerRuntime, ability: AbilityDef): boolean {
    return caster.state.song === ability.id && ability.effects.some((e) => e.type === "toggleSong");
  }

  private dexterityFactor(player: PlayerRuntime): number {
    return player.has("buffDexterity") ? DEXTERITY_FACTOR : 1;
  }

  // Agir (attaquer, lancer une compétence ; pas se déplacer) : la Ballade rythmée se perd, et le Chant de vitesse
  // attend SONG_SPEED_CALM secondes de calme.
  private noteAction(player: PlayerRuntime) {
    this.endBallad(player);
    player.lastEngagedAt = this.time;
  }

  // Ballade rythmée : elle se perd dès qu'on agit (attaquer, lancer une compétence) ; se déplacer ne compte pas.
  private endBallad(player: PlayerRuntime) {
    const ballad = player.getEffect("ballad");
    if (ballad) this.removeEffect(player, ballad);
  }

  private clearCombo(player: PlayerRuntime) {
    player.state.comboAbility = "";
    player.state.comboTarget = "";
  }

  // Combo : la technique d'ouverture (opener) doit avoir porté sur la même cible au coup d'arme précédent.
  private comboError(ability: AbilityDef, opener: string, openerTargetId: string, targetId: string): GameErrorCode | null {
    if (!ability.after || (opener === ability.after && openerTargetId === targetId)) return null;
    return "combo";
  }

  // Détermine la cible de la compétence selon son type.
  private pickTarget(caster: PlayerRuntime, ability: AbilityDef): string | null {
    if (ability.target === "self" || ability.target === "enemiesAround") return caster.id;
    const current = caster.targetId ? this.players.get(caster.targetId) : undefined;
    if (ability.target === "ally") {
      // Sans allié vivant ciblé, un soin ou un buff s'applique au lanceur.
      return current?.alive && !this.areEnemies(caster, current) ? current.id : caster.id;
    }
    return current?.id ?? null;
  }

  // Retourne la raison du refus à envoyer au joueur, ou null si la cible convient.
  private validateTarget(caster: PlayerRuntime, ability: AbilityDef, targetId: string): GameErrorCode | null {
    const target = this.players.get(targetId);
    if (!target) return "targetNotFound";
    // Intervention divine : il faut au moins un allié mort dans la zone.
    if (revivesInArea(ability) && this.affectedBy(caster, ability, targetId).length === 0) {
      return "noDeadAllyInRange";
    }
    if (ability.target === "self" || ability.target === "enemiesAround") return null;

    const enemy = this.areEnemies(caster, target);
    if (ability.target === "enemy" && !enemy) return "notHostile";
    if (ability.target !== "enemy" && enemy) return "hostile";
    if (ability.target === "otherAlly" && target === caster) return "needOtherAlly";
    if (ability.target === "deadAlly") {
      if (target.alive) return "targetNotDead";
    } else if (!target.alive) {
      return "targetDead";
    }

    if (target !== caster) {
      // Near sight : la portée des sorts du lanceur est réduite (une incantation finit donc hors de portée).
      const reduced = isMagic(ability) && caster.has("nearSight");
      const range = reduced ? ability.range * NEAR_SIGHT_FACTOR : ability.range;
      if (distance(caster.state, target.state) > range) return reduced ? "outOfRangeNearSight" : "outOfRange";
      if (ability.minRange && distance(caster.state, target.state) < ability.minRange) return "tooClose";
      if (!hasLineOfSight(caster.state, target.state)) return "noLineOfSight";
    }
    if (isOffensive(ability) && !isFacing(caster.state, target.state)) return "notFacing";
    if (ability.position && positionRelativeTo(target.state, caster.state) !== ability.position) {
      return ability.position === "back" ? "needBack" : "needSide";
    }
    return null;
  }

  // Retourne vrai si une attaque de mêlée a porté sur sa cible (ni évitée ni interceptée) : elle ouvre un combo.
  private resolveAbility(caster: PlayerRuntime, ability: AbilityDef, targetId: string): boolean {
    caster.state[ability.resource] -= this.costOf(caster, ability);
    if (ability.cooldown > 0) {
      caster.cooldowns.set(ability.id, this.time + ability.cooldown);
      const event: CooldownEvent = { abilityId: ability.id, duration: ability.cooldown };
      this.out.sendTo(caster.id, "cooldown", event);
    }
    // Oubli : le premier sort fini pendant l'effet n'a aucun effet (mana dépensé, recharge lancée) et le consomme.
    // Couper son chant n'est pas un sort lancé.
    const oblivion = isMagic(ability) && !this.stopsSong(caster, ability) ? caster.getEffect("oblivion") : undefined;
    if (oblivion) {
      this.removeEffect(caster, oblivion);
      return false;
    }
    const used: AbilityUsedEvent = { casterId: caster.id, abilityId: ability.id, targetId };
    this.out.broadcast("ability", used, [caster.id, targetId]);

    const center = this.areaCenter(caster, ability, targetId);
    const affected = this.affectedBy(caster, ability, targetId);
    const split = ability.effects.find((effect) => effect.type === "splitHeal");
    const shares = split ? this.splitHealShares(caster, split.amount, affected) : undefined;
    // Technique de mêlée ou coup instantané (Coup de pied) : un coup d'arme, qui peut être évité.
    const meleeAttack = !!ability.melee || !!ability.meleeStrike;
    let landed = false;
    const offensive = isOffensive(ability);
    for (const reached of affected) {
      let target = reached;
      // Pris pour cible par une attaque ou un effet hostile, même évité : le Chant de vitesse attend le calme.
      if (offensive) target.lastEngagedAt = this.time;
      if (meleeAttack) {
        // Attaque spéciale de mêlée : un Gardien qui intercepte la prend en entier à la place de sa cible (dégâts et
        // effets : silence, poison, affaiblissements…). Puis l'évitement est tranché une fois, avant ses effets :
        // esquivée, bloquée au bouclier ou absorbée par une bulle, elle s'arrête en entier.
        const interceptor = this.interceptorOf(target);
        if (interceptor) {
          this.removeEffect(target, target.getEffect("intercept")!);
          this.emit({ kind: "intercepted", sourceId: caster.id, targetId: interceptor.id, abilityId: ability.id, detail: target.id });
          target = interceptor;
          target.lastEngagedAt = this.time;
        }
        if (this.meleeAvoidance(caster, target, ability.id)) continue;
        // Un coup intercepté n'ouvre pas de combo : il n'a pas porté sur sa cible.
        if (!interceptor) landed = true;
      }
      for (const effect of ability.effects) {
        // Les effets suivants ne s'appliquent pas à une cible tuée par le premier.
        if (!target.alive && effect.type !== "resurrect") break;
        this.applyEffect(caster, ability, target, withFalloff(effect, ability, center, target), meleeAttack, shares);
      }
    }
    return landed;
  }

  // Soin réparti (Soin de groupe) : le total, augmenté par le buff de puissance, est partagé au prorata des points de
  // vie qui manquent à chacun ; personne n'en reçoit plus qu'il ne lui en manque, le surplus est perdu.
  private splitHealShares(caster: PlayerRuntime, amount: number, targets: PlayerRuntime[]): Map<string, number> {
    const shares = new Map<string, number>();
    const total = amount * this.powerFactor(caster);
    const missing = targets.map((p) => Math.max(0, p.state.maxHp - p.state.hp));
    const totalMissing = missing.reduce((sum, value) => sum + value, 0);
    targets.forEach((p, i) => {
      // Arrondi à l'unité inférieure : le total distribué ne dépasse jamais le soin.
      shares.set(p.id, totalMissing <= total ? missing[i] : Math.floor((total * missing[i]) / totalMissing));
    });
    return shares;
  }

  // Règle du dernier carré active (coupée dans la plupart des tests, qui opposent des équipes de tailles différentes).
  lastStandRule = true;

  // Bonus de dégâts du dernier carré de l'équipe team, d'après les survivants des deux équipes (voir lastStandBonus).
  private lastStand(team: number): number {
    if (!this.lastStandRule) return 0;
    let own = 0;
    let other = 0;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.state.team === team) own++;
      else other++;
    }
    return lastStandBonus(own, other);
  }

  // Bonus du buff de puissance, sur les dégâts comme sur les soins du lanceur.
  private powerFactor(source: PlayerRuntime): number {
    return source.has("buffStrength") ? 1 + STRENGTH_BUFF_BONUS : 1;
  }

  // Gardien qui intercepte le prochain coup visant la cible, s'il est vivant et assez proche.
  private interceptorOf(target: PlayerRuntime): PlayerRuntime | undefined {
    const intercept = target.getEffect("intercept");
    const interceptor = intercept ? this.players.get(intercept.sourceId) : undefined;
    return intercept && interceptor?.alive && distance(interceptor.state, target.state) <= INTERCEPT_RANGE ? interceptor : undefined;
  }

  // Évitement d'une attaque spéciale de mêlée (cible déjà remplacée par son intercepteur), avant ses effets.
  private meleeAvoidance(source: PlayerRuntime, target: PlayerRuntime, abilityId: string): Avoidance {
    target.lastMeleeHitAt = this.time;
    target.lastMeleeAttackerId = source.id;
    return this.avoidMelee(source, target, abilityId);
  }

  // Centre d'une zone d'effet : la cible pour une compétence visant un ennemi, le lanceur sinon.
  private areaCenter(caster: PlayerRuntime, ability: AbilityDef, targetId: string): PlayerRuntime {
    return ability.target === "enemy" ? (this.players.get(targetId) ?? caster) : caster;
  }

  // Cible unique, ou tous les personnages concernés dans la zone d'effet.
  private affectedBy(caster: PlayerRuntime, ability: AbilityDef, targetId: string): PlayerRuntime[] {
    const target = this.players.get(targetId);
    if (!target) return [];
    if (!ability.radius) return [target];

    const offensive = isOffensive(ability);
    // Une compétence qui ressuscite (Intervention divine) touche les alliés morts de la zone.
    const revives = revivesInArea(ability);
    const center = this.areaCenter(caster, ability, targetId);
    // Une déflagration autour du lanceur touche tout ce qui est dans le rayon, obstacles compris ; de même, le Soin de
    // groupe soigne et l'Intervention divine relève tous les alliés de la zone, même derrière un obstacle.
    const throughWalls = ignoresLineOfSight(ability);
    return [...this.players.values()].filter(
      (p) =>
        p.alive !== revives &&
        this.areEnemies(caster, p) === offensive &&
        distance(center.state, p.state) <= ability.radius! &&
        (throughWalls || hasLineOfSight(center.state, p.state)),
    );
  }

  private applyEffect(
    caster: PlayerRuntime,
    ability: AbilityDef,
    target: PlayerRuntime,
    effect: AbilityEffect,
    avoidanceDone = false,
    // Parts du Soin de groupe, par joueur (voir splitHealShares).
    shares?: Map<string, number>,
  ) {
    const magic = isMagic(ability);
    switch (effect.type) {
      case "damage":
        this.dealDamage(caster, target, effect.amount, ability.id, !!ability.melee || !!ability.meleeStrike, avoidanceDone);
        break;
      case "dot": {
        // Relancer la Brûlure (ou le Poison) la fait repartir de zéro.
        const ticks = Math.round(effect.duration / DOT_INTERVAL);
        const dot = this.addEffect(target, effect.effect ?? "burning", effect.duration, caster.id, effect.amount / ticks);
        dot.ticks = { abilityId: ability.id, done: 0, total: ticks, kind: "damage" };
        if (effect.effect === "poisoned") this.emit({ kind: "debuff", sourceId: caster.id, targetId: target.id, abilityId: ability.id, detail: "poisoned" });
        break;
      }
      case "silence":
        // Contrôle physique quand il vient d'une compétence d'endurance (Coup de pied) : le Cri de ralliement n'en
        // protège pas. Ni immunité ensuite, ni cassé par les dégâts ; relancé, il repart de sa durée.
        if (magic && this.resistsMagic(caster, target, ability.id)) break;
        this.addEffect(target, "silenced", effect.duration, caster.id, 0, magic);
        // Le chant du Barde se tait : il ne peut pas le relancer tant que dure le silence (c'est une compétence à mana),
        // et devra repayer son activation ensuite.
        target.state.song = "";
        if (target.state.castAbility && !target.castProtected) this.interrupt(target, "silence");
        this.emit({ kind: "cc", sourceId: caster.id, targetId: target.id, abilityId: ability.id, detail: "silenced" });
        break;
      case "debuff":
        this.addEffect(target, effect.debuff, effect.duration, caster.id);
        this.emit({ kind: "debuff", sourceId: caster.id, targetId: target.id, abilityId: ability.id, detail: effect.debuff });
        break;
      case "oblivion":
        // Contrôle magique (le Cri de ralliement en protège et le retire). Il n'interrompt pas : une incantation en
        // cours qui se termine pendant l'effet est le sort oublié. Relancé, il repart de sa durée.
        if (magic && this.resistsMagic(caster, target, ability.id)) break;
        this.addEffect(target, "oblivion", effect.duration, caster.id, 0, magic);
        this.emit({ kind: "cc", sourceId: caster.id, targetId: target.id, abilityId: ability.id, detail: "oblivion" });
        break;
      case "ballad":
        // Tous les alliés vivants, quelle que soit leur distance : root et snares retirés, puis immunité.
        for (const ally of this.players.values()) {
          if (!ally.alive || this.areEnemies(caster, ally)) continue;
          for (const active of [...ally.effects]) {
            if (MOBILITY_EFFECTS.includes(active.kind)) this.removeEffect(ally, active);
          }
          this.addEffect(ally, "ballad", effect.duration, caster.id);
          this.emit({ kind: "buff", sourceId: caster.id, targetId: ally.id, abilityId: ability.id, detail: "ballad" });
        }
        break;
      case "nearSight":
        // Pas un contrôle magique : le Cri de ralliement ne l'empêche ni ne le retire.
        this.addEffect(target, "nearSight", effect.duration, caster.id);
        this.emit({ kind: "debuff", sourceId: caster.id, targetId: target.id, abilityId: ability.id, detail: "nearSight" });
        break;
      case "heal":
        this.heal(caster, target, effect.amount, ability.id);
        break;
      case "splitHeal":
        // Part du soin réparti entre toutes les cibles ; le buff de puissance y est déjà compté.
        this.restoreHp(caster, target, shares?.get(target.id) ?? 0, ability.id);
        break;
      case "hot": {
        // Relancé par le même lanceur, il repart de zéro ; ceux de lanceurs différents se cumulent.
        const ticks = Math.round(effect.duration / HOT_INTERVAL);
        const renew = this.addEffect(target, "renew", effect.duration, caster.id, effect.amount / ticks, false, true);
        renew.ticks = { abilityId: ability.id, done: 0, total: ticks, kind: "heal" };
        this.emit({ kind: "buff", sourceId: caster.id, targetId: target.id, abilityId: ability.id, detail: "renew" });
        break;
      }
      case "cc":
        this.applyControl(caster, target, effect.cc, effect.duration, ability.id, { magic });
        break;
      case "snare":
        if (magic && this.resistsMagic(caster, target, ability.id)) break;
        this.applySnare(caster, target, effect.slow, effect.duration, ability.id, magic);
        break;
      case "charge":
        this.startCharge(caster, target, effect.damage, effect.stun);
        break;
      case "taunt":
        this.applyTaunt(caster, target, effect.duration, ability.id);
        break;
      case "rallyCry":
        // Retire les contrôles magiques déjà en place, puis protège des suivants.
        for (const active of [...target.effects]) {
          if (active.magic && MAGIC_CONTROLS.includes(active.kind)) this.removeEffect(target, active);
        }
        this.addEffect(target, "magicImmune", effect.duration, caster.id);
        break;
      case "rampart":
        this.addEffect(caster, "rampart", effect.duration, caster.id);
        caster.state.attacking = false;
        caster.state.queuedAbility = "";
        caster.state.lock = "";
        break;
      case "cleanse": {
        // Le Réveil retire le mez, pas le stun.
        const control = target.getEffect("mez");
        if (control) this.removeEffect(target, control);
        this.emit({ kind: "cleanse", sourceId: caster.id, targetId: target.id, abilityId: ability.id });
        break;
      }
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
        // Un seul chant à la fois : en lancer un autre remplace le premier.
        caster.state.song = caster.state.song === ability.id ? "" : ability.id;
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

  // avoidanceDone : pour une attaque spéciale de mêlée, l'évitement a déjà été tranché avant ses effets.
  // dot : tic d'un dégât sur la durée, qui n'est pas intercepté et n'interrompt pas l'incantation.
  private dealDamage(
    source: PlayerRuntime,
    target: PlayerRuntime,
    amount: number,
    abilityId: string,
    melee: boolean,
    avoidanceDone = false,
    dot = false,
  ) {
    if (!target.alive) return;
    // Touché (coup, tic, même évité) : le Chant de vitesse attend le calme.
    target.lastEngagedAt = this.time;

    // Interception : le Gardien prend le coup s'il est assez proche (une attaque spéciale l'a déjà tranchée).
    const interceptor = dot || avoidanceDone ? undefined : this.interceptorOf(target);
    if (interceptor) {
      this.removeEffect(target, target.getEffect("intercept")!);
      this.emit({ kind: "intercepted", sourceId: source.id, targetId: interceptor.id, abilityId, detail: target.id });
      target = interceptor;
      target.lastEngagedAt = this.time;
    }

    // Buff de puissance : plus de dégâts, en mêlée comme avec les sorts (tics compris).
    amount *= this.powerFactor(source);
    // Dernier carré : l'équipe en infériorité, réduite à quelques survivants, frappe plus fort.
    amount *= 1 + this.lastStand(source.state.team);
    // Brise armure : la cible subit plus de dégâts de mêlée (attaques automatiques et techniques).
    if (melee && target.has("armorBroken")) amount *= 1 + ARMOR_BREAK_BONUS;

    // Provoqué : la cible d'un Gardien inflige moins de dégâts à tout autre que lui.
    const taunt = source.getEffect("taunted");
    if (taunt && taunt.sourceId !== target.id) amount *= TAUNT_DAMAGE_FACTOR;

    let crit = false;
    if (melee) {
      target.lastMeleeHitAt = this.time;
      target.lastMeleeAttackerId = source.id;
      if (!avoidanceDone && this.avoidMelee(source, target, abilityId)) return;
      crit = source.has("rage") || this.random() < CRIT_CHANCE;
      if (crit) amount *= CRIT_MULTIPLIER;
    } else if (source.has("arcanePower")) {
      // Puissance arcanique : tous les sorts de dégâts sont critiques, tics de la Brûlure compris.
      crit = true;
      amount *= CRIT_MULTIPLIER;
    }
    amount = Math.round(amount);

    const state = target.state;
    state.hp = Math.max(0, state.hp - amount);
    const killed = state.hp === 0;
    this.emit({ kind: "damage", sourceId: source.id, targetId: target.id, abilityId, amount, crit, killed, ...(dot && { dot }) });

    if (killed) {
      this.handleDeath(target);
      const kill: KillEvent = {
        victimName: state.name,
        victimTeam: state.team,
        victimClass: state.classId,
        killerName: source.state.name,
        killerTeam: source.state.team,
        killerClass: source.state.classId,
        abilityId,
      };
      const standing = [...this.players.values()].filter((p) => p.alive && p.state.team === state.team);
      if (standing.length === 1) kill.lastStanding = standing[0].state.name;
      this.out.announce?.("kill", kill);
      return;
    }
    // Tout dégât interrompt l'incantation (sauf Concentration, et sauf un dot) et brise mez et root.
    if (state.castAbility && !target.castProtected && !dot) this.interrupt(target, "damage");
    for (const kind of ["mez", "root"] as const) {
      const control = target.getEffect(kind);
      if (control) this.removeEffect(target, control);
    }
  }

  // Esquive, bulle, bouclier puis garde. Retourne vrai si le coup est évité.
  // Un personnage neutralisé (mez, stun) n'esquive pas et ne bloque pas ; la bulle et la Garde d'un autre
  // Gardien le protègent toujours.
  private avoidMelee(source: PlayerRuntime, target: PlayerRuntime, abilityId: string): Avoidance {
    const base = { sourceId: source.id, targetId: target.id, abilityId };
    // Rempart : aucune attaque de mêlée ne porte, effets compris.
    if (target.has("meleeImmune")) {
      this.emit({ kind: "immune", ...base, detail: "melee" });
      return "immune";
    }
    const free = !target.incapacitated;
    if (free && target.has("evasion") && this.random() < EVASION_CHANCE) {
      this.emit({ kind: "evaded", ...base });
      return "evaded";
    }
    // Bulle de l'Arcaniste : elle absorbe le coup et disparaît.
    const bubble = target.getEffect("bubble");
    if (bubble) {
      this.removeEffect(target, bubble);
      this.emit({ kind: "absorbed", ...base });
      return "absorbed";
    }
    if (free && target.classDef.passives.includes("shieldBlock") && this.random() < SHIELD_BLOCK_CHANCE) {
      this.emit({ kind: "blocked", ...base, detail: target.id });
      return "blocked";
    }
    const guard = target.getEffect("guarded");
    const guardian = guard ? this.players.get(guard.sourceId) : undefined;
    if (
      guardian?.alive &&
      !guardian.incapacitated &&
      // La Garde ne joue que si l'allié et le Gardien sont immobiles au moment du coup.
      !guardian.isMoving &&
      !target.isMoving &&
      distance(guardian.state, target.state) <= GUARD_RANGE &&
      this.random() < GUARD_BLOCK_CHANCE
    ) {
      this.emit({ kind: "blocked", ...base, detail: guardian.id });
      return "blocked";
    }
    return null;
  }

  // Soin augmenté par le buff de puissance du lanceur.
  private heal(source: PlayerRuntime, target: PlayerRuntime, amount: number, abilityId: string) {
    this.restoreHp(source, target, amount * this.powerFactor(source), abilityId);
  }

  // Soin sans bonus, plafonné aux points de vie manquants. L'événement part même à 0 : pour le Soin de groupe, il
  // dit qui la zone a touché.
  // Gangrène : la cible reçoit moins de soins (toutes les sources, parts du Soin de groupe et tics compris).
  private restoreHp(source: PlayerRuntime, target: PlayerRuntime, amount: number, abilityId: string) {
    if (target.has("gangrene")) amount *= GANGRENE_HEAL_FACTOR;
    const healed = Math.min(Math.round(amount), target.state.maxHp - target.state.hp);
    target.state.hp += healed;
    this.emit({ kind: "heal", sourceId: source.id, targetId: target.id, abilityId, amount: healed });
  }

  // magic : contrôle venu d'un sort (le Cri de ralliement en protège). ignoreImmunity : passe outre l'immunité à ce
  // contrôle (stun de la Charge), tout en la donnant comme d'habitude.
  private applyControl(
    source: PlayerRuntime,
    target: PlayerRuntime,
    cc: CrowdControl,
    duration: number,
    abilityId: string,
    options: { magic?: boolean; ignoreImmunity?: boolean } = {},
  ) {
    if (options.magic && this.resistsMagic(source, target, abilityId)) return;
    if (cc === "root" && this.resistsMobility(source, target, abilityId)) return;
    const immunity = IMMUNITY_EFFECTS[cc];
    if (target.has(immunity) && !options.ignoreImmunity) {
      this.emit({ kind: "immune", sourceId: source.id, targetId: target.id, abilityId, detail: cc });
      return;
    }
    this.addEffect(target, cc, duration, source.id, 0, options.magic);
    // Un Gardien mez ou stun perd son Rempart.
    const rampart = cc !== "root" ? target.getEffect("rampart") : undefined;
    if (rampart) this.removeEffect(target, rampart);
    if (target.charge) this.stopCharge(target);
    // L'immunité démarre dès l'application : impossible de prolonger le contrôle en le relançant.
    // Elle couvre la durée du contrôle, puis IMMUNITY_DURATION de répit après sa fin normale.
    this.addEffect(target, immunity, duration + IMMUNITY_DURATION, source.id);
    // Mez et stun interrompent toujours ; un root aussi (décidé le 2026-11-21), sauf sous Concentration.
    if (target.state.castAbility && (cc !== "root" || !target.castProtected)) this.interrupt(target, "cc");
    this.emit({ kind: "cc", sourceId: source.id, targetId: target.id, abilityId, detail: cc });
  }

  private handleDeath(player: PlayerRuntime) {
    const state = player.state;
    state.attacking = false;
    state.song = "";
    state.lock = "";
    player.input = NO_INPUT;
    state.queuedAbility = "";
    this.clearCombo(player);
    this.stopCharge(player);
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

  // --- Effets ---

  private updateEffectTimers(player: PlayerRuntime, dt: number) {
    for (const effect of [...player.effects]) {
      if (!Number.isFinite(effect.remaining)) continue;
      effect.remaining -= dt;
      if (effect.ticks) this.updateTicks(player, effect);
      if (!player.effects.includes(effect)) continue;
      if (effect.remaining <= 0 || (effect.ticks && effect.ticks.done >= effect.ticks.total)) this.removeEffect(player, effect);
      else effect.view.remaining = effect.remaining;
    }
  }

  // Dégâts ou soin sur la durée : un tic par intervalle écoulé, le dernier à la fin de l'effet.
  private updateTicks(player: PlayerRuntime, effect: ActiveEffect) {
    const ticks = effect.ticks!;
    const source = this.players.get(effect.sourceId);
    if (!source) return this.removeEffect(player, effect);
    const elapsed = effect.duration - effect.remaining;
    const interval = ticks.kind === "heal" ? HOT_INTERVAL : DOT_INTERVAL;
    while (ticks.done < ticks.total && elapsed >= (ticks.done + 1) * interval - 1e-6 && player.alive) {
      ticks.done++;
      if (ticks.kind === "heal") {
        // Un tic qui ne soigne rien (cible pleine) n'est pas annoncé : pas de « +0 » flottant ni de voix.
        if (player.state.hp < player.state.maxHp) this.heal(source, player, effect.value, ticks.abilityId);
      } else this.dealDamage(source, player, effect.value, ticks.abilityId, false, false, true);
    }
  }

  // Effets qui dépendent de la situation : chants du Barde, Rempart du Gardien.
  private updateDerivedEffects(player: PlayerRuntime) {
    const allies = [...this.players.values()].filter((p) => p.alive && !this.areEnemies(p, player));
    const near = (p: PlayerRuntime, range: number) => distance(p.state, player.state) <= range;

    const singing = (song: string) => allies.some((p) => p.state.song === song && near(p, SONG_RANGE));
    // Chant de vitesse : seulement après SONG_SPEED_CALM secondes sans être touché ni agir.
    // Incanter est une action en cours : pas de bonus pendant l'incantation.
    this.setDerivedEffect(
      player,
      "speed",
      singing("speedSong") && !player.state.castAbility && this.time - player.lastEngagedAt >= SONG_SPEED_CALM,
    );
    this.setDerivedEffect(player, "secondWind", singing("secondWind"));
    // Rempart : le Gardien et ses alliés à RAMPART_RADIUS de lui, y compris ceux qui entrent dans la zone.
    this.setDerivedEffect(
      player,
      "meleeImmune",
      allies.some((p) => p.has("rampart") && near(p, RAMPART_RADIUS)),
    );
  }

  private setDerivedEffect(player: PlayerRuntime, kind: EffectKind, active: boolean) {
    const effect = player.getEffect(kind);
    if (active && !effect) this.addEffect(player, kind, Infinity, player.id);
    if (!active && effect) this.removeEffect(player, effect);
  }

  // Un effet déjà présent est rafraîchi plutôt que cumulé.
  // Un seul snare à la fois, et le plus puissant reste jusqu'à la fin de son effet : un snare plus faible est ignoré.
  // À puissance égale, on garde celui qui dure le plus longtemps.
  private applySnare(source: PlayerRuntime, target: PlayerRuntime, slow: number, duration: number, abilityId: string, magic = false) {
    if (this.resistsMobility(source, target, abilityId)) return;
    const current = target.getEffect("snare");
    if (current && (current.value > slow || (current.value === slow && current.remaining >= duration))) return;
    this.addEffect(target, "snare", duration, source.id, slow, magic);
  }

  // Ballade rythmée : root et snares sont sans effet. Retourne vrai s'il est résisté.
  private resistsMobility(source: PlayerRuntime, target: PlayerRuntime, abilityId: string): boolean {
    if (!target.has("ballad")) return false;
    this.emit({ kind: "immune", sourceId: source.id, targetId: target.id, abilityId, detail: "mobility" });
    return true;
  }

  // Cri de ralliement : un contrôle magique est sans effet. Retourne vrai s'il est résisté.
  private resistsMagic(source: PlayerRuntime, target: PlayerRuntime, abilityId: string): boolean {
    if (!target.has("magicImmune")) return false;
    this.emit({ kind: "immune", sourceId: source.id, targetId: target.id, abilityId, detail: "magic" });
    return true;
  }

  // --- Gardien : Charge et Provocation ---

  private startCharge(caster: PlayerRuntime, target: PlayerRuntime, damage: number, stun: number) {
    caster.charge = { targetId: target.id, elapsed: 0, stuck: 0, damage, stun };
    caster.state.charging = true;
    caster.state.lock = "";
  }

  private stopCharge(player: PlayerRuntime) {
    player.charge = null;
    player.state.charging = false;
  }

  // Le Gardien fonce droit sur sa cible. Il s'arrête s'il est contrôlé, si la cible meurt, ou s'il reste bloqué par
  // un obstacle ; il frappe dès qu'il est à portée de mêlée.
  private updateCharge(player: PlayerRuntime, dt: number) {
    const charge = player.charge!;
    const state = player.state;
    const target = this.players.get(charge.targetId);
    if (!target?.alive || player.incapacitated || player.has("root")) return this.stopCharge(player);
    charge.elapsed += dt;
    state.facing = facingTowards(state, target.state);
    const snare = player.getEffect("snare");
    const direction = { x: target.state.x - state.x, z: target.state.z - state.z };
    // Le dernier pas s'arrête au contact, sans traverser la cible (à cette vitesse, un pas fait près de 2 m).
    const room = Math.max(0, Math.hypot(direction.x, direction.z) - CHARGE_STOP_DISTANCE);
    const speed = Math.min(CHARGE_SPEED_MULTIPLIER * (snare ? 1 - snare.value : 1), room / (MOVE_SPEED * dt));
    let next = stepMovement(state, direction, dt, speed);
    if (this.confine) next = this.confine(player, next);
    const moved = Math.hypot(next.x - state.x, next.z - state.z);
    state.x = next.x;
    state.z = next.z;

    if (distance(state, target.state) <= CHARGE_STOP_DISTANCE + 0.05) return this.chargeImpact(player, target, charge);
    charge.stuck = moved < 1e-3 ? charge.stuck + dt : 0;
    if (charge.stuck > 0.25 || charge.elapsed > CHARGE_MAX_DURATION) {
      this.stopCharge(player);
      this.sendError(player, "chargeInterrupted");
    }
  }

  // Arrivée de la Charge : dégâts et stun, sans esquive ni blocage, même sur une cible immunisée au stun.
  // Seul le Rempart protège (aucune attaque de mêlée ne porte).
  private chargeImpact(player: PlayerRuntime, target: PlayerRuntime, charge: NonNullable<PlayerRuntime["charge"]>) {
    this.stopCharge(player);
    const impact: AbilityUsedEvent = { casterId: player.id, abilityId: "chargeImpact", targetId: target.id };
    this.out.broadcast("ability", impact, [player.id, target.id]);
    player.state.attacking = true;
    this.noteAction(player);
    target.lastEngagedAt = this.time;
    if (target.has("meleeImmune")) {
      this.emit({ kind: "immune", sourceId: player.id, targetId: target.id, abilityId: "charge", detail: "melee" });
      return;
    }
    this.dealDamage(player, target, charge.damage, "charge", true, true);
    if (target.alive) this.applyControl(player, target, "stun", charge.stun, "charge", { ignoreImmunity: true });
  }

  // Provocation : la cible s'arrête net, son incantation est interrompue, son attaque s'arrête et elle se tourne vers
  // le Gardien ; pendant la durée, elle inflige moins de dégâts à tout autre que lui (voir dealDamage).
  private applyTaunt(caster: PlayerRuntime, target: PlayerRuntime, duration: number, abilityId: string) {
    this.addEffect(target, "taunted", duration, caster.id);
    this.addEffect(target, "halted", TAUNT_HALT_DURATION, caster.id);
    if (target.state.castAbility && !target.castProtected) this.interrupt(target, "taunt");
    target.state.attacking = false;
    target.state.queuedAbility = "";
    target.state.lock = "";
    target.state.facing = facingTowards(target.state, caster.state);
    this.emit({ kind: "taunt", sourceId: caster.id, targetId: target.id, abilityId });
  }

  private addEffect(
    player: PlayerRuntime,
    kind: EffectKind,
    duration: number,
    sourceId: string,
    value = 0,
    magic = false,
    // Un effet par lanceur (Renouveau) : seul celui du même lanceur est rafraîchi.
    perSource = false,
  ): ActiveEffect {
    const existing = perSource ? player.effects.find((e) => e.kind === kind && e.sourceId === sourceId) : player.getEffect(kind);
    if (existing) {
      existing.remaining = duration;
      existing.duration = duration;
      existing.sourceId = sourceId;
      existing.value = value;
      existing.magic = magic;
      existing.ticks = undefined;
      existing.view.remaining = Number.isFinite(duration) ? duration : PERMANENT;
      existing.view.duration = Number.isFinite(duration) ? duration : PERMANENT;
      existing.view.source = sourceId;
      existing.view.value = value;
      return existing;
    }
    const view = new EffectState();
    view.kind = kind;
    view.remaining = Number.isFinite(duration) ? duration : PERMANENT;
    view.duration = Number.isFinite(duration) ? duration : PERMANENT;
    view.source = sourceId;
    view.value = value;
    player.state.effects.push(view);
    const effect: ActiveEffect = { kind, remaining: duration, duration, sourceId, value, magic, view };
    player.effects.push(effect);

    if (kind === "buffHp") {
      player.state.maxHp += HP_BUFF_AMOUNT;
      player.state.hp += HP_BUFF_AMOUNT;
    }
    return effect;
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

  private sendSwing(player: PlayerRuntime, struck: boolean) {
    const event: SwingEvent = { remaining: player.swingTimer, struck };
    this.out.sendTo(player.id, "swing", event);
  }

  // Le client affiche le texte dans la langue du joueur ; abilityId : compétence citée (ouverture d'un combo).
  private sendError(player: PlayerRuntime, code: GameErrorCode, abilityId?: string) {
    const message: GameErrorMessage = abilityId ? { code, abilityId } : { code };
    this.out.sendTo(player.id, "error", message);
  }
}

// Chant du Barde (à activer ou couper).
function isSong(ability: AbilityDef): boolean {
  return ability.effects.some((effect) => effect.type === "toggleSong");
}

// Dégâts décroissants du centre vers le bord d'une zone d'effet (edgeAmount au bord du rayon).
function withFalloff(effect: AbilityEffect, ability: AbilityDef, center: PlayerRuntime, target: PlayerRuntime): AbilityEffect {
  if (effect.type !== "damage" || effect.edgeAmount === undefined || !ability.radius) return effect;
  const ratio = Math.min(1, distance(center.state, target.state) / ability.radius);
  return { ...effect, amount: Math.round(effect.amount + (effect.edgeAmount - effect.amount) * ratio) };
}
