import {
  ARENA_SIZE,
  MELEE_RANGE,
  NO_INPUT,
  PLAYER_RADIUS,
  START_ZONES,
  directionToInput,
  distance,
  getAbility,
  isInsideObstacle,
  isOffensive,
  type ClassId,
  type MatchPhase,
  type MoveInput,
  ORDER_BUFFS,
  type OrderId,
  type OrderReply,
  type Position,
} from "@arena/shared";
import type { CombatSystem } from "../CombatSystem";
import type { PlayerRuntime } from "../PlayerRuntime";
import type { Pathfinder } from "./Pathfinder";

// Ce qu'un bot sait de la partie : uniquement ce que son équipe voit (brouillard de guerre).
export interface BotWorld {
  phase: MatchPhase;
  players: Map<string, PlayerRuntime>;
  visible: Set<string>;
}

export const CASTER_CLASSES: ClassId[] = ["arcaniste", "pretre", "barde"];
export const MELEE_CLASSES: ClassId[] = ["lame", "gardien"];
// Combattant au contact, ou lanceur de sorts.
export const isMelee = (p: PlayerRuntime): boolean => MELEE_CLASSES.includes(p.classDef.id);
export const isCaster = (p: PlayerRuntime): boolean => CASTER_CLASSES.includes(p.classDef.id);

// Fréquence des décisions (le déplacement, lui, est ajusté à chaque tick).
const THINK_INTERVAL = 0.25;
// Recalcul régulier du chemin, la destination pouvant bouger (cible en mouvement).
const REPATH_INTERVAL = 1;
// Distance à partir de laquelle un point de passage est considéré comme atteint.
const WAYPOINT_REACHED = 0.6;
// Temps sans avancer avant de considérer le bot comme bloqué et de recalculer son chemin.
const STUCK_TIME = 1;
// Distance parcourue à chaque décision de fuite.
const FLEE_DISTANCE = 8;
// Distance aux bords de l'arène en dessous de laquelle on évite de fuir ou d'explorer.
const EDGE_MARGIN = 10;
// Distance à laquelle un lanceur de sorts suit son escorte quand aucun ennemi n'est en vue.
const ESCORT_DISTANCE = 3;
// Angles essayés (en degrés) si la direction de fuite idéale est bloquée.
const FLEE_ANGLES = [0, 30, -30, 60, -60, 90, -90, 120, -120];

// Suivez-moi : distance à laquelle chaque bot suit le joueur (tirée au hasard pour qu'ils ne s'empilent pas).
const FOLLOW_MIN_DISTANCE = 2.5;
const FOLLOW_MAX_DISTANCE = 5;
// Suivi d'office du début du combat (voir followHumansAtStart) : il cesse si le joueur suivi ne s'éloigne pas d'au
// moins 1 m de sa position pendant ce temps (secondes), pour qu'un joueur absent ne retienne pas toute son équipe.
const START_FOLLOW_IDLE = 15;
// Chef d'une équipe sans humain : longueur minimale de chaque étape d'exploration (mètres).
const SCOUT_MIN_LEG = 25;
// Durée maximale de l'exploration au hasard du chef (secondes).
const SCOUT_MAX_TIME = 45;

// Ordre donné par un joueur (roue de la molette) : qui l'a donné, sa cible (Assistez-moi), et jusqu'à quand il vaut.
export interface BotOrder {
  kind: OrderId;
  issuer: PlayerRuntime;
  target: PlayerRuntime | null;
  until: number;
  // Donné d'office au début du combat, et non par le joueur.
  automatic?: boolean;
}

// Erreur humaine : les bots ne sont pas des machines parfaites. Modifiable (les tests la coupent).
export const HUMAN_ERRORS = {
  enabled: true,
  // Délai (en secondes) avant de remarquer un ennemi qui vient d'apparaître.
  reactionMin: 0.3,
  reactionMax: 0.8,
  // Probabilité de laisser passer une décision : hésitation, distraction. Retarde tout,
  // y compris les soins, la fuite et les interruptions.
  hesitation: 0.15,
  // Probabilité, en choisissant une nouvelle cible, de prendre un ennemi au hasard plutôt que le meilleur.
  wrongTarget: 0.15,
};

// Base commune des bots : perception, utilisation des compétences et déplacements.
// Chaque classe définit son comportement dans think() (voir classBots.ts).
// Un bot joue avec les mêmes commandes qu'un joueur : il ne fait que choisir quoi envoyer.
export class BotBrain {
  protected world!: BotWorld;
  private destination: Position | null = null;
  private stopDistance = 0;
  private path: Position[] = [];
  // La dernière recherche n'a trouvé aucun chemin.
  private pathMissing = false;
  private repathTimer = 0;
  // Décalage aléatoire pour que les bots ne réfléchissent pas tous au même moment.
  private thinkTimer = Math.random() * THINK_INTERVAL;
  // Mémoire et exploration quand aucun ennemi n'est en vue.
  private lastSeenEnemy: Position | null = null;
  private exploreTarget: Position | null = null;
  // Début du combat d'une équipe sans humain (voir followHumansAtStart) : attente jusqu'à holdUntil, et le chef
  // explore la carte au hasard (scouting) jusqu'au premier ennemi aperçu.
  private holdUntil = -Infinity;
  private scouting = false;
  private scoutUntil = Infinity;
  private visitedEnemyZone = false;
  private lastInput: MoveInput = NO_INPUT;
  private lastPosition: Position | null = null;
  private stuckTime = 0;
  // Instant (temps de la partie) à partir duquel chaque ennemi visible est remarqué.
  private noticedAt = new Map<string, number>();
  // Ordre en cours (un seul à la fois : un nouvel ordre remplace le précédent).
  order: BotOrder | null = null;
  private followDistance = FOLLOW_MIN_DISTANCE + Math.random() * (FOLLOW_MAX_DISTANCE - FOLLOW_MIN_DISTANCE);
  // Suivi d'office : dernière position où le joueur suivi a bougé, et quand.
  private guideMark: { x: number; z: number; at: number } | null = null;
  // Suivi d'office mis de côté par un ordre ponctuel (buff, soin, vitesse…) : il reprend quand cet ordre est fini.
  private resumeFollow: BotOrder | null = null;

  constructor(
    readonly player: PlayerRuntime,
    protected combat: CombatSystem,
    private pathfinder: Pathfinder,
  ) {}

  update(dt: number, world: BotWorld) {
    if (!this.player.alive) {
      this.order = null;
      this.resumeFollow = null;
      this.stop();
      return;
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer += THINK_INTERVAL;
      this.world = world;
      this.updateNoticed();
      this.rememberEnemies();
      if (world.phase === "preparation") this.prepare();
      else if (world.phase === "fighting") {
        this.expireOrder();
        // Attente du départ (équipe sans humain), sauf si un ennemi se montre déjà : l'attente cesse alors pour de bon.
        if (this.enemies().length > 0) this.holdUntil = -Infinity;
        if (this.combat.now < this.holdUntil) {
          this.stop();
          return;
        }
        // Chef éclaireur : il explore tant qu'aucun ennemi n'a été aperçu (ses réflexes de classe, comme rester près
        // d'un protégé, retiendraient toute l'équipe qui le suit).
        if (this.scouting && (this.lastSeenEnemy || this.enemies().length > 0 || this.combat.now > this.scoutUntil)) {
          this.scouting = false;
        }
        if (this.scouting) this.scout();
        // Hésitation : le bot continue ce qu'il faisait au lieu de réagir.
        else if (!(HUMAN_ERRORS.enabled && Math.random() < HUMAN_ERRORS.hesitation)) this.think();
        this.follow();
      } else this.stop();
    }
    this.steer(dt);
  }

  // Temps de réaction : un ennemi qui apparaît n'est pris en compte qu'après un court délai.
  private updateNoticed() {
    for (const id of this.noticedAt.keys()) {
      if (!this.world.visible.has(id)) this.noticedAt.delete(id);
    }
    for (const id of this.world.visible) {
      if (this.noticedAt.has(id)) continue;
      const delay = HUMAN_ERRORS.enabled
        ? HUMAN_ERRORS.reactionMin + Math.random() * (HUMAN_ERRORS.reactionMax - HUMAN_ERRORS.reactionMin)
        : 0;
      this.noticedAt.set(id, this.combat.now + delay);
    }
  }

  // Retient la position de l'ennemi visible le plus proche, pour y retourner s'il disparaît.
  private rememberEnemies() {
    const enemy = this.nearest(this.enemies());
    if (enemy) {
      this.lastSeenEnemy = { x: enemy.state.x, z: enemy.state.z };
      this.exploreTarget = null;
    }
  }

  // --- Ordres ---

  // Reçoit un ordre d'un joueur de son équipe : retourne la réponse du bot. S'il refuse, il garde son ordre précédent.
  receiveOrder(kind: OrderId, issuer: PlayerRuntime, target: PlayerRuntime | null, automatic = false): OrderReply {
    const refusal = this.refuseOrder(kind, issuer);
    if (refusal) return refusal;
    // Un ordre du joueur qui n'est pas Suivez-moi interrompt le suivi d'office sans l'annuler.
    this.resumeFollow = kind !== "follow" && this.order?.automatic ? this.order : null;
    this.order = { kind, issuer, target, until: this.combat.now + this.orderDuration(kind), automatic };
    if (automatic) this.guideMark = { x: issuer.state.x, z: issuer.state.z, at: this.combat.now };
    return kind;
  }

  // Raison de ne pas pouvoir obéir (plus de mana, compétence en recharge…), ou null.
  protected refuseOrder(_kind: OrderId, _issuer: PlayerRuntime): OrderReply | null {
    return null;
  }

  // Durée maximale d'un ordre (secondes) ; par défaut, jusqu'au prochain ordre.
  protected orderDuration(_kind: OrderId): number {
    return Infinity;
  }

  // Buffs que ce bot peut lancer et que le joueur n'a pas (Buff please).
  missingBuffs(player: PlayerRuntime): string[] {
    return (ORDER_BUFFS[this.classId] ?? []).filter((buff) => !player.has(buff));
  }

  // Un ordre cesse à la mort ou au départ (déconnexion) de celui qui l'a donné ou de sa cible, ou une fois son temps
  // écoulé.
  private expireOrder() {
    const order = this.order;
    if (!order) return;
    const present = (p: PlayerRuntime) => p.alive && this.world.players.get(p.id) === p;
    if (!present(order.issuer) || (order.target && !present(order.target)) || this.combat.now > order.until) this.order = null;
  }

  // Suivez-moi : tant qu'aucun ennemi n'est en vue, le bot suit le joueur ; au premier ennemi aperçu, l'ordre cesse
  // et le bot engage le combat comme d'habitude.
  private follow() {
    if (this.enemies().length > 0) this.resumeFollow = null;
    // Ordre ponctuel terminé : le suivi d'office reprend, si le joueur suivi est toujours là.
    const resume = this.resumeFollow;
    if (!this.order && resume) {
      this.resumeFollow = null;
      if (resume.issuer.alive && this.world.players.get(resume.issuer.id) === resume.issuer) this.order = resume;
    }
    if (this.order?.kind !== "follow") return;
    if (this.enemies().length > 0 || this.guideIdle()) {
      this.order = null;
      return;
    }
    if (!this.isCasting) this.moveTo(this.order.issuer.state, this.followDistance);
  }

  // Suivi d'office : le joueur suivi n'a pas bougé depuis START_FOLLOW_IDLE secondes.
  private guideIdle(): boolean {
    if (!this.order?.automatic) return false;
    const { x, z } = this.order.issuer.state;
    const now = this.combat.now;
    if (!this.guideMark || distance(this.guideMark, { x, z }) > 1) this.guideMark = { x, z, at: now };
    return now - this.guideMark.at > START_FOLLOW_IDLE;
  }

  // Assistez-moi : la cible du joueur, tant que l'équipe la voit.
  protected assistTarget(): PlayerRuntime | undefined {
    const target = this.order?.kind === "assist" ? this.order.target : null;
    return target?.alive && this.world.visible.has(target.id) ? target : undefined;
  }

  // Pendant la préparation, par défaut, on attend sans bouger.
  protected prepare() {
    this.stop();
  }

  // Comportement par défaut : rejoindre l'ennemi visible le plus proche et le frapper.
  protected think() {
    const enemy = this.nearest(this.enemies());
    if (enemy) this.meleeAttack(enemy);
    else this.advance();
  }

  // --- Perception ---

  protected get self(): PlayerRuntime {
    return this.player;
  }

  protected get classId(): ClassId {
    return this.player.classDef.id;
  }

  protected enemies(): PlayerRuntime[] {
    return [...this.world.players.values()].filter(
      (p) =>
        p.alive &&
        p.state.team !== this.player.state.team &&
        (this.noticedAt.get(p.id) ?? Infinity) <= this.combat.now,
    );
  }

  // Alliés vivants, soi-même compris.
  protected allies(): PlayerRuntime[] {
    return [...this.world.players.values()].filter((p) => p.alive && p.state.team === this.player.state.team);
  }

  // Alliés vivants, sans soi-même.
  protected otherAllies(): PlayerRuntime[] {
    return this.allies().filter((p) => p !== this.player);
  }

  protected deadAllies(): PlayerRuntime[] {
    return [...this.world.players.values()].filter((p) => !p.alive && p.state.team === this.player.state.team);
  }

  protected distanceTo(other: PlayerRuntime | Position): number {
    const pos = "state" in other ? other.state : other;
    return distance(this.player.state, pos);
  }

  protected nearest(players: PlayerRuntime[]): PlayerRuntime | undefined {
    let best: PlayerRuntime | undefined;
    let bestDistance = Infinity;
    for (const p of players) {
      const d = this.distanceTo(p);
      if (d < bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
    return best;
  }

  // Cible prioritaire : celle du joueur qui a demandé assistance, sinon le premier groupe de classes qui a un représentant visible, puis le plus proche.
  // On garde la cible actuelle tant qu'elle reste dans le meilleur groupe, pour ne pas papillonner.
  protected pickTarget(priorities: ClassId[][]): PlayerRuntime | undefined {
    const assisted = this.assistTarget();
    if (assisted) return assisted;
    const enemies = this.enemies();
    const rank = (p: PlayerRuntime) => {
      const index = priorities.findIndex((group) => group.includes(p.classDef.id));
      return index === -1 ? priorities.length : index;
    };
    const bestRank = Math.min(...enemies.map(rank));
    const candidates = enemies.filter((p) => rank(p) === bestRank);
    const current = candidates.find((p) => p.id === this.player.targetId);
    if (current) return current;
    // Erreur de jugement : de temps en temps, une cible moins pertinente.
    if (HUMAN_ERRORS.enabled && enemies.length > 0 && Math.random() < HUMAN_ERRORS.wrongTarget) {
      return enemies[Math.floor(Math.random() * enemies.length)];
    }
    return this.nearest(candidates);
  }

  // Ennemis de mêlée proches, ou qui viennent de nous frapper au corps à corps.
  protected meleeThreats(radius: number): PlayerRuntime[] {
    const recentlyHit = this.combat.now - this.player.lastMeleeHitAt < 1.5;
    return this.enemies().filter(
      (p) =>
        (isMelee(p) && this.distanceTo(p) <= radius) ||
        (recentlyHit && p.id === this.player.lastMeleeAttackerId),
    );
  }

  protected get isCasting(): boolean {
    return this.player.state.castAbility !== "";
  }

  protected hpRatio(p: PlayerRuntime): number {
    return p.state.hp / p.state.maxHp;
  }

  // --- Actions ---

  // Tente d'utiliser une compétence (sur la cible donnée, ou sans cible). Retourne vrai si c'est parti.
  protected tryUse(abilityId: string, target?: PlayerRuntime): boolean {
    const ability = getAbility(abilityId);
    // Compétence absente de la barre (à débloquer) : rien à tenter, et la cible ne change pas.
    if (!ability || !this.player.classDef.abilities.includes(abilityId)) return false;
    if (target) this.combat.setTarget(this.player.id, target.id === this.player.id ? null : target.id);
    // Une compétence offensive exige de faire face à la cible.
    if (isOffensive(ability)) this.combat.faceTarget(this.player.id);
    if (!this.combat.canUse(this.player.id, abilityId, true)) return false;
    // Une incantation exige d'être immobile : on ne s'arrête que si elle va vraiment partir.
    if (ability.castTime > 0) this.stop();
    this.combat.useAbility(this.player.id, abilityId);
    return true;
  }

  protected isReady(abilityId: string): boolean {
    return (this.player.cooldowns.get(abilityId) ?? 0) <= this.combat.now;
  }

  // Rejoint la cible au corps à corps et active l'attaque automatique.
  protected meleeAttack(target: PlayerRuntime) {
    this.combat.setTarget(this.player.id, target.id);
    if (this.distanceTo(target) > MELEE_RANGE - 0.5) {
      this.moveTo(target.state, MELEE_RANGE - 1);
    } else {
      this.stop();
      this.combat.faceTarget(this.player.id);
    }
    if (!this.player.state.attacking) this.combat.toggleAttack(this.player.id);
  }

  // Sans ennemi en vue : les lanceurs suivent un allié de mêlée (à défaut, un joueur humain de leur équipe) ;
  // les autres vont là où un ennemi a été vu pour la dernière fois, puis vers le camp adverse, puis explorent.
  protected advance() {
    if (CASTER_CLASSES.includes(this.classId)) {
      const others = this.otherAllies();
      const escort =
        this.nearest(others.filter((p) => isMelee(p))) ??
        this.nearest(others.filter((p) => !p.state.isBot));
      if (escort) {
        this.moveTo(escort.state, ESCORT_DISTANCE);
        return;
      }
    }
    if (this.lastSeenEnemy && this.distanceTo(this.lastSeenEnemy) > 3) {
      this.moveTo(this.lastSeenEnemy, 2);
      return;
    }
    this.lastSeenEnemy = null;
    if (!this.exploreTarget || this.distanceTo(this.exploreTarget) < 3) {
      this.exploreTarget = this.visitedEnemyZone ? this.randomPoint() : START_ZONES[1 - this.player.state.team];
      this.visitedEnemyZone = true;
    }
    this.moveTo(this.exploreTarget, 2);
  }

  // Point libre au hasard dans l'arène, à l'écart des bords, et si possible à au moins minDistance mètres du bot.
  private randomPoint(minDistance = 0): Position {
    const range = ARENA_SIZE / 2 - EDGE_MARGIN;
    for (let attempt = 0; ; attempt++) {
      const point = { x: (Math.random() * 2 - 1) * range, z: (Math.random() * 2 - 1) * range };
      if (isInsideObstacle(point, PLAYER_RADIUS + 0.5)) continue;
      if (attempt < 50 && this.distanceTo(point) < minDistance) continue;
      return point;
    }
  }

  // Début du combat d'une équipe sans humain : attendre ce temps (secondes) avant d'agir.
  // Sans chef (mort avant le contact), le bot explore lui aussi au hasard au lieu de foncer vers le camp adverse.
  holdStart(seconds: number) {
    this.holdUntil = this.combat.now + seconds;
    this.visitedEnemyZone = true;
  }

  // Chef d'une équipe sans humain : exploration au hasard, étape par étape (ses coéquipiers le suivent).
  private scout() {
    if (!this.exploreTarget || this.distanceTo(this.exploreTarget) < 3) this.exploreTarget = this.randomPoint(SCOUT_MIN_LEG);
    this.moveTo(this.exploreTarget, 2);
  }

  // Début du combat d'une équipe sans humain : ce bot est le chef qui explore.
  // L'exploration au hasard dure au plus SCOUT_MAX_TIME secondes ; ensuite, le chef va vers le camp adverse.
  startScouting() {
    this.scouting = true;
    this.scoutUntil = this.holdUntil + SCOUT_MAX_TIME;
    this.exploreTarget = null;
    this.visitedEnemyZone = false;
  }

  // Reste entre min et max mètres de la cible : s'approche si trop loin, recule si trop près.
  // Retourne vrai si le bot est déjà à bonne distance.
  protected keepDistance(target: PlayerRuntime, min: number, max: number): boolean {
    const d = this.distanceTo(target);
    if (d > max) {
      this.moveTo(target.state, max - 2);
      return false;
    }
    if (d < min) {
      // Acculé (aucune direction de fuite) : on se bat d'ici plutôt que d'attendre sans rien faire.
      return !this.flee([target]);
    }
    return true;
  }

  // S'éloigne des menaces, en se rapprochant si possible de ses alliés. Retourne faux si aucune direction n'est libre
  // (acculé contre un bord ou un obstacle).
  protected flee(threats: PlayerRuntime[]): boolean {
    // Rooté (ou contrôlé) : fuir ne mène nulle part, le bot agit sur place.
    if (this.player.immobilized) return false;
    const pos = this.player.state;
    let dx = 0;
    let dz = 0;
    for (const threat of threats) {
      const vx = pos.x - threat.state.x;
      const vz = pos.z - threat.state.z;
      const d = Math.max(0.5, Math.hypot(vx, vz));
      // Plus la menace est proche, plus elle pèse dans la direction de fuite.
      dx += vx / (d * d);
      dz += vz / (d * d);
    }
    let length = Math.hypot(dx, dz);
    if (length < 1e-6) return false;
    dx /= length;
    dz /= length;

    // Attirance vers le reste du groupe, qui pourra nous protéger.
    const others = this.otherAllies();
    if (others.length > 0) {
      const cx = others.reduce((sum, p) => sum + p.state.x, 0) / others.length;
      const cz = others.reduce((sum, p) => sum + p.state.z, 0) / others.length;
      const toGroup = Math.hypot(cx - pos.x, cz - pos.z);
      if (toGroup > 4) {
        dx += ((cx - pos.x) / toGroup) * 0.8;
        dz += ((cz - pos.z) / toGroup) * 0.8;
        length = Math.hypot(dx, dz);
        if (length > 1e-6) {
          dx /= length;
          dz /= length;
        }
      }
    }

    // On essaie la direction idéale, puis des directions de plus en plus écartées, en évitant d'abord les bords de
    // l'arène où l'on finirait acculé ; si tout est refusé (combat près d'une zone de départ, proche du bord), on
    // accepte d'approcher du bord plutôt que de rester planté.
    for (const limit of [ARENA_SIZE / 2 - EDGE_MARGIN, ARENA_SIZE / 2 - 2]) {
      for (const degrees of FLEE_ANGLES) {
        const angle = (degrees * Math.PI) / 180;
        const rx = dx * Math.cos(angle) - dz * Math.sin(angle);
        const rz = dx * Math.sin(angle) + dz * Math.cos(angle);
        const point = { x: pos.x + rx * FLEE_DISTANCE, z: pos.z + rz * FLEE_DISTANCE };
        if (Math.abs(point.x) > limit || Math.abs(point.z) > limit) continue;
        if (isInsideObstacle(point, PLAYER_RADIUS + 0.3)) continue;
        this.moveTo(point, 0.5);
        return true;
      }
    }
    return false;
  }

  // --- Déplacement ---

  // Se rend à moins de stopDistance de la destination, en contournant les obstacles.
  protected moveTo(destination: Position, stopDistance: number) {
    const moved = !this.destination || distance(this.destination, destination) > 1.5;
    this.destination = { x: destination.x, z: destination.z };
    this.stopDistance = stopDistance;
    if (moved) this.repathTimer = 0;
  }

  protected stop() {
    this.destination = null;
    this.path = [];
    this.setInput(NO_INPUT);
  }

  private steer(dt: number) {
    if (!this.destination) return;
    const pos = this.player.state;
    if (distance(pos, this.destination) <= this.stopDistance) {
      this.stop();
      return;
    }

    this.repathTimer -= dt;
    // Sans chemin possible, on ne recherche pas à chaque tick (une recherche sans issue parcourt toute la grille) : on
    // avance tout droit et on réessaie au prochain recalcul.
    if (this.repathTimer <= 0 || (this.path.length === 0 && !this.pathMissing)) {
      const path = this.pathfinder.findPath(pos, this.destination);
      this.path = path ?? [];
      this.pathMissing = !path;
      this.repathTimer = REPATH_INTERVAL;
    }
    while (this.path.length > 1 && distance(pos, this.path[0]) < WAYPOINT_REACHED) this.path.shift();

    const next = this.path[0] ?? this.destination;
    const dx = next.x - pos.x;
    const dz = next.z - pos.z;
    const length = Math.hypot(dx, dz);
    this.setInput(length > 1e-3 ? directionToInput({ x: dx / length, z: dz / length }) : NO_INPUT);
    this.detectStuck(dt);
  }

  // Un bot qui n'avance plus alors qu'il essaie de bouger recalcule son chemin.
  private detectStuck(dt: number) {
    const pos = { x: this.player.state.x, z: this.player.state.z };
    const moving = this.lastInput !== NO_INPUT;
    if (moving && !this.player.immobilized && this.lastPosition && distance(pos, this.lastPosition) < 0.01) {
      this.stuckTime += dt;
      if (this.stuckTime > STUCK_TIME) {
        this.repathTimer = 0;
        this.stuckTime = 0;
      }
    } else {
      this.stuckTime = 0;
    }
    this.lastPosition = pos;
  }

  private setInput(input: MoveInput) {
    if (input === this.lastInput) return;
    this.lastInput = input;
    this.combat.setInput(this.player.id, input);
  }
}
