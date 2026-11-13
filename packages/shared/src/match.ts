import type { Position } from "./movement";

// Déroulement d'une partie :
// - classSelect : salle d'attente. Les équipes sont complétées par des bots, qui cèdent leur place aux joueurs qui
//   arrivent ; chacun choisit sa classe et voit celles de ses coéquipiers, pas celles des adversaires
// - loading : chacun finit de charger le jeu (modèles, sons) ; la partie continue quand tout le monde a fini, ou au
//   bout de LOADING_DURATION secondes
// - preparation : les équipes se préparent dans leur zone de départ (buffs, plan)
// - fighting : combat, sans réapparition
// - ended : une équipe a été entièrement éliminée
export type MatchPhase = "classSelect" | "loading" | "preparation" | "fighting" | "ended";

// Nombre de joueurs dans une partie (2 équipes de 8, complétées par des bots).
export const MATCH_SIZE = 16;

// La salle d'attente dure au plus LOBBY_DURATION secondes ; quand elle est pleine (plus aucun bot), la partie part
// FULL_LOBBY_COUNTDOWN secondes plus tard, pour laisser le dernier arrivé choisir sa classe.
export const LOBBY_DURATION = 60;
export const FULL_LOBBY_COUNTDOWN = 30;
export const PREPARATION_DURATION = 15;
// Attente maximale du chargement. Un joueur qui n'a pas fini continue de charger pendant la préparation ; s'il n'a
// toujours pas fini quand le combat commence, un bot prend sa place.
export const LOADING_DURATION = 60;

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
