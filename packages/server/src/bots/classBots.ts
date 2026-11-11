import {
  MELEE_RANGE,
  RAMPART_RADIUS,
  distance,
  getAbility,
  positionRelativeTo,
  type ClassId,
  type EffectKind,
} from "@arena/shared";
import type { CombatSystem } from "../CombatSystem";
import type { PlayerRuntime } from "../PlayerRuntime";
import { BotBrain, CASTER_CLASSES, MELEE_CLASSES } from "./BotBrain";
import type { Pathfinder } from "./Pathfinder";

// Priorité de cible des Lames et des Arcanistes : lanceurs de sorts, puis Lames, puis Gardiens.
const DAMAGE_PRIORITY: ClassId[][] = [CASTER_CLASSES, ["lame"], ["gardien"]];

// Gardien : distance minimale de la Charge, rayon du Cri de ralliement, contrôles qu'il retire.
const CHARGE_MIN = getAbility("charge")?.minRange ?? 10;
const RALLY_RADIUS = getAbility("rallyCry")?.radius ?? 20;
const RALLY_CONTROLS: EffectKind[] = ["mez", "root"];

// Distance que les lanceurs de sorts cherchent à garder avec l'ennemi (la portée des sorts est de 30 m).
const CASTER_MIN_DISTANCE = 15;
const CASTER_MAX_DISTANCE = 26;

// Rayon dans lequel un ennemi de mêlée fait fuir un lanceur de sorts (en plus d'un coup reçu).
const CASTER_DANGER_RADIUS = 3.5;
// Distance minimale gardée face à un lanceur de sorts ennemi (moins dangereux au contact).
const CASTER_VS_CASTER_MIN_DISTANCE = 8;

export function createBotBrain(player: PlayerRuntime, combat: CombatSystem, pathfinder: Pathfinder): BotBrain {
  switch (player.classDef.id) {
    case "lame":
      return new LameBot(player, combat, pathfinder);
    case "arcaniste":
      return new ArcanisteBot(player, combat, pathfinder);
    case "pretre":
      return new PretreBot(player, combat, pathfinder);
    case "barde":
      return new BardeBot(player, combat, pathfinder);
    case "gardien":
      return new GardienBot(player, combat, pathfinder);
  }
}

// --- Lame : traque les lanceurs de sorts et cherche à frapper dans le dos ---

class LameBot extends BotBrain {
  protected think() {
    const target = this.pickTarget(DAMAGE_PRIORITY);
    if (!target) return this.advance();

    this.meleeAttack(target);
    if (this.distanceTo(target) > 6) return;

    // Évasion quand on se fait frapper et que la vie baisse ; Rage pour achever.
    const underAttack = this.combat.now - this.self.lastMeleeHitAt < 2;
    if (underAttack && this.hpRatio(this.self) < 0.6) this.tryUse("evasion");
    if (this.distanceTo(target) <= MELEE_RANGE && this.hpRatio(target) < 0.7) this.tryUse("rage");

    const position = positionRelativeTo(target.state, this.self.state);
    if (position === "back" && this.tryUse("backstab", target)) return;
    if (position === "side" && !target.has("snare") && this.tryUse("flankStrike", target)) return;

    // Contourne la cible pour se placer dans son dos.
    const behind = {
      x: target.state.x - Math.sin(target.state.facing) * 1.6,
      z: target.state.z - Math.cos(target.state.facing) * 1.6,
    };
    if (position !== "back") this.moveTo(behind, 0.4);
  }
}

// --- Lanceurs de sorts : fuient la mêlée et gardent leurs distances ---

abstract class CasterBot extends BotBrain {
  // Fuit si un ennemi de mêlée est au contact. Retourne vrai si le bot fuit.
  protected evadeMelee(): boolean {
    const threats = this.meleeThreats(CASTER_DANGER_RADIUS);
    if (threats.length === 0) return false;
    // Une incantation protégée par Concentration mérite d'être terminée.
    if (this.isCasting && this.self.castProtected) return true;
    this.flee(threats);
    return true;
  }

  // Ni trop près ni trop loin de l'ennemi le plus proche. Retourne vrai si la position est bonne.
  protected holdPosition(): boolean {
    const enemy = this.nearest(this.enemies());
    if (!enemy) {
      this.advance();
      return false;
    }
    return this.keepDistance(enemy, this.minDistanceFrom(enemy), CASTER_MAX_DISTANCE);
  }

  // On garde plus de distance avec un combattant de mêlée qu'avec un lanceur de sorts.
  protected minDistanceFrom(enemy: PlayerRuntime): number {
    return MELEE_CLASSES.includes(enemy.classDef.id) ? CASTER_MIN_DISTANCE : CASTER_VS_CASTER_MIN_DISTANCE;
  }

  // Ennemi au centre du plus grand groupe d'ennemis satisfaisant le critère, avec sa taille.
  protected bestGroup(radius: number, eligible: (p: PlayerRuntime) => boolean): { center?: PlayerRuntime; size: number } {
    const enemies = this.enemies().filter(eligible);
    let best: { center?: PlayerRuntime; size: number } = { size: 0 };
    for (const center of enemies) {
      const size = enemies.filter((e) => distance(e.state, center.state) <= radius).length;
      if (size > best.size) best = { center, size };
    }
    return best;
  }
}

// Distance en deçà de laquelle un ennemi prend assez de dégâts de Déflagration pour qu'elle vaille le coup.
const BLAST_REACH = 5;
// La Nova de givre (15 m) vaut le coup quand un ennemi de mêlée est déjà assez près.
const NOVA_REACH = 8;

// Arcaniste : gros dégâts à distance ; Nova de givre quand la mêlée arrive, Trait de givre pour la ralentir ;
// Déflagration quand plusieurs ennemis sont collés à lui ; Near sight sur les lanceurs de sorts ; Brûlure, puis
// Trait de feu. Puissance arcanique dès qu'il a une cible.
class ArcanisteBot extends CasterBot {
  protected think() {
    // Plusieurs ennemis tout près : Déflagration, protégée par Concentration si elle est prête.
    const close = this.enemies().filter((e) => this.distanceTo(e) <= BLAST_REACH).length;
    if (close >= 2 && !this.isCasting) {
      if (this.isReady("concentration") && this.tryUse("concentration") && this.tryUse("blast")) return;
      if (this.tryUse("blast")) return;
    }
    // La mêlée arrive : Nova de givre (protégée par Concentration au contact) pour s'en débarrasser.
    const rootable = this.meleeThreats(NOVA_REACH).filter((e) => !e.has("immuneRoot") && !e.has("magicImmune"));
    if (rootable.length > 0 && !this.isCasting && this.isReady("frostNova")) {
      const contact = rootable.some((e) => this.distanceTo(e) <= MELEE_RANGE + 0.5);
      if (contact && this.isReady("concentration") && this.tryUse("concentration") && this.tryUse("frostNova")) return;
      if (this.tryUse("frostNova")) return;
    }
    if (this.evadeMelee()) return;
    if (this.isCasting) return;

    // Un ennemi de mêlée qui approche : on le ralentit avant qu'il arrive.
    const approaching = this.enemies().find(
      (e) => MELEE_CLASSES.includes(e.classDef.id) && this.distanceTo(e) <= 15 && !e.has("snare") && !e.has("root"),
    );
    if (approaching && this.tryUse("frostbolt", approaching)) return;

    const target = this.pickTarget(DAMAGE_PRIORITY);
    if (!target) return this.advance();
    if (!this.keepDistance(target, this.minDistanceFrom(target), CASTER_MAX_DISTANCE)) return;

    this.tryUse("arcanePower");
    // Un lanceur de sorts ennemi : sa portée réduite le force à venir au contact.
    if (CASTER_CLASSES.includes(target.classDef.id) && !target.has("nearSight") && this.tryUse("nearSight", target)) return;
    if (!target.has("burning") && this.tryUse("burn", target)) return;
    this.tryUse("firebolt", target);
  }
}

// Prêtre : soigner avant tout, purifier, ressusciter, puis buffer.
class PretreBot extends CasterBot {
  protected prepare() {
    this.stop();
    if (!this.isCasting) this.buffAllies();
  }

  protected think() {
    const self = this.self;
    if (this.meleeThreats(CASTER_DANGER_RADIUS).length > 0 && this.hpRatio(self) < 0.5) this.tryUse("instantHeal", self);
    if (this.evadeMelee()) return;
    if (this.isCasting) return;

    const allies = this.allies();
    const byHealth = [...allies].sort((a, b) => this.hpRatio(a) - this.hpRatio(b));

    // 1. Urgence : soin instantané.
    const critical = byHealth.find((a) => this.hpRatio(a) < 0.35);
    if (critical && this.tryUse("instantHeal", critical)) return;

    // 2. Plusieurs alliés morts autour, sans ennemi trop près : Intervention divine.
    const safe = !this.enemies().some((e) => this.distanceTo(e) < CASTER_MIN_DISTANCE);
    const deadNearby = this.deadAllies().filter((a) => this.distanceTo(a) <= 30);
    if (safe && deadNearby.length >= 2 && this.tryUse("divineIntervention")) return;

    // 3. Plusieurs blessés autour : soin de groupe.
    const hurtNearby = allies.filter((a) => this.hpRatio(a) < 0.75 && this.distanceTo(a) <= 30);
    if (hurtNearby.length >= 3 && this.tryUse("groupHeal")) return;

    // 4. Soigner le plus blessé, en s'approchant si besoin.
    const hurt = byHealth.find((a) => this.hpRatio(a) < 0.8);
    if (hurt) {
      if (this.distanceTo(hurt) > 28) return this.moveTo(hurt.state, 24);
      // Un blessé léger sans Renouveau de ce Prêtre : un soin sur la durée.
      const renewed = hurt.effects.some((e) => e.kind === "renew" && e.sourceId === self.id);
      if (this.hpRatio(hurt) > 0.6 && !renewed && this.tryUse("renew", hurt)) return;
      if (this.tryUse("heal", hurt)) return;
    }

    // 5. Relever un allié mort si aucun ennemi n'est trop près.
    const dead = this.nearest(this.deadAllies());
    if (dead && safe) {
      if (this.distanceTo(dead) > 28) return this.moveTo(dead.state, 24);
      if (this.tryUse("resurrect", dead)) return;
    }

    // 6. Buffs, en gardant de quoi soigner.
    if (self.state.mana > 500 && this.buffAllies()) return;

    // 7. Rester loin des ennemis, près des alliés.
    const enemy = this.nearest(this.enemies());
    if (enemy && this.distanceTo(enemy) < this.minDistanceFrom(enemy)) return this.flee([enemy]);
    this.advance();
  }

  // Buff de vie pour tous, buff de puissance pour tous les combattants (il augmente aussi les sorts et les soins). Retourne vrai si un buff est lancé.
  private buffAllies(): boolean {
    for (const ally of this.allies()) {
      if (this.needsBuff(ally, "buffHp") && this.tryUse("buffHp", ally)) return true;
    }
    for (const ally of this.allies()) {
      if (this.needsBuff(ally, "buffStrength") && this.tryUse("buffStrength", ally)) return true;
    }
    return false;
  }

  // L'allié n'a pas ce buff, et aucun autre Prêtre n'est déjà en train de le lui lancer.
  private needsBuff(ally: PlayerRuntime, buff: "buffHp" | "buffStrength"): boolean {
    if (ally.has(buff)) return false;
    return !this.allies().some(
      (p) => p !== this.self && p.state.castAbility === buff && p.castTargetId === ally.id,
    );
  }
}

// Barde : Mez de zone, puis Root de zone, puis Silence ; Chant de vitesse toujours actif.
class BardeBot extends CasterBot {
  protected prepare() {
    this.stop();
    this.ensureSong();
  }

  protected think() {
    this.ensureSong();
    if (this.evadeMelee()) return;
    if (this.isCasting) return;

    // 1. Mez de zone sur au moins deux ennemis non immunisés (un ennemi mezzé est aussi immunisé).
    const mezGroup = this.bestGroup(6, (e) => !e.has("immuneMez"));
    if (mezGroup.size >= 2 && this.tryUse("aoeMez", mezGroup.center)) return;

    // 2. Root de zone sur au moins deux ennemis non mezzés et non immunisés au root.
    const rootGroup = this.bestGroup(6, (e) => !e.has("immuneRoot") && !e.has("mez"));
    if (rootGroup.size >= 2 && this.tryUse("aoeRoot", rootGroup.center)) return;

    // 3. Silence sur un ennemi en train d'incanter.
    const caster = this.enemies().find((e) => e.state.castAbility !== "");
    if (caster && this.tryUse("silence", caster)) return;

    // 4. Mez ciblé sur un ennemi de mêlée qui approche.
    const approaching = this.enemies().find(
      (e) => MELEE_CLASSES.includes(e.classDef.id) && this.distanceTo(e) <= 12 && !e.has("immuneMez"),
    );
    if (approaching && this.tryUse("mez", approaching)) return;

    this.holdPosition();
  }

  private ensureSong() {
    if (!this.self.state.songActive) this.tryUse("speedSong");
  }
}

// --- Gardien : protège les lanceurs de sorts attaqués ---

class GardienBot extends BotBrain {
  protected prepare() {
    this.stop();
    const ward = this.chooseWard();
    if (ward) this.ensureGuard(ward);
  }

  protected think() {
    // Pendant la Charge et le Rempart, le Gardien ne peut rien faire d'autre.
    if (this.self.charge || this.self.has("rampart")) return;
    const ward = this.chooseWard();
    if (ward) this.ensureGuard(ward);

    // Rempart : le groupe est submergé par la mêlée, ou le protégé va mourir sous les coups.
    if (this.shouldRampart(ward) && this.tryUse("rampart")) return;
    // Cri de ralliement : plusieurs alliés pris par des contrôles magiques (instantané, la suite continue).
    if (this.shouldRally(ward)) this.tryUse("rallyCry");

    // Provocation : l'ennemi qui frappe le protégé, ou qui achève un allié (au corps à corps ou par un sort).
    const taunted = this.tauntTarget(ward);
    if (taunted && this.tryUse("taunt", taunted)) return;

    if (!ward) {
      const target = this.pickTarget(DAMAGE_PRIORITY);
      if (!target) return this.advance();
      if (this.distanceTo(target) >= CHARGE_MIN && this.tryUse("charge", target)) return;
      return this.fight(target);
    }

    const attacked = this.combat.now - ward.lastMeleeHitAt < 3;
    if (attacked && this.hpRatio(ward) < 0.4) this.tryUse("intercept", ward);

    // L'agresseur du protégé, sinon l'ennemi le plus proche de lui.
    const attacker = attacked ? this.world.players.get(ward.lastMeleeAttackerId ?? "") : undefined;
    const threat =
      attacker?.alive && this.world.visible.has(attacker.id)
        ? attacker
        : this.nearest(this.enemies().filter((e) => distance(e.state, ward.state) <= 8));
    if (threat) return this.fight(threat);

    // Le protégé est tranquille : Charge sur un lanceur de sorts ennemi, de préférence en pleine incantation.
    const casters = this.enemies().filter((e) => CASTER_CLASSES.includes(e.classDef.id) && this.distanceTo(e) >= CHARGE_MIN);
    const caster = casters.find((e) => e.state.castAbility) ?? this.nearest(casters);
    if (caster && this.tryUse("charge", caster)) return;

    // Rien à signaler : rejoindre le protégé (la Garde ne fonctionne qu'à 4 m),
    // puis mener le groupe : le protégé suit le Gardien.
    if (this.distanceTo(ward) > 5) this.moveTo(ward.state, 2.5);
    else this.advance();
  }

  // Au contact : Coup de bouclier (stun), sinon Frappe handicapante dans le dos, sinon Coup puissant.
  // Une technique déjà en attente n'est pas remplacée.
  private fight(target: PlayerRuntime) {
    this.meleeAttack(target);
    if (this.distanceTo(target) > MELEE_RANGE || this.self.state.queuedAbility) return;
    if (!target.has("stun") && !target.has("immuneStun") && this.tryUse("shieldBash", target)) return;
    const behind = positionRelativeTo(target.state, this.self.state) === "back";
    if (behind && !target.has("snare") && this.tryUse("cripplingStrike", target)) return;
    this.tryUse("powerStrike", target);
  }

  // Ennemi à provoquer : celui qui frappe le protégé, ou celui qui frappe (ou vise d'un sort) un allié à moins de
  // la moitié de sa vie.
  private tauntTarget(ward: PlayerRuntime | undefined): PlayerRuntime | undefined {
    if (!this.isReady("taunt")) return undefined;
    const enemies = this.enemies();
    const recent = (p: PlayerRuntime) => this.combat.now - p.lastMeleeHitAt < 2;
    if (ward && recent(ward)) {
      const attacker = enemies.find((e) => e.id === ward.lastMeleeAttackerId);
      if (attacker && !attacker.has("taunted")) return attacker;
    }
    const wounded = this.allies().filter((a) => a !== this.self && this.hpRatio(a) < 0.5);
    for (const ally of wounded) {
      const hitter = recent(ally) ? enemies.find((e) => e.id === ally.lastMeleeAttackerId) : undefined;
      const caster = enemies.find((e) => e.state.castAbility && e.castTargetId === ally.id);
      const enemy = hitter ?? caster;
      if (enemy && !enemy.has("taunted")) return enemy;
    }
    return undefined;
  }

  // Au moins deux alliés à portée du cri sous un contrôle magique, ou le Gardien lui-même, ou son protégé.
  private shouldRally(ward: PlayerRuntime | undefined): boolean {
    if (!this.isReady("rallyCry")) return false;
    const controlled = (p: PlayerRuntime) => p.effects.some((e) => e.magic && RALLY_CONTROLS.includes(e.kind));
    const near = this.allies().filter((a) => this.distanceTo(a) <= RALLY_RADIUS);
    const count = near.filter(controlled).length;
    return count >= 2 || controlled(this.self) || (!!ward && near.includes(ward) && controlled(ward));
  }

  // Au moins trois ennemis de mêlée au contact du groupe (alliés à 30 m), ou le protégé sous 30 % sous les coups.
  private shouldRampart(ward: PlayerRuntime | undefined): boolean {
    if (!this.isReady("rampart")) return false;
    const group = this.allies().filter((a) => this.distanceTo(a) <= RAMPART_RADIUS);
    const attackers = this.enemies().filter(
      (e) => MELEE_CLASSES.includes(e.classDef.id) && group.some((a) => distance(e.state, a.state) <= MELEE_RANGE + 1),
    );
    if (attackers.length >= 3) return true;
    return !!ward && group.includes(ward) && this.hpRatio(ward) < 0.3 && this.combat.now - ward.lastMeleeHitAt < 2;
  }

  // Le lanceur de sorts allié attaqué le plus récemment, sinon le plus proche.
  private chooseWard(): PlayerRuntime | undefined {
    const casters = this.allies().filter((a) => a !== this.self && CASTER_CLASSES.includes(a.classDef.id));
    const attacked = casters
      .filter((c) => this.combat.now - c.lastMeleeHitAt < 3)
      .sort((a, b) => b.lastMeleeHitAt - a.lastMeleeHitAt);
    return attacked[0] ?? this.nearest(casters);
  }

  private ensureGuard(ward: PlayerRuntime) {
    if (ward.getEffect("guarded")?.sourceId !== this.self.id) this.tryUse("guard", ward);
  }
}
