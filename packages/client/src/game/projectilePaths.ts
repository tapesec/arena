import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ProjectileVisual } from "./abilityAnimations";

// Position d'un projectile sur son trajet (voir ProjectileVisual), à l'avancement t (0 au départ, 1 à l'arrivée).
// seed : tirage des cassures du zigzag (le même pour tout le vol).

const UP = new Vector3(0, 1, 0);
const forward = new Vector3();
const right = new Vector3();
const up = new Vector3();

export function projectilePosition(p: ProjectileVisual, from: Vector3, to: Vector3, t: number, seed: number, out: Vector3): Vector3 {
  const e = p.speed === "accelerate" ? t * t : p.speed === "decelerate" ? 1 - (1 - t) * (1 - t) : t;
  Vector3.LerpToRef(from, to, e, out);
  if (p.path === "straight") return out;
  // Repère du trajet : vers la cible, à droite (à l'horizontale), et au-dessus.
  to.subtractToRef(from, forward);
  if (forward.lengthSquared() < 1e-6) return out;
  forward.normalize();
  Vector3.CrossToRef(UP, forward, right);
  if (right.lengthSquared() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  Vector3.CrossToRef(forward, right, up);
  // Enveloppe nulle aux deux bouts : le projectile part de la main et arrive sur la cible.
  const envelope = Math.sin(Math.PI * e);
  let side = 0;
  let lift = 0;
  switch (p.path) {
    case "arc":
      lift = p.height * 4 * e * (1 - e);
      break;
    case "spiral": {
      const angle = e * p.turns * Math.PI * 2;
      side = Math.cos(angle) * p.height * envelope;
      lift = Math.sin(angle) * p.height * envelope;
      break;
    }
    case "wave":
      side = Math.sin(e * p.turns * Math.PI * 2) * p.height * envelope;
      break;
    case "zigzag": {
      // Cassures : des points au hasard (de chaque côté, en alternance), reliés en ligne droite.
      const segments = Math.max(2, Math.round(p.turns) + 1);
      const at = e * segments;
      const i = Math.min(segments - 1, Math.floor(at));
      const f = at - i;
      const [s0, l0] = zigzagPoint(i, segments, seed);
      const [s1, l1] = zigzagPoint(i + 1, segments, seed);
      side = (s0 + (s1 - s0) * f) * p.height;
      lift = (l0 + (l1 - l0) * f) * p.height;
      break;
    }
    case "curve":
      side = p.height * envelope;
      break;
  }
  out.addInPlace(right.scale(side)).addInPlace(up.scale(lift));
  return out;
}

// Direction du trajet à l'avancement t (pour orienter les objets du projectile).
const ahead = new Vector3();
export function projectileDirection(p: ProjectileVisual, from: Vector3, to: Vector3, t: number, seed: number, out: Vector3): Vector3 {
  const a = Math.min(t, 0.98);
  projectilePosition(p, from, to, a, seed, out);
  projectilePosition(p, from, to, a + 0.02, seed, ahead);
  ahead.subtractToRef(out, out);
  if (out.lengthSquared() > 1e-8) return out.normalize();
  return to.subtractToRef(from, out).normalize();
}

// Point de cassure i du zigzag (côté, hauteur, entre -1 et 1) ; nul aux deux bouts.
function zigzagPoint(i: number, segments: number, seed: number): [number, number] {
  if (i <= 0 || i >= segments) return [0, 0];
  const r1 = hash(seed * 31 + i * 7.13);
  const r2 = hash(seed * 17 + i * 3.71);
  const sign = i % 2 === 0 ? 1 : -1;
  return [sign * (0.4 + 0.6 * r1), (r2 - 0.5) * 0.8];
}

function hash(x: number): number {
  const s = Math.sin(x) * 43758.5453;
  return s - Math.floor(s);
}
