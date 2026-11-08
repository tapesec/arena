import { create } from "zustand";
import type { ClassId, EffectKind, MatchPhase, RelativePosition } from "@arena/shared";

// Pont entre le jeu et React : seules les infos utiles à l'interface passent ici,
// et uniquement quand elles changent, jamais à chaque frame.
type ConnectionStatus = "connecting" | "connected" | "error";

export interface CastFrame {
  abilityName: string;
  progress: number; // entre 0 et 1
}

export interface EffectFrame {
  kind: EffectKind;
  // Secondes restantes arrondies, ou null pour un effet permanent.
  remaining: number | null;
}

export interface UnitFrame {
  name: string;
  className: string;
  hp: number;
  maxHp: number;
  cast: CastFrame | null;
  effects: EffectFrame[];
}

export interface SelfFrame extends UnitFrame {
  classId: ClassId | "";
  mana: number;
  maxMana: number;
  endurance: number;
  maxEndurance: number;
  attacking: boolean;
  // Verrou sur la cible : "face" (F), "stick" (C) ou "".
  lock: string;
  songActive: boolean;
  // Technique de mêlée en attente du prochain coup d'arme ("" si aucune).
  queuedAbility: string;
}

export interface TargetFrame extends UnitFrame {
  isSelf: boolean;
  isAlly: boolean;
  distance: number;
  inMeleeRange: boolean;
  inLineOfSight: boolean;
  // La cible est dans le cône de vision du joueur.
  facing: boolean;
  // Où se trouve le joueur par rapport à la cible : devant, sur son flanc, dans son dos.
  position: RelativePosition;
}

export interface MatchFrame {
  phase: MatchPhase;
  // Secondes restantes dans la phase, arrondies.
  timeLeft: number;
  playerCount: number;
  matchSize: number;
  team: number;
  winner: number;
}

// Coéquipier affiché dans la fenêtre de groupe.
export interface GroupMemberFrame {
  id: string;
  name: string;
  classId: ClassId | "";
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  endurance: number;
  maxEndurance: number;
  // Nom du sort en cours d'incantation, ou null.
  casting: string | null;
  effects: EffectFrame[];
  // À portée de sort et en vue : utile pour savoir qui l'on peut soigner.
  inRange: boolean;
  isTarget: boolean;
}

// Membre de son équipe, affiché pendant le choix des classes.
export interface TeammateFrame {
  name: string;
  classId: ClassId | "";
  isSelf: boolean;
  isBot: boolean;
}

// Commandes que l'interface peut envoyer au serveur, fournies par le jeu une fois connecté.
export interface GameActions {
  selectClass: (classId: ClassId) => void;
  forceStart: () => void;
  addBots: () => void;
  // Cibler un joueur (clic dans la fenêtre de groupe).
  selectTarget: (playerId: string) => void;
  // Lancer une compétence (clic sur la barre d'action).
  castAbility: (abilityId: string) => void;
}

const MAX_LOG_LINES = 8;
const ERROR_DISPLAY_MS = 2000;

let errorTimeout: ReturnType<typeof setTimeout> | undefined;

interface HudState {
  // Le joueur a demandé à rejoindre une partie (sinon : écran d'accueil).
  inGame: boolean;
  // Change à chaque nouvelle partie pour reconnecter proprement le jeu.
  gameKey: number;
  status: ConnectionStatus;
  error: string | null;
  match: MatchFrame | null;
  teammates: TeammateFrame[];
  self: SelfFrame | null;
  target: TargetFrame | null;
  group: GroupMemberFrame[];
  combatLog: string[];
  // Instant (performance.now()) de fin de recharge, par compétence.
  cooldownEnds: Record<string, number>;
  // Message bref affiché au centre de l'écran ("Cible hors de portée"...).
  flashMessage: string | null;
  actions: GameActions | null;
  joinGame: () => void;
  leaveGame: () => void;
  setStatus: (status: ConnectionStatus, error?: string) => void;
  setMatch: (match: MatchFrame, teammates: TeammateFrame[]) => void;
  setFrames: (self: SelfFrame | null, target: TargetFrame | null, group: GroupMemberFrame[]) => void;
  setActions: (actions: GameActions | null) => void;
  pushLog: (line: string) => void;
  startCooldown: (abilityId: string, durationSeconds: number) => void;
  flash: (message: string) => void;
}

// Ce qui est remis à zéro à chaque nouvelle partie.
const freshGame = {
  status: "connecting" as ConnectionStatus,
  error: null,
  match: null,
  teammates: [],
  self: null,
  target: null,
  group: [],
  combatLog: [],
  cooldownEnds: {},
  flashMessage: null,
};

export const useHudStore = create<HudState>((set) => ({
  inGame: false,
  gameKey: 0,
  actions: null,
  ...freshGame,
  joinGame: () => set((s) => ({ ...freshGame, inGame: true, gameKey: s.gameKey + 1 })),
  leaveGame: () => set({ ...freshGame, inGame: false }),
  setStatus: (status, error) => set({ status, error: error ?? null }),
  setMatch: (match, teammates) => set({ match, teammates }),
  setFrames: (self, target, group) => set({ self, target, group }),
  setActions: (actions) => set({ actions }),
  pushLog: (line) => set((s) => ({ combatLog: [...s.combatLog, line].slice(-MAX_LOG_LINES) })),
  startCooldown: (abilityId, durationSeconds) =>
    set((s) => ({ cooldownEnds: { ...s.cooldownEnds, [abilityId]: performance.now() + durationSeconds * 1000 } })),
  flash: (message) => {
    clearTimeout(errorTimeout);
    set({ flashMessage: message });
    errorTimeout = setTimeout(() => set({ flashMessage: null }), ERROR_DISPLAY_MS);
  },
}));
