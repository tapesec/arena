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

// Base commune des bots : perception, utilisation des compétences et déplacements.
// Chaque classe définit son comportement dans think() (voir classBots.ts).
// Un bot joue avec les mêmes commandes qu'un joueur : il ne fait que choisir quoi envoyer.
export class BotBrain {
  protected world!: BotWorld;
  private destination: Position | null = null;
  private stopDistance = 0;
  private path: Position[] = [];
  private repathTimer = 0;
  // Décalage aléatoire pour que les bots ne réfléchissent pas tous au même moment.
  private thinkTimer = Math.random() * THINK_INTERVAL;
  // Mémoire et exploration quand aucun ennemi n'est en vue.
  private lastSeenEnemy: Position | null = null;
  private exploreTarget: Position | null = null;
  private visitedEnemyZone = false;
  private lastInput: MoveInput = NO_INPUT;
  private lastPosition: Position | null = null;
  private stuckTime = 0;

  constructor(
    readonly player: PlayerRuntime,
    protected combat: CombatSystem,
    private pathfinder: Pathfinder,
  ) {}

  update(dt: number, world: BotWorld) {
    if (!this.player.alive) {
      this.stop();
      return;
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer += THINK_INTERVAL;
      this.world = world;
      this.rememberEnemies();
      if (world.phase === "preparation") this.prepare();
      else if (world.phase === "fighting") this.think();
      else this.stop();
    }
    this.steer(dt);
  }

  // Retient la position de l'ennemi visible le plus proche, pour y retourner s'il disparaît.
  private rememberEnemies() {
    const enemy = this.nearest(this.enemies());
    if (enemy) {
      this.lastSeenEnemy = { x: enemy.state.x, z: enemy.state.z };
      this.exploreTarget = null;
    }
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
      (p) => p.alive && p.state.team !== this.player.state.team && this.world.visible.has(p.id),
    );
  }

  // Alliés vivants, soi-même compris.
  protected allies(): PlayerRuntime[] {
    return [...this.world.players.values()].filter((p) => p.alive && p.state.team === this.player.state.team);
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

  // Cible prioritaire : le premier groupe de classes qui a un représentant visible, puis le plus proche.
  // On garde la cible actuelle tant qu'elle reste dans le meilleur groupe, pour ne pas papillonner.
  protected pickTarget(priorities: ClassId[][]): PlayerRuntime | undefined {
    const enemies = this.enemies();
    const rank = (p: PlayerRuntime) => {
      const index = priorities.findIndex((group) => group.includes(p.classDef.id));
      return index === -1 ? priorities.length : index;
    };
    const bestRank = Math.min(...enemies.map(rank));
    const candidates = enemies.filter((p) => rank(p) === bestRank);
    const current = candidates.find((p) => p.id === this.player.targetId);
    return current ?? this.nearest(candidates);
  }

  // Ennemis de mêlée proches, ou qui viennent de nous frapper au corps à corps.
  protected meleeThreats(radius: number): PlayerRuntime[] {
    const recentlyHit = this.combat.now - this.player.lastMeleeHitAt < 1.5;
    return this.enemies().filter(
      (p) =>
        (MELEE_CLASSES.includes(p.classDef.id) && this.distanceTo(p) <= radius) ||
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
    if (!ability) return false;
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
      const others = this.allies().filter((p) => p !== this.player);
      const escort =
        this.nearest(others.filter((p) => MELEE_CLASSES.includes(p.classDef.id))) ??
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

  // Point libre au hasard dans l'arène, à l'écart des bords.
  private randomPoint(): Position {
    const range = ARENA_SIZE / 2 - EDGE_MARGIN;
    for (;;) {
      const point = { x: (Math.random() * 2 - 1) * range, z: (Math.random() * 2 - 1) * range };
      if (!isInsideObstacle(point, PLAYER_RADIUS + 0.5)) return point;
    }
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
      this.flee([target]);
      return false;
    }
    return true;
  }

  // S'éloigne des menaces, en se rapprochant si possible de ses alliés.
  protected flee(threats: PlayerRuntime[]) {
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
    if (length < 1e-6) return;
    dx /= length;
    dz /= length;

    // Attirance vers le reste du groupe, qui pourra nous protéger.
    const others = this.allies().filter((p) => p !== this.player);
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

    // On essaie la direction idéale, puis des directions de plus en plus écartées,
    // en évitant les bords de l'arène où l'on finirait acculé.
    const limit = ARENA_SIZE / 2 - EDGE_MARGIN;
    for (const degrees of FLEE_ANGLES) {
      const angle = (degrees * Math.PI) / 180;
      const rx = dx * Math.cos(angle) - dz * Math.sin(angle);
      const rz = dx * Math.sin(angle) + dz * Math.cos(angle);
      const point = { x: pos.x + rx * FLEE_DISTANCE, z: pos.z + rz * FLEE_DISTANCE };
      if (Math.abs(point.x) > limit || Math.abs(point.z) > limit) continue;
      if (isInsideObstacle(point, PLAYER_RADIUS + 0.3)) continue;
      this.moveTo(point, 0.5);
      return;
    }
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
    if (this.repathTimer <= 0 || this.path.length === 0) {
      this.path = this.pathfinder.findPath(pos, this.destination) ?? [];
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
