// Choix du personnage visé par la souris : ceux dont la zone de clic est sous le curseur, sinon (ciblage aimanté) ceux
// dont le centre est à moins de MAGNET_RADIUS pixels du curseur à l'écran.

// Rayon de l'aimant, en pixels CSS.
export const MAGNET_RADIUS = 40;

export interface TargetCandidate {
  id: string;
  alive: boolean;
  enemy: boolean;
  // Distance de tri : à la caméra (zones de clic touchées) ou au curseur à l'écran (aimant).
  distance: number;
}

// Un vivant avant un mort, puis un ennemi avant un allié (même pour un soigneur : les alliés se ciblent facilement dans
// la fenêtre de groupe), puis le plus proche.
export function bestCandidate(candidates: readonly TargetCandidate[]): string | null {
  let best: TargetCandidate | null = null;
  for (const c of candidates) {
    if (
      !best ||
      (c.alive !== best.alive ? c.alive : c.enemy !== best.enemy ? c.enemy : c.distance < best.distance)
    ) {
      best = c;
    }
  }
  return best?.id ?? null;
}
