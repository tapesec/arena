import { resolveObstacleCollisions } from "./arena";
import { ARENA_SIZE, MOVE_SPEED, PLAYER_RADIUS } from "./constants";

// État des touches de déplacement envoyé par le client.
export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const NO_INPUT: MoveInput = { up: false, down: false, left: false, right: false };

// La caméra isométrique regarde l'arène en diagonale : "haut" à l'écran
// correspond à la direction (+x, +z) du monde, "droite" à (+x, -z).
const SCREEN_UP = { x: Math.SQRT1_2, z: Math.SQRT1_2 };
const SCREEN_RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };

// Convertit les touches pressées en direction normalisée dans le monde.
export function inputToDirection(input: MoveInput): { x: number; z: number } {
  const forward = Number(input.up) - Number(input.down);
  const strafe = Number(input.right) - Number(input.left);
  if (forward === 0 && strafe === 0) return { x: 0, z: 0 };

  const x = SCREEN_UP.x * forward + SCREEN_RIGHT.x * strafe;
  const z = SCREEN_UP.z * forward + SCREEN_RIGHT.z * strafe;
  const length = Math.hypot(x, z);
  return { x: x / length, z: z / length };
}

// Les 8 combinaisons de touches qui font bouger le personnage.
const MOVING_INPUTS: MoveInput[] = [
  { up: true, down: false, left: false, right: false },
  { up: true, down: false, left: false, right: true },
  { up: false, down: false, left: false, right: true },
  { up: false, down: true, left: false, right: true },
  { up: false, down: true, left: false, right: false },
  { up: false, down: true, left: true, right: false },
  { up: false, down: false, left: true, right: false },
  { up: true, down: false, left: true, right: false },
];

// Inverse de inputToDirection : les touches qui rapprochent le plus de la direction voulue.
// Sert aux bots, qui se déplacent avec les mêmes commandes que les joueurs.
export function directionToInput(dir: { x: number; z: number }): MoveInput {
  if (Math.hypot(dir.x, dir.z) < 1e-6) return NO_INPUT;
  let best = NO_INPUT;
  let bestDot = -Infinity;
  for (const input of MOVING_INPUTS) {
    const d = inputToDirection(input);
    const dot = d.x * dir.x + d.z * dir.z;
    if (dot > bestDot) {
      bestDot = dot;
      best = input;
    }
  }
  return best;
}

export interface Position {
  x: number;
  z: number;
}

// Avance d'un pas de simulation, contourne les obstacles et reste dans l'arène.
// Partagé entre serveur et client pour pouvoir prédire le mouvement plus tard.
// speedMultiplier applique les bonus et malus de vitesse (chant du Barde, ralentissement).
export function stepMovement(pos: Position, input: MoveInput, dt: number, speedMultiplier = 1): Position {
  const dir = inputToDirection(input);
  if ((dir.x === 0 && dir.z === 0) || speedMultiplier <= 0) return pos;

  const step = MOVE_SPEED * speedMultiplier * dt;
  const moved = resolveObstacleCollisions({ x: pos.x + dir.x * step, z: pos.z + dir.z * step }, PLAYER_RADIUS);
  const limit = ARENA_SIZE / 2 - PLAYER_RADIUS;
  return { x: clamp(moved.x, -limit, limit), z: clamp(moved.z, -limit, limit) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
