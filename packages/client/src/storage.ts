// Stockage du navigateur, qui peut manquer ou refuser (navigation privée, données bloquées, tests sous Node) : une
// lecture impossible rend « unavailable » (null par défaut), une écriture impossible est ignorée (le réglage ne vaut
// alors que pour cette visite).
export function readItem(key: string, unavailable: string | null = null): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return unavailable;
  }
}

export function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible : rien n'est retenu.
  }
}
