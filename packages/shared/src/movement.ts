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

export interface Position {
  x: number;
  z: number;
}

// Avance d'un pas de simulation et garde le joueur dans les limites de l'arène.
// Partagé entre serveur et client pour pouvoir prédire le mouvement plus tard.
export function stepMovement(pos: Position, input: MoveInput, dt: number): Position {
  const dir = inputToDirection(input);
  const limit = ARENA_SIZE / 2 - PLAYER_RADIUS;
  return {
    x: clamp(pos.x + dir.x * MOVE_SPEED * dt, -limit, limit),
    z: clamp(pos.z + dir.z * MOVE_SPEED * dt, -limit, limit),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
