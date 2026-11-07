import { VISION_RANGE, distance, hasLineOfSight, type Position } from "@arena/shared";

export interface VisibilityUnit extends Position {
  id: string;
  team: number;
  alive: boolean;
}

// Brouillard de guerre : pour chaque équipe, l'ensemble des joueurs qu'elle voit.
// Une équipe voit toujours ses propres membres, et un ennemi (vivant ou mort)
// dès qu'un de ses membres vivants est à portée de vue sans obstacle entre eux.
export function computeTeamVisibility(units: VisibilityUnit[]): Map<number, Set<string>> {
  const visible = new Map<number, Set<string>>();
  for (const unit of units) {
    if (!visible.has(unit.team)) visible.set(unit.team, new Set());
    visible.get(unit.team)!.add(unit.id);
  }

  for (const [team, seen] of visible) {
    const watchers = units.filter((u) => u.team === team && u.alive);
    for (const enemy of units) {
      if (enemy.team === team) continue;
      const spotted = watchers.some(
        (w) => distance(w, enemy) <= VISION_RANGE && hasLineOfSight(w, enemy),
      );
      if (spotted) seen.add(enemy.id);
    }
  }
  return visible;
}
