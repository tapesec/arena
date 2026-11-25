import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// Brouillons de la page de réglage : chaque fichier de réglages (effets, marques au sol, objets 3D…) est lu au
// chargement, modifié dans un brouillon gardé dans le navigateur, puis enregistré. Le fichier peut changer entre-temps
// (réglage ajouté par Claude, autre onglet) : le brouillon est repris par-dessus, et seuls ses propres changements
// sont écrits.

// Brouillon gardé dans le navigateur, avec la version enregistrée sur laquelle il a été fait (base).
export interface StoredDraft<T> {
  base: Record<string, T>;
  draft: Record<string, T>;
}

// Reprend un brouillon en y ajoutant ce qui a changé dans le fichier depuis (effet créé par Claude, réglage
// enregistré depuis un autre onglet) : seuls les éléments modifiés dans le brouillon gardent leur version.
export function rebaseDraft<T>(stored: StoredDraft<T> | null, file: Record<string, T>): Record<string, T> {
  if (!stored?.base || !stored.draft) return file;
  const result = { ...stored.draft };
  const same = (a: T | undefined, b: T | undefined) => JSON.stringify(a) === JSON.stringify(b);
  for (const id of new Set([...Object.keys(file), ...Object.keys(stored.base)])) {
    if (same(file[id], stored.base[id]) || !same(stored.draft[id], stored.base[id])) continue;
    if (file[id] === undefined) delete result[id];
    else result[id] = file[id];
  }
  return result;
}

// Mêmes réglages quel que soit l'ordre des clés (comparaison, et fichier enregistré stable).
export function sortedKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

// Fichier relu pendant qu'on règle : les éléments qui y ont changé sont repris dans la version enregistrée, et dans le
// brouillon s'ils n'y ont pas été modifiés. null : rien n'a changé.
export function mergeFileChanges<T>(
  saved: Record<string, T>,
  draft: Record<string, T>,
  file: Record<string, T>,
): { saved: Record<string, T>; draft: Record<string, T> } | null {
  const changed = Object.keys(file).filter((id) => JSON.stringify(file[id]) !== JSON.stringify(saved[id]));
  if (!changed.length) return null;
  const nextDraft = { ...draft };
  for (const id of changed) if (JSON.stringify(draft[id]) === JSON.stringify(saved[id])) nextDraft[id] = file[id];
  return { saved: { ...saved, ...Object.fromEntries(changed.map((id) => [id, file[id]])) }, draft: nextDraft };
}

export function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible (navigation privée) : le brouillon n'est simplement pas gardé.
  }
}

// Fichier relu toutes les POLL_MS pendant qu'on règle (voir poll).
const POLL_MS = 4000;

export interface DevFileDraft<T> {
  // Version enregistrée (null tant qu'elle n'est pas lue).
  saved: Record<string, T> | null;
  draft: Record<string, T>;
  setDraft: Dispatch<SetStateAction<Record<string, T>>>;
  unsaved: boolean;
  // Enregistre le brouillon par-dessus la version actuelle du fichier ; renvoie le message d'erreur, null si réussi.
  save(): Promise<string | null>;
}

// name : fichier servi par le serveur de développement (/__dev-file/<name>, voir vite.config.ts) ; draftKey : clé du
// brouillon dans le navigateur. initial : brouillon avant la lecture du fichier ; sorted : clés triées pour comparer et
// enregistrer ; poll : relire le fichier régulièrement (réglages ajoutés par Claude pendant qu'on règle).
export function useDevFileDraft<T>(
  name: string,
  draftKey: string,
  { initial = {}, sorted = false, poll = false }: { initial?: Record<string, T>; sorted?: boolean; poll?: boolean } = {},
): DevFileDraft<T> {
  const url = `/__dev-file/${name}`;
  const [saved, setSaved] = useState<Record<string, T> | null>(null);
  const [draft, setDraft] = useState<Record<string, T>>(initial);
  const order = (record: Record<string, T>) => (sorted ? sortedKeys(record) : record);

  useEffect(() => {
    void fetch(url)
      .then((response) => response.json() as Promise<Record<string, T> | null>)
      .then((file) => {
        setSaved(file ?? {});
        setDraft(rebaseDraft(readStorage<StoredDraft<T>>(draftKey), file ?? {}));
      });
  }, [url, draftKey]);

  const unsaved = saved !== null && JSON.stringify(order(draft)) !== JSON.stringify(order(saved));
  useEffect(() => {
    if (saved) writeStorage(draftKey, unsaved ? { base: saved, draft } : null);
  }, [draftKey, draft, saved, unsaved]);

  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(() => {
      void fetch(url)
        .then((response) => response.json() as Promise<Record<string, T> | null>)
        .then((file) => {
          if (!file) return;
          setSaved((previous) => {
            if (!previous) return previous;
            // Les éléments changés ne dépendent que de la version enregistrée et du fichier : le brouillon suit à part.
            const merged = mergeFileChanges(previous, {}, file);
            if (!merged) return previous;
            setDraft((current) => mergeFileChanges(previous, current, file)?.draft ?? current);
            return merged.saved;
          });
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [poll, url]);

  const save = async (): Promise<string | null> => {
    const file = ((await fetch(url).then((r) => r.json())) ?? {}) as Record<string, T>;
    const next = order(rebaseDraft({ base: saved ?? {}, draft }, file));
    const response = await fetch(url, { method: "POST", body: JSON.stringify(next) });
    if (!response.ok) return response.text();
    setSaved(next);
    setDraft(next);
    return null;
  };

  return { saved, draft, setDraft, unsaved, save };
}
