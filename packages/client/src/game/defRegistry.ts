// Réglages d'un genre d'effet (marques au sol, objets 3D, affichages 2D) : ceux de départ, définis dans le code, et
// ceux enregistrés depuis la page de réglage (fichier JSON), qui les remplacent ou s'y ajoutent.
export interface DefRegistry<T> {
  // Réglages enregistrés, donnés par le jeu ou par la page de réglage.
  set(defs: Record<string, T>): void;
  // Réglage par son nom : sa version enregistrée, sinon celle de départ (null s'il n'existe pas). Les réglages absents
  // d'un enregistrement (ajoutés depuis) reprennent ceux de départ, sinon ceux par défaut.
  get(id: string): T | null;
  // Tous les réglages, de départ puis enregistrés, avec leur nom affiché.
  choices(): { id: string; label: string }[];
  label(id: string): string;
}

export function createDefRegistry<T extends { label?: string }>(fallback: T, builtin: Record<string, T>): DefRegistry<T> {
  let saved: Record<string, T> = {};
  const label = (id: string) => saved[id]?.label ?? builtin[id]?.label ?? id;
  return {
    set: (defs) => {
      saved = defs;
    },
    get: (id) => (saved[id] || builtin[id] ? { ...fallback, ...builtin[id], ...saved[id] } : null),
    choices: () => [...new Set([...Object.keys(builtin), ...Object.keys(saved)])].map((id) => ({ id, label: label(id) })),
    label,
  };
}
