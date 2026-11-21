import {
  BALLAD_SPEED_MULTIPLIER,
  SONG_SPEED_MULTIPLIER,
  SPRINT_SPEED_MULTIPLIER,
  STICK_DISTANCE,
  distance,
  facingTowards,
} from "./combat";
import { MOVE_SPEED } from "./constants";
import {
  forwardOf,
  inputSpeedFactor,
  isTurning,
  moveDirection,
  stepMovement,
  turnFacing,
  type MoveInput,
  type Position,
} from "./movement";

// Déplacement d'un personnage pendant un pas de simulation, partagé par le serveur (qui fait foi) et par le client
// (qui prédit son propre personnage pour ne pas attendre la réponse du serveur) : les deux calculent la même chose.

// Effet en cours, vu du déplacement : sur le serveur (effets actifs) ou chez le client (effets synchronisés).
export interface MovementEffect {
  kind: string;
  remaining: number;
  duration: number;
  // Ralentissement (snare) : part de la vitesse perdue.
  value: number;
}

// Marge en deçà de laquelle le stick considère la cible atteinte (mètres).
export const STICK_TOLERANCE = 1e-3;

export interface MovementBody extends Position {
  facing: number;
}

export interface MovementContext {
  effects: Iterable<MovementEffect>;
  // Verrou sur la cible ("face", "stick" ou "") et position de la cible verrouillée (null si aucune).
  lock: string;
  target: Position | null;
  // Pendant la préparation : chacun reste dans la zone de départ de son équipe.
  confine: ((pos: Position) => Position) | null;
}

export interface MovementResult extends MovementBody {
  // Le stick fait avancer le personnage vers sa cible pendant ce pas.
  stickMoving: boolean;
}

function findEffect(effects: Iterable<MovementEffect>, kind: string): MovementEffect | undefined {
  for (const effect of effects) if (effect.kind === kind) return effect;
  return undefined;
}

// Mez, stun, ou Rempart (le Gardien se fige) : ne peut plus agir du tout.
export function isIncapacitated(effects: Iterable<MovementEffect>): boolean {
  for (const effect of effects) if (effect.kind === "mez" || effect.kind === "stun" || effect.kind === "rampart") return true;
  return false;
}

// Le verrou F/C se lâche quand il n'a plus lieu d'être : cible morte ou absente, contrôlé (mez, stun, Rempart), ou touche
// d'avance, de recul ou de rotation. Un root ou un snare ne le lâche pas (décidé le 2026-11-21) : le personnage fait
// toujours face à sa cible et tente d'avancer vers elle, à la vitesse que l'effet lui laisse.
export function lockReleased(input: MoveInput, targetAlive: boolean, effects: Iterable<MovementEffect>): boolean {
  return !targetAlive || isIncapacitated(effects) || input.up !== input.down || isTurning(input);
}

// Un pas de déplacement (le personnage ne doit pas être contrôlé : voir isIncapacitated). Orientation : verrou sur la
// cible, sinon la souris (clic droit), sinon la rotation au clavier.
export function simulateMovement(body: MovementBody, input: MoveInput, dt: number, context: MovementContext): MovementResult {
  const { effects, lock, target } = context;
  let facing: number;
  if (lock && target) facing = facingTowards(body, target);
  else if (input.steer && input.yaw !== undefined) facing = input.yaw;
  else facing = turnFacing(body.facing, input, dt);

  // Root : arrêt net, puis la vitesse remonte régulièrement jusqu'à la normale à la fin de l'effet.
  const root = findEffect(effects, "root");
  // Un root sans durée finie (aucun aujourd'hui) bloque net.
  const rootFactor = findEffect(effects, "halted")
    ? 0
    : root
      ? root.duration > 0 && Number.isFinite(root.duration) && root.remaining >= 0
        ? 1 - root.remaining / root.duration
        : 0
      : 1;
  if (rootFactor <= 0) return { x: body.x, z: body.z, facing, stickMoving: false };

  const direction = moveDirection(input, facing);
  // Stick : on avance vers la cible tant qu'on n'est pas assez près (les pas de côté restent possibles). Sans autre
  // touche, on n'avance que de ce qui manque pour être à STICK_DISTANCE : derrière une cible plus lente, le personnage
  // la suit à sa vitesse au lieu d'alterner pleine vitesse et arrêt à chaque pas.
  let stickMoving = false;
  let stickLimit = Infinity;
  // La tolérance évite qu'un arrondi laisse le personnage à 2 m + ε, faisant des pas infimes sans fin (il serait
  // toujours « en mouvement » et ne pourrait plus incanter).
  if (target && lock === "stick" && distance(body, target) > STICK_DISTANCE + STICK_TOLERANCE) {
    if (direction.x === 0 && direction.z === 0) stickLimit = (distance(body, target) - STICK_DISTANCE) / (MOVE_SPEED * dt);
    const forward = forwardOf(facing);
    direction.x += forward.x;
    direction.z += forward.z;
    stickMoving = true;
  }

  const snare = findEffect(effects, "snare");
  const speed =
    // Chant de vitesse, Ballade rythmée et Sprint ne se cumulent pas : le plus fort compte.
    Math.max(
      findEffect(effects, "speed") ? SONG_SPEED_MULTIPLIER : 1,
      findEffect(effects, "ballad") ? BALLAD_SPEED_MULTIPLIER : 1,
      findEffect(effects, "sprint") ? SPRINT_SPEED_MULTIPLIER : 1,
    ) *
    (snare ? 1 - snare.value : 1) *
    rootFactor *
    inputSpeedFactor(input);
  let next = stepMovement(body, direction, dt, Math.min(speed, stickLimit));
  if (context.confine) next = context.confine(next);
  return { x: next.x, z: next.z, facing, stickMoving };
}
