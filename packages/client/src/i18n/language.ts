// Langue courante (module à part : content.ts et index.ts la lisent sans s'importer l'un l'autre).
export type Language = "en" | "fr";

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
