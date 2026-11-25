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

// Ciblage automatique des ennemis (Tab, compétence lancée sans cible, cible morte) : seuls les ennemis vivants que
// l'équipe voit sont candidats (le brouillard de guerre retire les autres), classés selon les critères demandés.
export interface EnemyCandidate {
  id: string;
  distance: number;
  // Aucun obstacle entre le joueur et lui.
  lineOfSight: boolean;
  // À portée de la compétence lancée.
  inRange: boolean;
  // Dans le cône de vision du joueur (pas besoin de se tourner).
  inFront: boolean;
  // Sous mez ou root : le frapper libérerait le contrôle posé par un allié.
  controlled: boolean;
}

export interface EnemyRanking {
  // Préférer un ennemi ni mez ni root.
  preferFree?: boolean;
  // Préférer un ennemi à portée.
  preferInRange?: boolean;
  // Préférer un ennemi devant soi.
  preferFront?: boolean;
}

// Ennemis du meilleur au moins bon : en ligne de vue d'abord, puis selon les préférences (libre, à portée, devant
// soi, dans cet ordre), puis le plus proche.
export function rankEnemies(candidates: readonly EnemyCandidate[], ranking: EnemyRanking = {}): string[] {
  const keys = (c: EnemyCandidate) => [
    c.lineOfSight ? 0 : 1,
    ranking.preferFree && c.controlled ? 1 : 0,
    ranking.preferInRange && !c.inRange ? 1 : 0,
    ranking.preferFront && !c.inFront ? 1 : 0,
    c.distance,
  ];
  return [...candidates]
    .sort((a, b) => {
      const ka = keys(a);
      const kb = keys(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    })
    .map((c) => c.id);
}
