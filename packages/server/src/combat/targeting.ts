// Ciblage des compétences : cible choisie, raison d'un refus, centre et personnages touchés d'une zone d'effet. Ne lit
// que la liste des joueurs.

import {
  distance,
  hasLineOfSight,
  ignoresLineOfSight,
  isFacing,
  isMagic,
  isOffensive,
  positionRelativeTo,
  revivesInArea,
  spellRange,
  type AbilityDef,
  type GameErrorCode,
} from "@arena/shared";
import type { PlayerRuntime } from "../PlayerRuntime";

// Équipes opposées.
export function areEnemies(a: PlayerRuntime, b: PlayerRuntime): boolean {
  return a.state.team !== b.state.team;
}

// Détermine la cible de la compétence selon son type.
export function pickTarget(players: ReadonlyMap<string, PlayerRuntime>, caster: PlayerRuntime, ability: AbilityDef): string | null {
  if (ability.target === "self" || ability.target === "enemiesAround") return caster.id;
  const current = caster.targetId ? players.get(caster.targetId) : undefined;
  if (ability.target === "ally") {
    // Sans allié vivant ciblé, un soin ou un buff s'applique au lanceur.
    return current?.alive && !areEnemies(caster, current) ? current.id : caster.id;
  }
  return current?.id ?? null;
}

// Retourne la raison du refus à envoyer au joueur, ou null si la cible convient.
export function validateTarget(players: ReadonlyMap<string, PlayerRuntime>, caster: PlayerRuntime, ability: AbilityDef, targetId: string): GameErrorCode | null {
  const target = players.get(targetId);
  if (!target) return "targetNotFound";
  // Intervention divine : il faut au moins un allié mort dans la zone.
  if (revivesInArea(ability) && affectedBy(players, caster, ability, targetId).length === 0) {
    return "noDeadAllyInRange";
  }
  if (ability.target === "self" || ability.target === "enemiesAround") return null;

  const enemy = areEnemies(caster, target);
  if (ability.target === "enemy" && !enemy) return "notHostile";
  if (ability.target !== "enemy" && enemy) return "hostile";
  if (ability.target === "otherAlly" && target === caster) return "needOtherAlly";
  if (ability.target === "deadAlly") {
    if (target.alive) return "targetNotDead";
  } else if (!target.alive) {
    return "targetDead";
  }

  if (target !== caster) {
    // Near sight : la portée des sorts du lanceur est réduite (une incantation finit donc hors de portée).
    const reduced = isMagic(ability) && caster.has("nearSight");
    const range = spellRange(ability, caster.has("nearSight"));
    if (distance(caster.state, target.state) > range) return reduced ? "outOfRangeNearSight" : "outOfRange";
    if (ability.minRange && distance(caster.state, target.state) < ability.minRange) return "tooClose";
    if (!hasLineOfSight(caster.state, target.state)) return "noLineOfSight";
  }
  if (isOffensive(ability) && !isFacing(caster.state, target.state)) return "notFacing";
  if (ability.position && positionRelativeTo(target.state, caster.state) !== ability.position) {
    return ability.position === "back" ? "needBack" : "needSide";
  }
  return null;
}

// Centre d'une zone d'effet : la cible pour une compétence visant un ennemi, le lanceur sinon.
export function areaCenter(players: ReadonlyMap<string, PlayerRuntime>, caster: PlayerRuntime, ability: AbilityDef, targetId: string): PlayerRuntime {
  return ability.target === "enemy" ? (players.get(targetId) ?? caster) : caster;
}

// Cible unique, ou tous les personnages concernés dans la zone d'effet.
export function affectedBy(players: ReadonlyMap<string, PlayerRuntime>, caster: PlayerRuntime, ability: AbilityDef, targetId: string): PlayerRuntime[] {
  const target = players.get(targetId);
  if (!target) return [];
  if (!ability.radius) return [target];

  const offensive = isOffensive(ability);
  // Une compétence qui ressuscite (Intervention divine) touche les alliés morts de la zone.
  const revives = revivesInArea(ability);
  const center = areaCenter(players, caster, ability, targetId);
  // Une déflagration autour du lanceur touche tout ce qui est dans le rayon, obstacles compris ; de même, le Soin de
  // groupe soigne et l'Intervention divine relève tous les alliés de la zone, même derrière un obstacle.
  const throughWalls = ignoresLineOfSight(ability);
  return [...players.values()].filter(
    (p) =>
      p.alive !== revives &&
      areEnemies(caster, p) === offensive &&
      distance(center.state, p.state) <= ability.radius! &&
      (throughWalls || hasLineOfSight(center.state, p.state)),
  );
}
