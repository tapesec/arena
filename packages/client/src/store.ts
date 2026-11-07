import { create } from "zustand";

// Pont entre le jeu et React : seules les infos utiles à l'interface passent ici,
// et uniquement quand elles changent, jamais à chaque frame.
type ConnectionStatus = "connecting" | "connected" | "error";

export interface UnitFrame {
  name: string;
  hp: number;
  maxHp: number;
}

export interface SelfFrame extends UnitFrame {
  attacking: boolean;
}

export interface TargetFrame extends UnitFrame {
  inMeleeRange: boolean;
  distance: number;
}

const MAX_LOG_LINES = 6;

interface HudState {
  status: ConnectionStatus;
  error: string | null;
  playerCount: number;
  self: SelfFrame | null;
  target: TargetFrame | null;
  combatLog: string[];
  setStatus: (status: ConnectionStatus, error?: string) => void;
  setPlayerCount: (count: number) => void;
  setSelf: (self: SelfFrame | null) => void;
  setTarget: (target: TargetFrame | null) => void;
  pushLog: (line: string) => void;
}

export const useHudStore = create<HudState>((set) => ({
  status: "connecting",
  error: null,
  playerCount: 0,
  self: null,
  target: null,
  combatLog: [],
  setStatus: (status, error) => set({ status, error: error ?? null }),
  setPlayerCount: (playerCount) => set({ playerCount }),
  setSelf: (self) => set({ self }),
  setTarget: (target) => set({ target }),
  pushLog: (line) => set((s) => ({ combatLog: [...s.combatLog, line].slice(-MAX_LOG_LINES) })),
}));
