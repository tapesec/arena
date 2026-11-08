import { resolveObstacleCollisions } from "./arena";
import { ARENA_SIZE, MOVE_SPEED, PLAYER_RADIUS } from "./constants";

// État des touches de déplacement envoyé par le client (contrôles "à la DAoC") :
// Z/S avancent et reculent dans la direction du personnage, Q/D le font pivoter.
// Clic droit maintenu ("steer") : la souris oriente le personnage et Q/D deviennent des pas de côté.
export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  steer?: boolean;
  // Orientation voulue en mode steer, en radians (même convention que l'orientation des personnages).
  yaw?: number;
}

export const NO_INPUT: MoveInput = { up: false, down: false, left: false, right: false };

// Vitesse de rotation au clavier, en radians par seconde.
export const TURN_SPEED = 3;

// Comme dans DAoC, on recule moins vite qu'on n'avance (limite le kite à reculons).
export const BACKWARD_SPEED_FACTOR = 0.7;

// Par défaut, la caméra isométrique regarde l'arène en diagonale :
// "haut" à l'écran correspond à la direction (+x, +z) du monde, "droite" à (+x, -z).
export const DEFAULT_CAMERA_YAW = Math.PI / 4;

// Q/D sans clic droit : le personnage pivote sur lui-même.
export function isTurning(input: MoveInput): boolean {
  return !input.steer && input.left !== input.right;
}

// Touches qui déplacent le corps (avancer, reculer, pas de côté). Pivoter n'en fait pas partie.
export function movesBody(input: MoveInput): boolean {
  return input.up !== input.down || (!!input.steer && input.left !== input.right);
}

// Multiplicateur de vitesse propre aux touches : réduit quand on recule (même en diagonale).
export function inputSpeedFactor(input: MoveInput): number {
  return input.down && !input.up ? BACKWARD_SPEED_FACTOR : 1;
}

// Nouvelle orientation après rotation au clavier (vers la droite = angle croissant).
export function turnFacing(facing: number, input: MoveInput, dt: number): number {
  if (!isTurning(input)) return facing;
  return normalizeAngle(facing + (input.right ? 1 : -1) * TURN_SPEED * dt);
}

// Vecteurs "devant" et "à droite" d'une orientation.
export function forwardOf(facing: number): { x: number; z: number } {
  return { x: Math.sin(facing), z: Math.cos(facing) };
}

export function rightOf(facing: number): { x: number; z: number } {
  return { x: Math.cos(facing), z: -Math.sin(facing) };
}

// Direction de déplacement (non normalisée) voulue par les touches, selon l'orientation du personnage.
export function moveDirection(input: MoveInput, facing: number): { x: number; z: number } {
  const forward = Number(input.up) - Number(input.down);
  const strafe = input.steer ? Number(input.right) - Number(input.left) : 0;
  const f = forwardOf(facing);
  const r = rightOf(facing);
  return { x: f.x * forward + r.x * strafe, z: f.z * forward + r.z * strafe };
}

// Déplacement relatif à l'écran : ne sert plus qu'à la caméra libre du mode spectateur.
export function inputToDirection(input: MoveInput): { x: number; z: number } {
  const forward = Number(input.up) - Number(input.down);
  const strafe = Number(input.right) - Number(input.left);
  if (forward === 0 && strafe === 0) return { x: 0, z: 0 };

  const yaw = input.yaw ?? DEFAULT_CAMERA_YAW;
  const f = forwardOf(yaw);
  const r = rightOf(yaw);
  const x = f.x * forward + r.x * strafe;
  const z = f.z * forward + r.z * strafe;
  const length = Math.hypot(x, z);
  return { x: x / length, z: z / length };
}

// Commande qui fait marcher droit dans une direction : on oriente le personnage (steer) et on avance.
// Sert aux bots, qui se déplacent avec les mêmes commandes que les joueurs.
export function directionToInput(dir: { x: number; z: number }): MoveInput {
  if (Math.hypot(dir.x, dir.z) < 1e-6) return NO_INPUT;
  return { up: true, down: false, left: false, right: false, steer: true, yaw: Math.atan2(dir.x, dir.z) };
}

export interface Position {
  x: number;
  z: number;
}

// Avance d'un pas de simulation dans une direction, contourne les obstacles et reste dans l'arène.
// speedMultiplier applique les bonus et malus de vitesse (chant du Barde, ralentissement).
export function stepMovement(
  pos: Position,
  direction: { x: number; z: number },
  dt: number,
  speedMultiplier = 1,
): Position {
  const length = Math.hypot(direction.x, direction.z);
  if (length < 1e-6 || speedMultiplier <= 0) return pos;

  const step = (MOVE_SPEED * speedMultiplier * dt) / length;
  const moved = resolveObstacleCollisions({ x: pos.x + direction.x * step, z: pos.z + direction.z * step }, PLAYER_RADIUS);
  const limit = ARENA_SIZE / 2 - PLAYER_RADIUS;
  return { x: clamp(moved.x, -limit, limit), z: clamp(moved.z, -limit, limit) };
}

// Ramène un angle dans ]-π, π].
export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
