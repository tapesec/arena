import { ARENA_SIZE, PLAYER_RADIUS, hasClearPath, isInsideObstacle, type Position } from "@arena/shared";

// Taille d'une case de la grille de navigation, en mètres.
const CELL_SIZE = 1;

// Marge autour des obstacles : le rayon d'un personnage plus un peu de jeu.
const MARGIN = PLAYER_RADIUS + 0.3;

const SQRT2 = Math.SQRT2;

// Recherche de chemin A* sur une grille qui couvre l'arène.
// Une case est bloquée si son centre est dans un obstacle élargi de la marge.
export class Pathfinder {
  private readonly size = Math.round(ARENA_SIZE / CELL_SIZE);
  private readonly blocked: Uint8Array;
  // Tableaux de travail de l'A*, gardés d'une recherche à l'autre (un bot en relance plusieurs par seconde) : une case
  // n'est valable que si son tampon vaut la recherche en cours, ce qui évite de tout remettre à zéro.
  private readonly cost: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closedStamp: Uint32Array;
  private search = 0;
  private readonly open = new MinHeap();

  constructor() {
    this.blocked = new Uint8Array(this.size * this.size);
    this.cost = new Float32Array(this.size * this.size);
    this.cameFrom = new Int32Array(this.size * this.size);
    this.stamp = new Uint32Array(this.size * this.size);
    this.closedStamp = new Uint32Array(this.size * this.size);
    const limit = ARENA_SIZE / 2 - MARGIN;
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        const center = this.cellCenter(col, row);
        const outside = Math.abs(center.x) > limit || Math.abs(center.z) > limit;
        if (outside || isInsideObstacle(center, MARGIN)) this.blocked[row * this.size + col] = 1;
      }
    }
  }

  // Liste de points de passage jusqu'à la destination (sans le point de départ), ou null si impossible.
  findPath(from: Position, to: Position): Position[] | null {
    if (hasClearPath(from, to, MARGIN)) return [to];

    const start = this.nearestFreeCell(from);
    const goal = this.nearestFreeCell(to);
    if (start === null || goal === null) return null;

    const cells = this.aStar(start, goal);
    if (!cells) return null;
    const points = cells.map((cell) => this.cellCenter(cell % this.size, Math.floor(cell / this.size)));
    // On termine sur la destination exacte si elle est accessible depuis la dernière case.
    if (hasClearPath(points[points.length - 1], to, MARGIN)) points.push(to);
    return this.smooth(from, points);
  }

  private aStar(start: number, goal: number): number[] | null {
    const n = this.size;
    const { cost, cameFrom, stamp, closedStamp, open } = this;
    const search = ++this.search;
    open.clear();
    const gx = goal % n;
    const gz = Math.floor(goal / n);
    // Distance "octile" : exacte sur une grille à 8 directions sans obstacle.
    const heuristic = (cell: number) => {
      const dx = Math.abs((cell % n) - gx);
      const dz = Math.abs(Math.floor(cell / n) - gz);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };

    cost[start] = 0;
    cameFrom[start] = -1;
    stamp[start] = search;
    open.push(start, heuristic(start));
    while (open.size > 0) {
      const current = open.pop();
      if (current === goal) return this.reconstruct(cameFrom, goal);
      if (closedStamp[current] === search) continue;
      closedStamp[current] = search;

      const cx = current % n;
      const cz = Math.floor(current / n);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const next = z * n + x;
          if (this.blocked[next] || closedStamp[next] === search) continue;
          // En diagonale, on ne coupe pas le coin d'un obstacle.
          if (dx !== 0 && dz !== 0 && (this.blocked[cz * n + x] || this.blocked[z * n + cx])) continue;

          const newCost = cost[current] + (dx !== 0 && dz !== 0 ? SQRT2 : 1);
          if (stamp[next] === search && newCost >= cost[next]) continue;
          stamp[next] = search;
          cost[next] = newCost;
          cameFrom[next] = current;
          open.push(next, newCost + heuristic(next));
        }
      }
    }
    return null;
  }

  private reconstruct(cameFrom: Int32Array, goal: number): number[] {
    const cells = [goal];
    let cell = goal;
    while (cameFrom[cell] !== -1) {
      cell = cameFrom[cell];
      cells.push(cell);
    }
    return cells.reverse();
  }

  // Lissage : depuis chaque point, on saute directement au point le plus lointain visible en ligne droite.
  private smooth(from: Position, points: Position[]): Position[] {
    const result: Position[] = [];
    let anchor = from;
    let index = 0;
    while (index < points.length) {
      let furthest = index;
      for (let j = points.length - 1; j > index; j--) {
        if (hasClearPath(anchor, points[j], MARGIN)) {
          furthest = j;
          break;
        }
      }
      anchor = points[furthest];
      result.push(anchor);
      index = furthest + 1;
    }
    return result;
  }

  private cellCenter(col: number, row: number): Position {
    return { x: -ARENA_SIZE / 2 + (col + 0.5) * CELL_SIZE, z: -ARENA_SIZE / 2 + (row + 0.5) * CELL_SIZE };
  }

  private cellOf(pos: Position): [number, number] {
    const clampIndex = (v: number) => Math.min(this.size - 1, Math.max(0, Math.floor((v + ARENA_SIZE / 2) / CELL_SIZE)));
    return [clampIndex(pos.x), clampIndex(pos.z)];
  }

  // Case libre la plus proche (un personnage collé à un obstacle peut être sur une case bloquée).
  private nearestFreeCell(pos: Position): number | null {
    const [col, row] = this.cellOf(pos);
    for (let radius = 0; radius < 6; radius++) {
      let best: number | null = null;
      let bestDist = Infinity;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = col + dx;
          const z = row + dz;
          if (x < 0 || z < 0 || x >= this.size || z >= this.size) continue;
          const cell = z * this.size + x;
          if (this.blocked[cell]) continue;
          const center = this.cellCenter(x, z);
          const dist = Math.hypot(center.x - pos.x, center.z - pos.z);
          if (dist < bestDist) {
            bestDist = dist;
            best = cell;
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  }
}

// File de priorité minimale (tas binaire) : donne toujours la case la plus prometteuse en premier.
class MinHeap {
  private items: number[] = [];
  private priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  clear() {
    this.items.length = 0;
    this.priorities.length = 0;
  }

  push(item: number, priority: number) {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.priorities[left] < this.priorities[smallest]) smallest = left;
        if (right < this.items.length && this.priorities[right] < this.priorities[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  // Échange par variables temporaires (la déstructuration alloue des tableaux, deux fois plus lente ici).
  private swap(a: number, b: number) {
    const item = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = item;
    const priority = this.priorities[a];
    this.priorities[a] = this.priorities[b];
    this.priorities[b] = priority;
  }
}
