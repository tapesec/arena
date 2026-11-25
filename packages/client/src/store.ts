import { create } from "zustand";
import { currentLanguage, setLanguage as applyLanguage, type Language } from "./i18n";
import { cleanName, defaultPlayerName, type ClassId, type EffectKind, type MatchPhase, type MatchSummary, type OrderId, type RelativePosition } from "@arena/shared";
import { readItem, writeItem } from "./storage";

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
  // Roulade en cours ; immobilisé (root, arrêt net de la Provocation) : case de la roulade sur la barre.
  rolling: boolean;
  rooted: boolean;
}

export interface TargetFrame extends UnitFrame {
  classId: ClassId | "";
  mana: number;
  maxMana: number;
  endurance: number;
  maxEndurance: number;
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
  // Survivants de son équipe et de celle d'en face pendant le combat, et taille d'une équipe (décompte en haut).
  alliesAlive: number;
  enemiesAlive: number;
  teamSize: number;
  // Jeu de personnages de son équipe pour cette partie (voir campOf).
  camp: number;
  winner: number;
}

// Membre de la fenêtre de groupe : soi (en premier, F1), puis ses coéquipiers (F2 à F8).
export interface GroupMemberFrame {
  id: string;
  isSelf: boolean;
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
  // Roulade (clic sur sa case, comme Espace).
  roll: () => void;
}

const ERROR_DISPLAY_MS = 2000;

let errorTimeout: ReturnType<typeof setTimeout> | undefined;
// Conseil ponctuel (voir showHint) : affiché plus longtemps qu'une erreur, le temps de le lire.
const HINT_DISPLAY_MS = 6000;
let hintTimeout: ReturnType<typeof setTimeout> | undefined;
// Conseils déjà montrés pendant cette visite (au cas où le stockage local est indisponible).
const shownHints = new Set<string>();

// Élimination annoncée (voir KillEvent), vue par le joueur local : ally = de son équipe.
// Récap de fin de partie (voir MatchSummary), avec l'identifiant du joueur local pour le repérer dans le tableau.
export type SummaryFrame = MatchSummary & { selfId: string };

export interface KillFrame {
  id: number;
  // Heure d'arrivée (performance.now()) : l'annonce au centre dure un temps fixe à partir de là.
  at: number;
  victimName: string;
  victimAlly: boolean;
  victimClass: string;
  killerName: string;
  killerAlly: boolean;
  abilityId: string;
  lastStanding?: { name: string; ally: boolean };
}

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
  // Déplacement : « modern » (touches dans les directions de l'écran) ou « classic » (comme DAoC). Retenu par le
  // navigateur.
  movementMode: MovementMode;
  setMovementMode: (mode: MovementMode) => void;
  // Didacticiel « Comment jouer ? » ouvert : le clavier sert au didacticiel, plus au personnage.
  tutorialOpen: boolean;
  setTutorialOpen: (open: boolean) => void;
  actions: GameActions | null;
  joinGame: () => void;
  leaveGame: () => void;
  setStatus: (status: ConnectionStatus, error?: string) => void;
  setMatch: (match: MatchFrame, teammates: TeammateFrame[]) => void;
  setLoading: (loading: LoadingFrame[], loaded: boolean) => void;
  setFrames: (self: SelfFrame | null, target: TargetFrame | null, group: GroupMemberFrame[]) => void;
  setActions: (actions: GameActions | null) => void;
  // Éliminations de la partie, la plus récente en premier (annonce au centre et fil à droite).
  kills: KillFrame[];
  addKill: (kill: Omit<KillFrame, "id" | "at">) => void;
  // Récap envoyé par le serveur à la fin de la partie (null avant).
  summary: SummaryFrame | null;
  setSummary: (summary: SummaryFrame) => void;
  startCooldown: (abilityId: string, durationSeconds: number) => void;
  startSwing: (remainingSeconds: number, struck: boolean) => void;
  flash: (message: string) => void;
  // Conseil affiché sous les messages d'erreur, une seule fois par navigateur : key le retient (stockage local, à
  // défaut pour la visite), un conseil déjà vu n'est plus montré.
  hint: string | null;
  showHint: (key: string, message: string) => void;
}

// Ce qui est remis à zéro à chaque nouvelle partie.
// Éliminations gardées pour le fil (on n'en montre que les dernières).
const KILLS_KEPT = 8;

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
  cooldownEnds: {},
  swing: null,
  flashMessage: null,
  hint: null,
  orderWheel: null,
  kills: [],
  summary: null,
};

export type MovementMode = "modern" | "classic";
const MOVEMENT_STORAGE_KEY = "arena.movementMode";

// Mode moderne par défaut (décidé le 2026-11-19 : plus simple pour un nouveau venu) ; le mode DAoC reste au choix.
function initialMovementMode(): MovementMode {
  return readItem(MOVEMENT_STORAGE_KEY) === "classic" ? "classic" : "modern";
}

// Le dernier pseudo saisi est retenu par le navigateur ; à la première visite, un pseudo par défaut est proposé.
const NAME_STORAGE_KEY = "arena.playerName";

function initialPlayerName(): string {
  return cleanName(readItem(NAME_STORAGE_KEY) ?? "") || defaultPlayerName();
}

export const useHudStore = create<HudState>((set) => ({
  inGame: false,
  gameKey: 0,
  playerName: initialPlayerName(),
  movementMode: initialMovementMode(),
  tutorialOpen: false,
  setTutorialOpen: (tutorialOpen) => set({ tutorialOpen }),
  setMovementMode: (mode) => {
    writeItem(MOVEMENT_STORAGE_KEY, mode);
    set({ movementMode: mode });
  },
  language: currentLanguage(),
  setLanguage: (language) => {
    applyLanguage(language);
    set({ language });
  },
  setPlayerName: (name) => {
    writeItem(NAME_STORAGE_KEY, name);
    set({ playerName: name });
  },
  actions: null,
  ...freshGame,
  joinGame: () => set((s) => ({ ...freshGame, inGame: true, gameKey: s.gameKey + 1 })),
  leaveGame: () => set({ ...freshGame, inGame: false }),
  // Remplacé par un bot : plus de partie (la musique revient à celle des menus).
  setStatus: (status, error) => set(status === "replaced" ? { status, error: null, match: null } : { status, error: error ?? null }),
  setMatch: (match, teammates) => set({ match, teammates }),
  setSummary: (summary) => set({ summary }),
  addKill: (kill) => set((s) => ({ kills: [{ ...kill, id: (s.kills[0]?.id ?? 0) + 1, at: performance.now() }, ...s.kills].slice(0, KILLS_KEPT) })),
  setLoading: (loading, loaded) => set({ loading, loaded }),
  setPing: (ping) => set({ ping }),
  setFrames: (self, target, group) => set({ self, target, group }),
  setActions: (actions) => set({ actions }),
  setOrderWheel: (orderWheel) => set({ orderWheel }),
  startCooldown: (abilityId, durationSeconds) =>
    set((s) => ({ cooldownEnds: { ...s.cooldownEnds, [abilityId]: performance.now() + durationSeconds * 1000 } })),
  startSwing: (remainingSeconds, struck) => {
    const now = performance.now();
    set({ swing: { start: now, end: now + remainingSeconds * 1000, struck } });
  },
  showHint: (key, message) => {
    const storageKey = `arena.hint.${key}`;
    if (shownHints.has(key)) return;
    shownHints.add(key);
    // Stockage indisponible : le conseil est montré à chaque fois.
    if (readItem(storageKey)) return;
    writeItem(storageKey, "1");
    clearTimeout(hintTimeout);
    set({ hint: message });
    hintTimeout = setTimeout(() => set({ hint: null }), HINT_DISPLAY_MS);
  },
  flash: (message) => {
    clearTimeout(errorTimeout);
    set({ flashMessage: message });
    errorTimeout = setTimeout(() => set({ flashMessage: null }), ERROR_DISPLAY_MS);
  },
}));
