import { forwardOf } from "@arena/shared";

// Lueur rouge au bord de l'écran quand on prend un coup (décidée le 2026-11-22) : du côté d'où vient le coup en
// mêlée, tout autour de l'écran pour un sort, un dégât sur la durée ou un attaquant qu'on ne voit pas.

// Plus le coup retire de points de vie, plus la lueur est vive : de MIN_STRENGTH à 1, atteint à FULL_HIT de la vie.
const MIN_STRENGTH = 0.45;
const FULL_HIT = 0.25;
// Tic d'un dégât sur la durée (Brûlure, poison) : lueur discrète, il en tombe une par seconde.
export const DOT_STRENGTH = 0.3;
// La lueur tout autour couvre tout le bord de l'écran : plus retenue.
const AROUND_MAX = 0.6;
// Fondu de la lueur, en millisecondes.
const FADE_MS = 700;
// Pas plus d'un éclat tous les RELIGHT_MS par lueur (moins de 3 par seconde : seuil des flashs à risque pour les
// personnes photosensibles), et seulement s'il est plus vif que ce qui reste du précédent.
const RELIGHT_MS = 400;

export function hitStrength(amount: number, maxHp: number): number {
  if (maxHp <= 0) return 1;
  return Math.min(1, MIN_STRENGTH + ((1 - MIN_STRENGTH) * amount) / (maxHp * FULL_HIT));
}

// Direction d'un attaquant par rapport à la caméra (voir edgeOf) : from = attaquant moins soi, dans le plan du sol ;
// null s'il est à la même place.
export function hitDirection(from: { x: number; z: number }, yaw: number): number | null {
  if (from.x === 0 && from.z === 0) return null;
  const forward = forwardOf(yaw);
  // Composantes devant (forward) et à droite (forward tourné d'un quart de tour, voir rightOf).
  const ahead = from.x * forward.x + from.z * forward.z;
  const right = from.x * forward.z - from.z * forward.x;
  return Math.atan2(right, ahead);
}

// Point du bord de l'écran (en pourcentage de la largeur et de la hauteur) dans une direction relative à la caméra :
// 0 = devant (en haut), π/2 = à droite, π = derrière (en bas).
export function edgeOf(relative: number): { x: number; y: number } {
  const sin = Math.sin(relative);
  const cos = Math.cos(relative);
  const scale = Math.max(Math.abs(sin), Math.abs(cos));
  return { x: 50 + (50 * sin) / scale, y: 50 - (50 * cos) / scale };
}

// Une lueur (de côté ou tout autour) : son dernier éclat, pour savoir ce qu'il en reste.
class Glow {
  readonly element = document.createElement("div");
  private animation: Animation | null = null;
  private litAt = -Infinity;
  private litStrength = 0;

  constructor(container: HTMLElement, kind: string) {
    this.element.className = `hit-glow ${kind}`;
    this.element.setAttribute("aria-hidden", "true");
    container.appendChild(this.element);
  }

  // Intensité restante du dernier éclat (fondu approché linéaire).
  private remaining(now: number): number {
    return this.litStrength * Math.max(0, 1 - (now - this.litAt) / FADE_MS);
  }

  // Retourne vrai si la lueur s'est rallumée.
  light(strength: number, now: number, fadeMs: number): boolean {
    if (now - this.litAt < RELIGHT_MS || strength <= this.remaining(now)) return false;
    this.animation?.cancel();
    this.animation = this.element.animate([{ opacity: strength }, { opacity: 0 }], { duration: fadeMs, easing: "ease-out", fill: "forwards" });
    this.litAt = now;
    this.litStrength = strength;
    return true;
  }
}

export class HitGlow {
  private side: Glow;
  private around: Glow;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  // Mouvement réduit : lueur de côté seulement, en fondu plus court, et plus de lueur tout autour.
  private reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(container: HTMLElement) {
    this.side = new Glow(container, "side");
    this.around = new Glow(container, "around");
  }

  // relative : direction du coup par rapport à la caméra (voir edgeOf), null pour une lueur tout autour ;
  // delayMs : le temps que le projectile arrive.
  hit(relative: number | null, strength: number, delayMs = 0) {
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.hit(relative, strength);
      }, delayMs);
      this.timers.add(timer);
      return;
    }
    const now = performance.now();
    const fade = this.reduced ? FADE_MS / 2 : FADE_MS;
    if (relative === null) {
      if (!this.reduced) this.around.light(Math.min(strength, AROUND_MAX), now, fade);
      return;
    }
    const { x, y } = edgeOf(relative);
    // La position ne change qu'avec un nouvel éclat : un coup ignoré ne déplace pas la lueur en cours.
    const style = this.side.element.style;
    const before = [style.getPropertyValue("--hit-x"), style.getPropertyValue("--hit-y")];
    style.setProperty("--hit-x", `${x.toFixed(1)}%`);
    style.setProperty("--hit-y", `${y.toFixed(1)}%`);
    if (!this.side.light(strength, now, fade)) {
      style.setProperty("--hit-x", before[0]);
      style.setProperty("--hit-y", before[1]);
    }
  }

  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.side.element.remove();
    this.around.element.remove();
  }
}
