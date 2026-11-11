import samples from "./samples.json";

// Choix faits dans l'onglet « Sons » de animation-lab.html, enregistrés dans soundEdits.json puis appliqués au
// catalogue par scripts/build-sound-catalog.mjs (« applique les sons ») :
// - rejected : sons retirés du catalogue (un fichier entier est déplacé dans assets-source/sounds-rejected ; un
//   morceau d'une piste découpée est simplement écarté) ;
// - cuts : coupes (secondes) d'une piste qui enchaîne plusieurs sons ; chaque morceau devient un son du catalogue,
//   nommé <son>_part<n>.
export interface SoundEdits {
  rejected: string[];
  cuts: Record<string, number[]>;
}

export const EMPTY_EDITS: SoundEdits = { rejected: [], cuts: {} };

// Préfixe d'un son du jeu (groupe enregistré ou son généré) sur une piste de compétence ; sans préfixe, un son du
// catalogue.
export const GAME_SOUND = "jeu:";

// Mêmes choix (quel que soit l'ordre des clés et des sons retirés).
export function sameEdits(a: SoundEdits, b: SoundEdits): boolean {
  const key = (e: SoundEdits) =>
    JSON.stringify([
      [...e.rejected].sort(),
      Object.keys(e.cuts)
        .sort()
        .map((name) => [name, e.cuts[name]]),
    ]);
  return key(a) === key(b);
}

// Son du catalogue (soundCatalog.json). Un morceau d'une piste découpée a son parent et sa portion du fichier.
export interface CatalogSound {
  name: string;
  pack: string;
  file: string;
  duration: number;
  // Licence qui interdit toute modification (CC BY-ND) : ni découpe, ni retouche.
  intact?: boolean;
  parent?: string;
  start?: number;
  end?: number;
  // Piste découpée (avec les coupes appliquées) : gardée pour revoir ses coupes, ses morceaux sont les sons à utiliser.
  split?: boolean;
  cuts?: number[];
}

// Morceau d'une piste : « <piste>_part<n> ».
export function isPartOf(name: string, parent: string): boolean {
  return name.length > parent.length + 5 && name.startsWith(`${parent}_part`) && /^\d+$/.test(name.slice(parent.length + 5));
}

// Nom d'un morceau d'une piste découpée.
export function partName(parent: string, index: number): string {
  return `${parent}_part${index + 1}`;
}

// Morceaux d'une piste d'après ses coupes : [début, fin] de chacun. Comme scripts/build-sound-catalog.mjs, les coupes
// trop proches (d'une autre ou d'un bout) sont ignorées : pas de morceau de moins de MIN_PART secondes.
export const MIN_PART = 0.05;
export function segmentsOf(duration: number, cuts: readonly number[]): [number, number][] {
  const points = [0];
  for (const t of [...cuts].sort((a, b) => a - b)) if (t - points[points.length - 1] >= MIN_PART && duration - t >= MIN_PART) points.push(t);
  points.push(duration);
  return points.slice(1).map((end, i) => [points[i], end]);
}

// Choix enregistrés pas encore appliqués au catalogue (« applique les sons ») : sons à retirer encore présents,
// pistes dont les coupes diffèrent de celles appliquées.
export function pendingEdits(catalog: readonly CatalogSound[], saved: SoundEdits): { rejected: number; cuts: number } {
  const names = new Map(catalog.map((s) => [s.name, s]));
  const rejected = saved.rejected.filter((name) => names.has(name)).length;
  const cutNames = new Set([...Object.keys(saved.cuts), ...catalog.filter((s) => s.split).map((s) => s.name)]);
  const cuts = [...cutNames].filter((name) => JSON.stringify(saved.cuts[name] ?? []) !== JSON.stringify(names.get(name)?.cuts ?? [])).length;
  return { rejected, cuts };
}

// Groupes de sons du jeu (samples.json) qui utilisent un fichier : un son en jeu ne peut pas être retiré.
const GROUPS = Object.entries(samples.groups) as [string, { label: string; files: string[] }][];
const patternRegex = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
const MATCHERS = GROUPS.map(([id, group]) => ({ id, label: group.label, regexes: group.files.map(patternRegex) }));

export function gameGroupsUsing(file: string): string[] {
  return MATCHERS.filter((m) => m.regexes.some((r) => r.test(file))).map((m) => m.label);
}
