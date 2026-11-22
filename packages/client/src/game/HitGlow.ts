// Lueur rouge au bord de l'écran quand on prend un coup (décidée le 2026-11-21) : du côté d'où vient le coup en
// mêlée, tout autour de l'écran pour un sort, un dégât sur la durée ou un attaquant qu'on ne voit pas.

// La lueur s'efface en fondu (animation .hit-glow dans styles.css). Plus le coup retire de points de vie, plus la lueur est vive : de MIN_STRENGTH à 1, atteint à FULL_HIT de la vie.
const MIN_STRENGTH = 0.45;
const FULL_HIT = 0.25;

// Tic d'un dégât sur la durée (Brûlure, poison) : lueur discrète, il en tombe une par seconde.
export const DOT_STRENGTH = 0.3;

export function hitStrength(amount: number, maxHp: number): number {
  if (maxHp <= 0) return 1;
  return Math.min(1, MIN_STRENGTH + ((1 - MIN_STRENGTH) * amount) / (maxHp * FULL_HIT));
}

// Point du bord de l'écran (en pourcentage de la largeur et de la hauteur) dans une direction relative à la caméra :
// 0 = devant (en haut), π/2 = à droite, π = derrière (en bas).
export function edgeOf(relative: number): { x: number; y: number } {
  const sin = Math.sin(relative);
  const cos = Math.cos(relative);
  const scale = Math.max(Math.abs(sin), Math.abs(cos));
  return { x: 50 + (50 * sin) / scale, y: 50 - (50 * cos) / scale };
}

export class HitGlow {
  private element = document.createElement("div");

  constructor(container: HTMLElement) {
    this.element.className = "hit-glow";
    this.element.setAttribute("aria-hidden", "true");
    container.appendChild(this.element);
  }

  // relative : direction du coup par rapport à la caméra (voir edgeOf), null pour une lueur tout autour.
  hit(relative: number | null, strength: number) {
    const style = this.element.style;
    style.setProperty("--hit-strength", strength.toFixed(2));
    if (relative === null) {
      this.element.className = "hit-glow around";
    } else {
      const { x, y } = edgeOf(relative);
      style.setProperty("--hit-x", `${x.toFixed(1)}%`);
      style.setProperty("--hit-y", `${y.toFixed(1)}%`);
      this.element.className = "hit-glow side";
    }
    // Relance l'animation à chaque coup, même s'il en arrive un pendant le fondu du précédent.
    void this.element.offsetWidth;
    this.element.classList.add("on");
  }

  dispose() {
    this.element.remove();
  }
}
