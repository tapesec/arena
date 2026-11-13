import { en, type TextKey } from "./en";
import { fr } from "./fr";

export type { TextKey };
export type Language = "en" | "fr";

// Langues proposées par le sélecteur de l'accueil, chacune écrite dans sa propre langue.
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
];

const TEXTS: Record<Language, Record<TextKey, string>> = { en, fr };
const STORAGE_KEY = "arena.language";

// Anglais par défaut ; le choix fait sur l'accueil est retenu par le navigateur. La langue ne change que sur
// l'accueil : le code du jeu (hors React) peut lire la langue courante au moment d'afficher un texte.
let current: Language = readSavedLanguage();
// Garde : le module peut être importé hors navigateur (tests node).
if (typeof document !== "undefined") document.documentElement.lang = current;

function readSavedLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    // Stockage indisponible (navigation privée…) : langue par défaut.
  }
  return "en";
}

export function currentLanguage(): Language {
  return current;
}

export function setLanguage(language: Language) {
  current = language;
  if (typeof document !== "undefined") document.documentElement.lang = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Stockage indisponible : la langue vaut pour cette visite seulement.
  }
}

// Texte dans la langue courante ; {nom} est remplacé par params.nom.
export function t(key: TextKey, params?: Record<string, string | number>): string {
  const text = TEXTS[current][key];
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text;
}

// Nombre décimal à l'écrit : virgule en français, point en anglais.
export function formatDecimal(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return current === "fr" ? text.replace(".", ",") : text;
}

// Titre cité : « … » en français (espaces insécables), “…” en anglais.
export function quote(title: string): string {
  return current === "fr" ? `«\u00a0${title}\u00a0»` : `“${title}”`;
}

// Touches de déplacement (touches physiques, voir KeyboardInput) écrites comme sur le clavier du joueur : la
// disposition réelle quand le navigateur la donne (Chrome, Edge), sinon celle qu'on suppose d'après la langue
// (AZERTY en français, QWERTY en anglais).
type MoveKey = "up" | "down" | "left" | "right";
const MOVE_CODES: Record<MoveKey, string> = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" };
const ASSUMED_KEYS: Record<Language, Record<MoveKey, string>> = {
  en: { up: "W", down: "S", left: "A", right: "D" },
  fr: { up: "Z", down: "S", left: "Q", right: "D" },
};
let layoutKeys: Record<MoveKey, string> | null = null;

const keyboard = typeof navigator !== "undefined"
  ? (navigator as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard
  : undefined;
keyboard
  ?.getLayoutMap?.()
  .then((map) => {
    const keys = {} as Record<MoveKey, string>;
    for (const [move, code] of Object.entries(MOVE_CODES) as [MoveKey, string][]) {
      const key = map.get(code);
      if (!key) return;
      keys[move] = key.toUpperCase();
    }
    layoutKeys = keys;
  })
  .catch(() => {
    // Disposition indisponible (page dans une iframe…) : lettres supposées d'après la langue.
  });

export function moveKeys(): Record<MoveKey, string> {
  return layoutKeys ?? ASSUMED_KEYS[current];
}
