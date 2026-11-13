import { en, type TextKey } from "./en";
import { fr } from "./fr";

export type { TextKey };
export { currentLanguage, setLanguage, type Language } from "./language";
import { currentLanguage, type Language } from "./language";

// Langues proposées par le sélecteur de l'accueil, chacune écrite dans sa propre langue.
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
];

const TEXTS: Record<Language, Record<TextKey, string>> = { en, fr };
// Texte dans la langue courante ; {nom} est remplacé par params.nom.
export function t(key: TextKey, params?: Record<string, string | number>): string {
  // Repli sur l'anglais puis sur la clé : un code inconnu (client et serveur de versions différentes) ne plante pas.
  const text = TEXTS[currentLanguage()][key] ?? TEXTS.en[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : text;
}

// Nombre décimal à l'écrit : virgule en français, point en anglais.
export function formatDecimal(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return currentLanguage() === "fr" ? text.replace(".", ",") : text;
}

// Titre cité : « … » en français (espaces insécables), “…” en anglais.
export function quote(title: string): string {
  return currentLanguage() === "fr" ? `«\u00a0${title}\u00a0»` : `“${title}”`;
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
  return layoutKeys ?? ASSUMED_KEYS[currentLanguage()];
}
export * from "./content";
