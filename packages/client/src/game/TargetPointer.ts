// Flèche au bord de l'écran vers la cible quand elle est hors champ (derrière la caméra, ou en dehors de l'image),
// avec sa distance : le joueur sait toujours de quel côté se tourner (décidé le 2026-11-19).

// Marge entre la flèche et le bord de l'écran, en pixels CSS.
const EDGE_MARGIN = 48;

export interface EdgePoint {
  x: number;
  y: number;
  // Direction de la flèche, en radians (0 : vers la droite, sens horaire comme l'axe y de l'écran).
  angle: number;
}

// Point du bord de l'écran (rectangle intérieur à la marge) dans la direction de la cible, ou null si elle est à
// l'écran. x, y : projection de la cible en pixels ; behind : elle est derrière la caméra (projection inversée).
export function edgePoint(x: number, y: number, behind: boolean, width: number, height: number, margin = EDGE_MARGIN): EdgePoint | null {
  const inside = x >= margin && x <= width - margin && y >= margin && y <= height - margin;
  if (inside && !behind) return null;
  const cx = width / 2;
  const cy = height / 2;
  let dx = x - cx;
  let dy = y - cy;
  // Derrière la caméra, la projection est inversée par rapport au centre.
  if (behind) {
    dx = -dx;
    dy = -dy;
  }
  // Pile derrière : en bas de l'écran.
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
  const scale = Math.min((cx - margin) / Math.max(Math.abs(dx), 1e-6), (cy - margin) / Math.max(Math.abs(dy), 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale, angle: Math.atan2(dy, dx) };
}

export class TargetPointer {
  private element = document.createElement("div");
  private arrow = document.createElement("div");
  private label = document.createElement("div");

  constructor(container: HTMLElement) {
    this.element.className = "target-pointer";
    this.arrow.className = "target-pointer-arrow";
    this.label.className = "target-pointer-label";
    this.element.append(this.arrow, this.label);
    this.element.style.display = "none";
    container.appendChild(this.element);
  }

  // point : position de la flèche (null : cible à l'écran ou pas de cible) ; enemy : couleur ; distance en mètres.
  update(point: EdgePoint | null, enemy: boolean, distance: number) {
    if (!point) {
      this.element.style.display = "none";
      return;
    }
    this.element.style.display = "";
    this.element.style.left = `${point.x}px`;
    this.element.style.top = `${point.y}px`;
    this.element.classList.toggle("enemy", enemy);
    this.arrow.style.transform = `rotate(${point.angle}rad)`;
    this.label.textContent = `${Math.round(distance)} m`;
  }

  dispose() {
    this.element.remove();
  }
}
