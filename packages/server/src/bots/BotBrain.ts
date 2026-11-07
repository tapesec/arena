import {
  MELEE_RANGE,
  NO_INPUT,
  START_ZONES,
  directionToInput,
  distance,
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

// Fréquence des décisions (le déplacement, lui, est ajusté à chaque tick).
const THINK_INTERVAL = 0.25;
// Recalcul régulier du chemin, la destination pouvant bouger (cible en mouvement).
const REPATH_INTERVAL = 1;
// Distance à partir de laquelle un point de passage est considéré comme atteint.
const WAYPOINT_REACHED = 0.6;
// Temps sans avancer avant de considérer le bot comme bloqué et de recalculer son chemin.
const STUCK_TIME = 1;

// Un bot joue avec les mêmes commandes qu'un joueur : il ne fait que choisir quoi envoyer.
export class BotBrain {
  private destination: Position | null = null;
  private stopDistance = 0;
  private path: Position[] = [];
  private repathTimer = 0;
  // Décalage aléatoire pour que les bots ne réfléchissent pas tous au même moment.
  private thinkTimer = Math.random() * THINK_INTERVAL;
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
      this.think(world);
    }
    this.steer(dt);
  }

  // Comportement minimal : rejoindre l'ennemi visible le plus proche et le frapper.
  protected think(world: BotWorld) {
    if (world.phase !== "fighting") {
      this.stop();
      return;
    }
    const enemy = this.nearest(this.visibleEnemies(world));
    if (!enemy) {
      // Personne en vue : on avance vers le camp adverse.
      this.moveTo(START_ZONES[1 - this.player.state.team], 3);
      return;
    }
    this.combat.setTarget(this.player.id, enemy.id);
    if (distance(this.player.state, enemy.state) > MELEE_RANGE - 0.5) {
      this.moveTo(enemy.state, MELEE_RANGE - 1);
      return;
    }
    this.stop();
    this.combat.faceTarget(this.player.id);
    if (!this.player.state.attacking) this.combat.toggleAttack(this.player.id);
  }

  // --- Perception ---

  protected visibleEnemies(world: BotWorld): PlayerRuntime[] {
    return [...world.players.values()].filter(
      (p) => p.alive && p.state.team !== this.player.state.team && world.visible.has(p.id),
    );
  }

  protected nearest(players: PlayerRuntime[]): PlayerRuntime | undefined {
    let best: PlayerRuntime | undefined;
    let bestDistance = Infinity;
    for (const p of players) {
      const d = distance(this.player.state, p.state);
      if (d < bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
    return best;
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
