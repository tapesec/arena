import type { MatchPhase } from "@arena/shared";

// Ce que le client lit de l'état de la partie synchronisé par le serveur (voir server/src/state.ts). Avant le premier
// état reçu, les champs sont encore vides : phase "" en particulier.
export interface MatchStateView {
  phase: MatchPhase;
  phaseTimeLeft: number;
  playerCount: number;
  matchSize: number;
  winner: number;
  campSwap: boolean;
  alive0: number;
  alive1: number;
  teamSize: number;
  // Horloge du serveur (ms), avancée à chaque tick.
  time: number;
  // Écran de chargement : progression de chaque joueur de la partie.
  loading?: Map<string, { name: string; team: number; isBot: boolean; progress: number }>;
}
