import { create } from "zustand";

// Pont entre le jeu et React : seules les infos utiles à l'interface passent ici,
// et uniquement quand elles changent, jamais à chaque frame.
type ConnectionStatus = "connecting" | "connected" | "error";

export interface CastFrame {
  abilityName: string;
  progress: number; // entre 0 et 1
}

export interface UnitFrame {
  name: string;
  hp: number;
  maxHp: number;
  cast: CastFrame | null;
}

export interface SelfFrame extends UnitFrame {
  mana: number;
  maxMana: number;
  endurance: number;
  maxEndurance: number;
  attacking: boolean;
}

export interface TargetFrame extends UnitFrame {
  distance: number;
  inMeleeRange: boolean;
  inLineOfSight: boolean;
  // La cible est dans le cône de vision du joueur.
  facing: boolean;
}

const MAX_LOG_LINES = 8;
const ERROR_DISPLAY_MS = 2000;

let errorTimeout: ReturnType<typeof setTimeout> | undefined;

interface HudState {
  status: ConnectionStatus;
  error: string | null;
  playerCount: number;
  self: SelfFrame | null;
  target: TargetFrame | null;
  combatLog: string[];
  // Instant (performance.now()) de fin de recharge, par compétence.
  cooldownEnds: Record<string, number>;
  // Message bref affiché au centre de l'écran ("Cible hors de portée"...).
  flashMessage: string | null;
  setStatus: (status: ConnectionStatus, error?: string) => void;
  setPlayerCount: (count: number) => void;
  setFrames: (self: SelfFrame | null, target: TargetFrame | null) => void;
  pushLog: (line: string) => void;
  startCooldown: (abilityId: string, durationSeconds: number) => void;
  flash: (message: string) => void;
}

export const useHudStore = create<HudState>((set) => ({
  status: "connecting",
  error: null,
  playerCount: 0,
  self: null,
  target: null,
  combatLog: [],
  cooldownEnds: {},
  flashMessage: null,
  setStatus: (status, error) => set({ status, error: error ?? null }),
  setPlayerCount: (playerCount) => set({ playerCount }),
  setFrames: (self, target) => set({ self, target }),
  pushLog: (line) => set((s) => ({ combatLog: [...s.combatLog, line].slice(-MAX_LOG_LINES) })),
  startCooldown: (abilityId, durationSeconds) =>
    set((s) => ({ cooldownEnds: { ...s.cooldownEnds, [abilityId]: performance.now() + durationSeconds * 1000 } })),
  flash: (message) => {
    clearTimeout(errorTimeout);
    set({ flashMessage: message });
    errorTimeout = setTimeout(() => set({ flashMessage: null }), ERROR_DISPLAY_MS);
  },
}));
