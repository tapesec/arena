import {
  GARDIEN_ASSIST_DURATION,
  HEAL_ORDER_DURATION,
  MELEE_RANGE,
  SONG_RANGE,
  SONG_SPEED_CALM,
  spellRange,
  RAMPART_RADIUS,
  hasLineOfSight,
  distance,
  getAbility,
  positionRelativeTo,
  type ClassId,
  type EffectKind,
  type OrderId,
  type OrderReply,
} from "@arena/shared";
import type { CombatSystem } from "../CombatSystem";
import type { PlayerRuntime } from "../PlayerRuntime";
import { BotBrain, CASTER_CLASSES, isCaster, isMelee } from "./BotBrain";
import type { Pathfinder } from "./Pathfinder";

// Priorité de cible des Lames et des Arcanistes : lanceurs de sorts, puis Lames, puis Gardiens.
const DAMAGE_PRIORITY: ClassId[][] = [CASTER_CLASSES, ["lame"], ["gardien"]];

// Gardien : distance minimale de la Charge, rayon du Cri de ralliement, contrôles qu'il retire.
const CHARGE_MIN = getAbility("charge")?.minRange ?? 10;
const RALLY_RADIUS = getAbility("rallyCry")?.radius ?? 20;
const RALLY_CONTROLS: EffectKind[] = ["mez", "root"];

// Barde : rayon du Mez de zone.
const AOE_MEZ_RADIUS = getAbility("aoeMez")?.radius ?? 10;

// Prêtre : rayons de l'Intervention divine et du Soin de groupe.
const DIVINE_INTERVENTION_RADIUS = getAbility("divineIntervention")?.radius ?? 30;
const GROUP_HEAL_RADIUS = getAbility("groupHeal")?.radius ?? 30;

// Les ordres ponctuels (réveiller, buffer) sont abandonnés s'ils ne sont pas faits dans ce délai (secondes).
const ONE_SHOT_ORDER_DURATION = 10;
// Portée à laquelle les soigneurs et le Barde se placent pour lancer un sort à un allié (portée des sorts : 30 m).
const SUPPORT_REACH = 28;
const SUPPORT_APPROACH = 24;

// Coût en mana d'une compétence (pour refuser un ordre faute de mana).
function manaCost(abilityId: string): number {
  return getAbility(abilityId)?.cost ?? 0;
}

// La ressource du joueur (mana ou endurance) est pleine.
function resourceFull(player: PlayerRuntime): boolean {
  const state = player.state;
  return player.classDef.resource === "mana" ? state.mana >= state.maxMana : state.endurance >= state.maxEndurance;
}

// Distance que les lanceurs de sorts cherchent à garder avec l'ennemi (la portée des sorts est de 30 m).
const CASTER_MIN_DISTANCE = 15;
const CASTER_MAX_DISTANCE = 26;

// Rayon dans lequel un ennemi de mêlée fait fuir un lanceur de sorts (en plus d'un coup reçu) : celui de la
// Déflagration, pour qu'une mêlée assez proche pour l'empêcher fasse aussi fuir.
const CASTER_DANGER_RADIUS = 5;
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
    // Sprint pour rejoindre une cible lointaine.
    if (this.distanceTo(target) > 15) this.tryUse("sprint");
    if (this.distanceTo(target) > 6) return;

    // Évasion quand on se fait frapper et que la vie baisse ; Rage pour achever.
    const underAttack = this.combat.now - this.self.lastMeleeHitAt < 2;
    if (underAttack && this.hpRatio(this.self) < 0.6) this.tryUse("evasion");
    if (this.distanceTo(target) <= MELEE_RANGE && this.hpRatio(target) < 0.7) this.tryUse("rage");
    // Coup de pied sur un lanceur qui incante : interruption et silence.
    if (target.state.castAbility && !target.castProtected && this.tryUse("kick", target)) return;

    // Combos d'abord : ils ne partent que juste après leur ouverture.
    const combo = { backstab: "poisonBlade", poisonBlade: "gangrene", flankStrike: "armorBreak" }[this.self.state.comboAbility];
    if (combo && this.tryUse(combo, target)) return;

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
  // Fuit si un ennemi de mêlée est au contact. Retourne vrai si le bot fuit (ou reste à finir son incantation).
  // Pendant une incantation, on ne fuit pas : bouger l'interromprait à coup sûr, alors qu'un coup peut ne pas venir ou
  // être évité ; si un coup l'interrompt, la fuite reprend au tour suivant (décidé le 2026-11-21 : les bots
  // perdaient jusqu'à 150 incantations par partie en fuyant pendant qu'ils incantaient).
  protected evadeMelee(): boolean {
    const threats = this.meleeThreats(CASTER_DANGER_RADIUS);
    if (threats.length === 0) return false;
    if (this.isCasting) return true;
    // Acculé : on reste se battre (la suite de think) au lieu de rester planté.
    return this.flee(threats);
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
    return isMelee(enemy) ? CASTER_MIN_DISTANCE : CASTER_VS_CASTER_MIN_DISTANCE;
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
// Nombre d'ennemis tout près pour dépenser Concentration sur une Déflagration : depuis que Concentration se recharge en
// 30 s, la garder pour les grosses mêlées évite une Déflagration ininterruptible à chaque accrochage.
const BLAST_CONCENTRATION_MIN = 3;
// La Nova de givre (15 m) vaut le coup quand un ennemi de mêlée est déjà assez près.
const NOVA_REACH = 8;

// Arcaniste : gros dégâts à distance ; Nova de givre quand la mêlée arrive, Trait de givre pour la ralentir ;
// Déflagration quand plusieurs ennemis sont collés à lui ; Near sight sur les lanceurs de sorts ; Brûlure, puis
// Trait de feu. Puissance arcanique dès qu'il a une cible.
class ArcanisteBot extends CasterBot {
  protected think() {
    // Plusieurs ennemis tout près : Déflagration. Avec la mêlée à portée de frappe, ses coups l'interrompraient : on ne
    // la lance que protégée par Concentration (déjà active, ou dépensée s'ils sont nombreux), ou rooté (fuir est inutile) ;
    // sinon on fuit d'abord (evadeMelee, plus bas, à la même distance).
    const closeEnemies = this.enemies().filter((e) => this.distanceTo(e) <= BLAST_REACH);
    if (closeEnemies.length >= 2 && !this.isCasting) {
      const meleeContact = closeEnemies.some((e) => isMelee(e));
      const protectedBlast =
        this.self.has("concentration") ||
        (closeEnemies.length >= BLAST_CONCENTRATION_MIN &&
          this.isReady("concentration") &&
          this.combat.canUse(this.self.id, "blast", true) &&
          this.tryUse("concentration"));
      if ((!meleeContact || protectedBlast || this.self.has("root")) && this.tryUse("blast")) return;
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
      (e) => isMelee(e) && this.distanceTo(e) <= 15 && !e.has("snare") && !e.has("root"),
    );
    if (approaching && this.tryUse("frostbolt", approaching)) return;

    const target = this.pickTarget(DAMAGE_PRIORITY);
    if (!target) return this.advance();
    const d = this.distanceTo(target);
    // Cible cachée par un obstacle, et pas trop près : on se rapproche jusqu'à la voir (arrêt tout contre : la
    // réflexion suivante change de branche dès que la vue est acquise). Trop près, keepDistance s'en occupe.
    if (!hasLineOfSight(this.self.state, target.state) && d >= this.minDistanceFrom(target)) return this.moveTo(target.state, 1);
    // Near sight : portée réduite ; on se rapproche à portée, sauf d'une mêlée libre (elle serait vite au contact).
    const nearSighted = this.self.has("nearSight");
    if (nearSighted) {
      const reach = spellRange(getAbility("firebolt")!, true) - 1;
      const dangerous = isMelee(target) && !target.has("root");
      if (dangerous) return this.holdPosition();
      if (d > reach) return this.moveTo(target.state, reach - 1);
    } else if (!this.keepDistance(target, this.minDistanceFrom(target), CASTER_MAX_DISTANCE)) return;
    // En place, cible en vue : on ne bouge plus (un sort à incantation doit partir immobile).
    this.stop();

    this.tryUse("arcanePower");
    // Un lanceur de sorts ennemi : sa portée réduite le force à venir au contact.
    if (isCaster(target) && !target.has("nearSight") && this.tryUse("nearSight", target)) return;
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
    if (this.obeyOrder()) return;

    const allies = this.allies();
    const byHealth = [...allies].sort((a, b) => this.hpRatio(a) - this.hpRatio(b));

    // 1. Urgence : soin instantané.
    const critical = byHealth.find((a) => this.hpRatio(a) < 0.35);
    if (critical && this.tryUse("instantHeal", critical)) return;

    // 2. Plusieurs alliés morts autour, sans ennemi trop près : Intervention divine.
    const safe = !this.enemies().some((e) => this.distanceTo(e) < CASTER_MIN_DISTANCE);
    const deadNearby = this.deadAllies().filter((a) => this.distanceTo(a) <= DIVINE_INTERVENTION_RADIUS);
    if (safe && deadNearby.length >= 2 && this.tryUse("divineIntervention")) return;

    // 3. Plusieurs blessés autour : soin de groupe.
    const hurtNearby = allies.filter((a) => this.hpRatio(a) < 0.75 && this.distanceTo(a) <= GROUP_HEAL_RADIUS);
    if (hurtNearby.length >= 3 && this.tryUse("groupHeal")) return;

    // 4. Soigner le plus blessé, en s'approchant si besoin.
    const hurt = byHealth.find((a) => this.hpRatio(a) < 0.8);
    if (hurt) {
      if (this.distanceTo(hurt) > SUPPORT_REACH) return this.moveTo(hurt.state, SUPPORT_APPROACH);
      // Blessé caché par un obstacle : on se rapproche jusqu'à le voir (arrêt tout contre : la réflexion suivante
      // change de branche dès que la vue est acquise).
      if (hurt !== self && !hasLineOfSight(self.state, hurt.state)) return this.moveTo(hurt.state, 1);
      this.stop();
      // Un blessé léger sans Renouveau de ce Prêtre : un soin sur la durée.
      const renewed = hurt.effects.some((e) => e.kind === "renew" && e.sourceId === self.id);
      if (this.hpRatio(hurt) > 0.6 && !renewed && this.tryUse("renew", hurt)) return;
      if (this.tryUse("heal", hurt)) return;
    }

    // 5. Relever un allié mort si aucun ennemi n'est trop près.
    const dead = this.nearest(this.deadAllies());
    if (dead && safe) {
      if (this.distanceTo(dead) > SUPPORT_REACH) return this.moveTo(dead.state, SUPPORT_APPROACH);
      if (this.tryUse("resurrect", dead)) return;
    }

    // 6. Buffs, en gardant de quoi soigner.
    if (self.state.mana > 500 && this.buffAllies()) return;

    // 7. Rester loin des ennemis, près des alliés.
    const enemy = this.nearest(this.enemies());
    if (enemy && this.distanceTo(enemy) < this.minDistanceFrom(enemy) && this.flee([enemy])) return;
    this.advance();
  }

  protected refuseOrder(kind: OrderId, issuer: PlayerRuntime): OrderReply | null {
    if (kind === "heal" && issuer.state.hp >= issuer.state.maxHp) return "full";
    if (kind === "heal" && this.self.state.mana < manaCost("heal")) return "noMana";
    if (kind === "buff" && this.self.state.mana < Math.min(...this.missingBuffs(issuer).map(manaCost))) return "noMana";
    return null;
  }

  protected orderDuration(kind: OrderId): number {
    if (kind === "heal") return HEAL_ORDER_DURATION;
    return kind === "buff" ? ONE_SHOT_ORDER_DURATION : Infinity;
  }

  // Soigne-moi : le joueur passe avant tout le monde jusqu'à être à pleine vie. Buff please : ses buffs manquants.
  // Retourne vrai si le Prêtre s'en occupe (déplacement ou sort).
  private obeyOrder(): boolean {
    const order = this.order;
    if (order?.kind !== "heal" && order?.kind !== "buff") return false;
    const issuer = order.issuer;
    const missing = order.kind === "buff" ? this.missingBuffs(issuer) : [];
    const done = order.kind === "heal" ? issuer.state.hp >= issuer.state.maxHp : missing.length === 0;
    if (done) {
      this.order = null;
      return false;
    }
    if (this.distanceTo(issuer) > SUPPORT_REACH) {
      this.moveTo(issuer.state, SUPPORT_APPROACH);
      return true;
    }
    if (order.kind === "buff") return missing.some((buff) => this.tryUse(buff, issuer));
    if (this.hpRatio(issuer) < 0.35 && this.tryUse("instantHeal", issuer)) return true;
    return this.tryUse("heal", issuer);
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

// Barde : Réveil d'un allié mezzé, Ballade rythmée quand le groupe est entravé, Mez de zone, Oubli, Mez ciblé, Buff
// dextérité ; Chant de second souffle en combat, Chant de vitesse sinon.
const SONG_COMBAT_LINGER = 8;
const SPEED_ORDER_DURATION = 15;
class BardeBot extends CasterBot {
  protected prepare() {
    this.stop();
    this.ensureSong(true);
    this.buffAllies();
  }

  protected think() {
    this.ensureSong();
    if (this.evadeMelee()) return;
    if (this.isCasting) return;
    if (this.obeyOrder()) return;
    const allies = this.allies();

    // 1. Réveiller un allié mezzé (pas soi-même : on ne peut rien faire sous mez).
    const mezzed = allies.find((a) => a !== this.self && a.has("mez") && this.distanceTo(a) <= SUPPORT_REACH);
    if (mezzed && this.tryUse("awaken", mezzed)) return;

    // 2. Ballade rythmée : au moins trois alliés rootés ou ralentis.
    if (allies.filter((a) => a.has("root") || a.has("snare")).length >= 3 && this.tryUse("ballad")) return;

    // 3. Mez de zone sur au moins deux ennemis non immunisés (un ennemi mezzé est aussi immunisé).
    const mezGroup = this.bestGroup(AOE_MEZ_RADIUS, (e) => !e.has("immuneMez"));
    if (mezGroup.size >= 2 && this.tryUse("aoeMez", mezGroup.center)) return;

    // 4. Dégager un lanceur de sorts allié : Mez sur la mêlée qui le frappe (il se casse aux dégâts, mais il gagne du
    // temps pour fuir ou finir son sort).
    // Pas pour se dégager soi-même : le coup suivant couperait l'incantation.
    const hitters = allies
      .filter((a) => a !== this.self && isCaster(a) && this.combat.now - a.lastMeleeHitAt < 2)
      .map((a) => this.world.players.get(a.lastMeleeAttackerId ?? ""))
      .filter((e): e is PlayerRuntime => !!e && e.alive && this.world.visible.has(e.id) && this.worthMezzing(e));
    if (hitters.some((e) => this.tryUse("mez", e))) return;

    // 5. Oubli sur un ennemi en train d'incanter : son sort n'aura aucun effet.
    const caster = this.enemies().find((e) => e.state.castAbility !== "" && !e.has("oblivion"));
    if (caster && this.tryUse("silence", caster)) return;

    // 6. Mez ciblé sur un ennemi de mêlée qui approche.
    const approaching = this.enemies().find(
      (e) => isMelee(e) && this.distanceTo(e) <= 12 && this.worthMezzing(e),
    );
    if (approaching && this.tryUse("mez", approaching)) return;

    // 7. Buff dextérité, en gardant de quoi contrôler.
    if (this.self.state.mana > 500 && this.buffAllies()) return;

    this.holdPosition();
  }

  // Buff dextérité sur un allié qui ne l'a pas encore. Retourne vrai si un buff est lancé.
  private buffAllies(): boolean {
    const ally = this.allies().find((a) => !a.has("buffDexterity") && this.distanceTo(a) <= SUPPORT_REACH);
    return !!ally && this.tryUse("buffDexterity", ally);
  }

  protected refuseOrder(kind: OrderId, issuer: PlayerRuntime): OrderReply | null {
    const mana = this.self.state.mana;
    if (kind === "awaken") {
      if (!issuer.has("mez")) return "notMezzed";
      if (!this.isReady("awaken")) return "cooldown";
      if (mana < manaCost("awaken")) return "noMana";
    }
    // Vitesse : un Barde qui la chante déjà laisse l'ordre à un autre Barde (celui qui chante le second souffle).
    if (kind === "speed" && this.self.state.song === "speedSong" && this.combat.now >= this.combatSongUntil && this.order?.kind !== "resource")
      return "alreadySinging";
    if (kind === "resource" && resourceFull(issuer)) return "full";
    if (kind === "resource" && this.self.state.song !== "secondWind" && mana < manaCost("secondWind")) return "noMana";
    if (kind === "buff" && mana < manaCost("buffDexterity")) return "noMana";
    return null;
  }

  protected orderDuration(kind: OrderId): number {
    // Vitesse : il suffit de reprendre le Chant de vitesse (voir receiveOrder).
    if (kind === "speed") return 0;
    return kind === "awaken" || kind === "buff" ? ONE_SHOT_ORDER_DURATION : Infinity;
  }

  // Réveille-moi, Buff please, et rester à portée de chant pour « besoin de mana ». Retourne vrai si le Barde s'en
  // occupe (déplacement ou sort).
  private obeyOrder(): boolean {
    const order = this.order;
    if (!order) return false;
    const issuer = order.issuer;
    if (order.kind === "resource") {
      if (resourceFull(issuer)) {
        this.order = null;
        return false;
      }
      if (this.distanceTo(issuer) <= SUPPORT_APPROACH) return false;
      this.moveTo(issuer.state, SUPPORT_APPROACH - 4);
      return true;
    }
    if (order.kind !== "awaken" && order.kind !== "buff") return false;
    const done = order.kind === "awaken" ? !issuer.has("mez") : this.missingBuffs(issuer).length === 0;
    if (done) {
      this.order = null;
      return false;
    }
    if (this.distanceTo(issuer) > SUPPORT_REACH) {
      this.moveTo(issuer.state, SUPPORT_APPROACH);
      return true;
    }
    return this.tryUse(order.kind === "awaken" ? "awaken" : "buffDexterity", issuer);
  }

  // Un Mez ciblé qui tiendra : pas sur un ennemi immunisé, stun, ou qu'un allié frappe déjà (le mez casserait aussitôt,
  // et l'immunité qui suit, 40 s, le rendrait insensible au mez de zone).
  private worthMezzing(enemy: PlayerRuntime): boolean {
    if (enemy.has("immuneMez") || enemy.has("stun")) return false;
    return !this.allies().some(
      (a) => a.targetId === enemy.id && a.state.attacking && distance(a.state, enemy.state) <= MELEE_RANGE + 1,
    );
  }

  // Chant de second souffle en combat, Chant de vitesse sinon (décidé le 2026-11-21). En combat, le Chant de vitesse
  // ne sert plus aux alliés engagés (il se coupe dès qu'ils agissent ou sont touchés) : dès que deux alliés à portée de
  // chant sont engagés, le Barde passe au second souffle, et ne revient à la vitesse qu'après SONG_COMBAT_LINGER
  // secondes sans allié engagé. Un ordre l'emporte : « besoin de mana » (second souffle) ou « vitesse » (Chant de
  // vitesse pendant SPEED_ORDER_DURATION secondes).
  private ensureSong(preparing = false) {
    if (this.order?.kind === "resource" && resourceFull(this.order.issuer)) this.order = null;
    const now = this.combat.now;
    // Engagés : alliés (sans compter le Barde) qui ont agi ou été touchés récemment, avec un ennemi en vue (les buffs
    // de la préparation ne comptent pas).
    const engaged =
      !preparing && this.enemies().length > 0
        ? this.allies().filter(
            (a) => a !== this.self && this.distanceTo(a) <= SONG_RANGE && now - a.lastEngagedAt < SONG_SPEED_CALM,
          ).length
        : 0;
    if (engaged >= 2) this.combatSongUntil = now + SONG_COMBAT_LINGER;
    const wanted =
      this.order?.kind === "resource"
        ? "secondWind"
        : now < this.speedOrderUntil || now >= this.combatSongUntil
          ? "speedSong"
          : "secondWind";
    if (this.self.state.song !== wanted) this.tryUse(wanted);
  }

  // Fin du chant de combat, et de l'ordre « vitesse » (voir ensureSong).
  private combatSongUntil = -Infinity;
  private speedOrderUntil = -Infinity;

  // L'ordre « vitesse » ne dure qu'un instant (le suivi d'office reprend aussitôt) : le Barde retient seulement de
  // chanter la vitesse pendant SPEED_ORDER_DURATION secondes.
  receiveOrder(kind: OrderId, issuer: PlayerRuntime, target: PlayerRuntime | null, automatic = false): OrderReply {
    const reply = super.receiveOrder(kind, issuer, target, automatic);
    if (kind === "speed" && reply === kind) this.speedOrderUntil = this.combat.now + SPEED_ORDER_DURATION;
    return reply;
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

    // Assistez-moi : la cible du joueur, en chargeant si elle est loin.
    const assisted = this.assistTarget();
    if (assisted) {
      if (this.distanceTo(assisted) >= CHARGE_MIN && this.tryCharge(assisted)) return;
      return this.fight(assisted);
    }

    if (!ward) {
      const target = this.pickTarget(DAMAGE_PRIORITY);
      if (!target) return this.advance();
      if (this.distanceTo(target) >= CHARGE_MIN && this.tryCharge(target)) return;
      return this.fight(target);
    }

    const attacked = this.combat.now - ward.lastMeleeHitAt < 3;
    // Interception : à débloquer, hors de la barre pour l'instant (tryUse l'ignore alors).
    if (attacked && this.hpRatio(ward) < 0.4) this.tryUse("intercept", ward);

    // L'agresseur du protégé, sinon l'ennemi le plus proche de lui. Loin : Charge (stun 4 s) pour le dégager.
    const attacker = attacked ? this.world.players.get(ward.lastMeleeAttackerId ?? "") : undefined;
    const threat =
      attacker?.alive && this.world.visible.has(attacker.id)
        ? attacker
        : this.nearest(this.enemies().filter((e) => distance(e.state, ward.state) <= 8));
    if (threat && this.distanceTo(threat) >= CHARGE_MIN && this.tryCharge(threat)) return;
    if (threat) return this.fight(threat);

    // Le protégé est tranquille : Charge sur un lanceur de sorts ennemi, de préférence en pleine incantation.
    const casters = this.enemies().filter((e) => isCaster(e) && this.distanceTo(e) >= CHARGE_MIN && !e.has("meleeImmune"));
    const caster = casters.find((e) => e.state.castAbility) ?? this.nearest(casters);
    if (caster && this.tryCharge(caster)) return;

    // Rien à signaler : rejoindre le protégé (la Garde ne fonctionne qu'à 4 m),
    // puis mener le groupe : le protégé suit le Gardien.
    if (this.distanceTo(ward) > 5) this.moveTo(ward.state, 2.5);
    else this.advance();
  }

  // Au contact : Coup de bouclier (stun), sinon Frappe handicapante dans le dos, sinon Coup puissant.
  // Une technique déjà en attente n'est pas remplacée, sauf un Coup puissant par le Coup de bouclier (le stun dégage
  // le lanceur protégé ; le Coup puissant reviendra au coup suivant).
  private fight(target: PlayerRuntime) {
    this.meleeAttack(target);
    const queued = this.self.state.queuedAbility;
    if (this.distanceTo(target) > MELEE_RANGE || (queued && queued !== "powerStrike")) return;
    if (!target.has("stun") && !target.has("immuneStun") && this.tryUse("shieldBash", target)) return;
    if (queued) return;
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
    // Une mêlée qui frappe un lanceur de sorts allié : la Provocation lui fait perdre la moitié de ses dégâts sur lui.
    for (const ally of this.allies()) {
      if (ally === this.self || !isCaster(ally) || !recent(ally)) continue;
      const hitter = enemies.find((e) => e.id === ally.lastMeleeAttackerId);
      if (hitter && !hitter.has("taunted")) return hitter;
    }
    const wounded = this.otherAllies().filter((a) => this.hpRatio(a) < 0.5);
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
      (e) => isMelee(e) && group.some((a) => distance(e.state, a.state) <= MELEE_RANGE + 1),
    );
    if (attackers.length >= 3) return true;
    return !!ward && group.includes(ward) && this.hpRatio(ward) < 0.3 && this.combat.now - ward.lastMeleeHitAt < 2;
  }

  // Assistez-moi : le Gardien n'obéit que GARDIEN_ASSIST_DURATION secondes (il retourne ensuite protéger).
  protected orderDuration(kind: OrderId): number {
    return kind === "assist" ? GARDIEN_ASSIST_DURATION : Infinity;
  }

  // Charge, sauf sur une cible sous Rempart (insensible à la mêlée : ni dégâts ni stun).
  private tryCharge(target: PlayerRuntime): boolean {
    return !target.has("meleeImmune") && this.tryUse("charge", target);
  }

  // Le joueur qui a demandé sa protection ; sinon le lanceur de sorts allié attaqué le plus récemment, sinon le plus
  // proche. Le protégé reste le même tant qu'il est vivant, à moins de 20 m, et attaqué (ou qu'aucun autre ne l'est) : changer
  // de protégé à chaque coup reçu par un autre lanceur faisait reposer la Garde sans arrêt et vidait l'endurance
  // (décidé le 2026-11-21).
  private chooseWard(): PlayerRuntime | undefined {
    if (this.order?.kind === "protect") return this.order.issuer;
    const casters = this.otherAllies().filter((a) => isCaster(a));
    const isAttacked = (c: PlayerRuntime) => this.combat.now - c.lastMeleeHitAt < 3;
    const attacked = casters.filter(isAttacked).sort((a, b) => b.lastMeleeHitAt - a.lastMeleeHitAt);
    const current = casters.find((c) => c.getEffect("guarded")?.sourceId === this.self.id);
    if (current && this.distanceTo(current) <= 20 && (isAttacked(current) || attacked.length === 0)) return current;
    return attacked[0] ?? this.nearest(casters);
  }

  private ensureGuard(ward: PlayerRuntime) {
    if (ward.getEffect("guarded")?.sourceId !== this.self.id) this.tryUse("guard", ward);
  }
}
