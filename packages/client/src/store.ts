import { create } from "zustand";
import { currentLanguage, setLanguage as applyLanguage, type Language } from "./i18n";
import { cleanName, defaultPlayerName, type ClassId, type EffectKind, type MatchPhase, type OrderId, type RelativePosition } from "@arena/shared";

// Pont entre le jeu et React : seules les infos utiles à l'interface passent ici,
// et uniquement quand elles changent, jamais à chaque frame.
// replaced : un bot a pris la place du joueur, qui n'avait pas fini de charger au début du combat.
type ConnectionStatus = "connecting" | "connected" | "error" | "replaced";

// Roue des ordres : centre à l'écran (pixels), ordres dans l'ordre de la roue (en partant du haut, sens horaire), et
// ordre pointé par la souris (null au centre ou sur un ordre grisé).
export interface OrderWheelFrame {
  x: number;
  y: number;
  items: { id: OrderId; label: string; enabled: boolean }[];
  selected: number | null;
}

export interface CastFrame {
  abilityName: string;
  progress: number; // entre 0 et 1
}

export interface EffectFrame {
  kind: EffectKind;
  // Secondes restantes (au dixième), ou null pour un effet permanent.
  remaining: number | null;
  // Durée totale, ou null pour un effet permanent.
  duration: number | null;
  // Celui qui l'a posé : identifiant (clé d'affichage, un Renouveau par Prêtre) et nom (infobulle).
  sourceId: string;
  source: string;
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
  // Chant du Barde en cours (id de la compétence, "" si aucun).
  song: string;
  // Technique de mêlée en attente du prochain coup d'arme ("" si aucune).
  queuedAbility: string;
  // Technique qui a porté au dernier coup d'arme : le combo qui la suit peut partir ("" si aucune).
  comboAbility: string;
  // Le Gardien fonce sur sa cible (Charge).
  charging: boolean;
}

export interface TargetFrame extends UnitFrame {
  isSelf: boolean;
  isAlly: boolean;
  distance: number;
  inMeleeRange: boolean;
  inLineOfSight: boolean;
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
  id: string;
  name: string;
  classId: ClassId | "";
  isSelf: boolean;
  isBot: boolean;
  // Chef d'équipe : il choisit la classe des bots.
  leader: boolean;
}

// Joueur sur l'écran de chargement (adversaires compris, sans leur classe).
export interface LoadingFrame {
  id: string;
  name: string;
  team: number;
  isBot: boolean;
  isSelf: boolean;
  // En pourcentage.
  progress: number;
}

// Commandes que l'interface peut envoyer au serveur, fournies par le jeu une fois connecté.
export interface GameActions {
  selectClass: (classId: ClassId) => void;
  forceStart: () => void;
  // Chef d'équipe : changer la classe d'un bot de son équipe.
  setBotClass: (botId: string, classId: ClassId) => void;
  // Cibler un joueur (clic dans la fenêtre de groupe).
  selectTarget: (playerId: string) => void;
  // Se cibler soi-même (clic sur son propre cadre, comme F1).
  selectSelf: () => void;
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
  // Pseudo saisi à l'accueil, envoyé au serveur en rejoignant une partie.
  playerName: string;
  setPlayerName: (name: string) => void;
  // Langue de l'interface, choisie sur l'accueil (voir i18n).
  language: Language;
  setLanguage: (language: Language) => void;
  status: ConnectionStatus;
  error: string | null;
  match: MatchFrame | null;
  teammates: TeammateFrame[];
  // Aller-retour avec le serveur, en millisecondes (null avant la première mesure).
  ping: number | null;
  setPing: (ping: number | null) => void;
  // Écran de chargement : tous les joueurs, et la fin de son propre chargement.
  loading: LoadingFrame[];
  loaded: boolean;
  self: SelfFrame | null;
  target: TargetFrame | null;
  group: GroupMemberFrame[];
  combatLog: string[];
  // Instant (performance.now()) de fin de recharge, par compétence.
  cooldownEnds: Record<string, number>;
  // Prochain coup d'arme : instants (performance.now()) de début et de fin de l'attente, null avant le premier ;
  // struck : l'attente a commencé par un coup (la jauge le signale d'un éclat).
  swing: { start: number; end: number; struck: boolean } | null;
  // Roue des ordres aux bots, ouverte tant que la molette est enfoncée (null si fermée).
  orderWheel: OrderWheelFrame | null;
  setOrderWheel: (wheel: OrderWheelFrame | null) => void;
  // Message bref affiché au centre de l'écran ("Cible hors de portée"...).
  flashMessage: string | null;
  actions: GameActions | null;
  joinGame: () => void;
  leaveGame: () => void;
  setStatus: (status: ConnectionStatus, error?: string) => void;
  setMatch: (match: MatchFrame, teammates: TeammateFrame[]) => void;
  setLoading: (loading: LoadingFrame[], loaded: boolean) => void;
  setFrames: (self: SelfFrame | null, target: TargetFrame | null, group: GroupMemberFrame[]) => void;
  setActions: (actions: GameActions | null) => void;
  pushLog: (line: string) => void;
  startCooldown: (abilityId: string, durationSeconds: number) => void;
  startSwing: (remainingSeconds: number, struck: boolean) => void;
  flash: (message: string) => void;
}

// Ce qui est remis à zéro à chaque nouvelle partie.
const freshGame = {
  status: "connecting" as ConnectionStatus,
  error: null,
  match: null,
  teammates: [],
  loading: [],
  loaded: false,
  ping: null,
  self: null,
  target: null,
  group: [],
  combatLog: [],
  cooldownEnds: {},
  swing: null,
  flashMessage: null,
  orderWheel: null,
};

// Le dernier pseudo saisi est retenu par le navigateur ; à la première visite, un pseudo par défaut est proposé.
const NAME_STORAGE_KEY = "arena.playerName";

function initialPlayerName(): string {
  try {
    const saved = cleanName(localStorage.getItem(NAME_STORAGE_KEY) ?? "");
    if (saved) return saved;
  } catch {
    // Stockage indisponible (navigation privée…) : pseudo par défaut.
  }
  return defaultPlayerName();
}

export const useHudStore = create<HudState>((set) => ({
  inGame: false,
  gameKey: 0,
  playerName: initialPlayerName(),
  language: currentLanguage(),
  setLanguage: (language) => {
    applyLanguage(language);
    set({ language });
  },
  setPlayerName: (name) => {
    try {
      localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch {
      // Stockage indisponible : le pseudo vaut pour cette visite seulement.
    }
    set({ playerName: name });
  },
  actions: null,
  ...freshGame,
  joinGame: () => set((s) => ({ ...freshGame, inGame: true, gameKey: s.gameKey + 1 })),
  leaveGame: () => set({ ...freshGame, inGame: false }),
  // Remplacé par un bot : plus de partie (la musique revient à celle des menus).
  setStatus: (status, error) => set(status === "replaced" ? { status, error: null, match: null } : { status, error: error ?? null }),
  setMatch: (match, teammates) => set({ match, teammates }),
  setLoading: (loading, loaded) => set({ loading, loaded }),
  setPing: (ping) => set({ ping }),
  setFrames: (self, target, group) => set({ self, target, group }),
  setActions: (actions) => set({ actions }),
  setOrderWheel: (orderWheel) => set({ orderWheel }),
  pushLog: (line) => set((s) => ({ combatLog: [...s.combatLog, line].slice(-MAX_LOG_LINES) })),
  startCooldown: (abilityId, durationSeconds) =>
    set((s) => ({ cooldownEnds: { ...s.cooldownEnds, [abilityId]: performance.now() + durationSeconds * 1000 } })),
  startSwing: (remainingSeconds, struck) => {
    const now = performance.now();
    set({ swing: { start: now, end: now + remainingSeconds * 1000, struck } });
  },
  flash: (message) => {
    clearTimeout(errorTimeout);
    set({ flashMessage: message });
    errorTimeout = setTimeout(() => set({ flashMessage: null }), ERROR_DISPLAY_MS);
  },
}));
