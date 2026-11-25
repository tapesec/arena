import { readItem, writeItem } from "../storage";

// Langue courante (module à part : content.ts et index.ts la lisent sans s'importer l'un l'autre).
export type Language = "en" | "fr";

const STORAGE_KEY = "arena.language";

// Anglais par défaut ; le choix fait sur l'accueil est retenu par le navigateur. La langue ne change que sur
// l'accueil : le code du jeu (hors React) peut lire la langue courante au moment d'afficher un texte.
let current: Language = readSavedLanguage();
// Garde : le module peut être importé hors navigateur (tests node).
if (typeof document !== "undefined") document.documentElement.lang = current;

function readSavedLanguage(): Language {
  const saved = readItem(STORAGE_KEY);
  return saved === "en" || saved === "fr" ? saved : "en";
}

export function currentLanguage(): Language {
  return current;
}

export function setLanguage(language: Language) {
  current = language;
  if (typeof document !== "undefined") document.documentElement.lang = language;
  writeItem(STORAGE_KEY, language);
}
