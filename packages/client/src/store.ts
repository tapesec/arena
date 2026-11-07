import { create } from "zustand";

// Pont entre le jeu et React : seules les infos utiles à l'interface passent ici,
// jamais les positions mises à jour à chaque frame.
type ConnectionStatus = "connecting" | "connected" | "error";

interface HudState {
  status: ConnectionStatus;
  error: string | null;
  playerCount: number;
  setStatus: (status: ConnectionStatus, error?: string) => void;
  setPlayerCount: (count: number) => void;
}

export const useHudStore = create<HudState>((set) => ({
  status: "connecting",
  error: null,
  playerCount: 0,
  setStatus: (status, error) => set({ status, error: error ?? null }),
  setPlayerCount: (playerCount) => set({ playerCount }),
}));
