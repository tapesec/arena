import type { Position } from "./movement";

// Déroulement d'une partie :
// - waiting : file d'attente, jusqu'à ce que la partie soit complète
// - classSelect : chaque joueur choisit sa classe, sans voir celles des adversaires
// - preparation : les équipes se préparent dans leur zone de départ (buffs, plan)
// - fighting : combat, sans réapparition
// - ended : une équipe a été entièrement éliminée
export type MatchPhase = "waiting" | "classSelect" | "preparation" | "fighting" | "ended";

// Nombre de joueurs pour lancer une partie (2 équipes de 8).
export const MATCH_SIZE = 16;

export const CLASS_SELECT_DURATION = 30;
export const PREPARATION_DURATION = 10;

// Distance à laquelle un personnage voit les ennemis (si rien ne bloque la vue).
export const VISION_RANGE = 35;

export interface StartZone {
  x: number;
  z: number;
  radius: number;
}

// Deux coins opposés de l'arène : l'équipe 1 part du bas de l'écran, l'équipe 2 du haut.
export const START_ZONES: StartZone[] = [
  { x: -36, z: -36, radius: 8 },
  { x: 36, z: 36, radius: 8 },
];

export const TEAM_NAMES = ["Bleus", "Rouges"];

// Garde une position à l'intérieur d'une zone de départ (pendant la préparation).
export function confineToZone(pos: Position, zone: StartZone): Position {
  const dx = pos.x - zone.x;
  const dz = pos.z - zone.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= zone.radius) return pos;
  return { x: zone.x + (dx / dist) * zone.radius, z: zone.z + (dz / dist) * zone.radius };
}

// Positions de départ réparties en cercle dans la zone.
export function spawnPosition(zone: StartZone, index: number, count: number): Position {
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const radius = zone.radius * 0.5;
  return { x: zone.x + Math.cos(angle) * radius, z: zone.z + Math.sin(angle) * radius };
}
