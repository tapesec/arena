// Réglages du serveur modifiables par variables d'environnement, pour tester (parties à 4, salle d'attente courte…).

// Variables qui changent le déroulement des parties (et COLYSEUS_LATENCY, lue par Colyseus : latence artificielle).
export const TEST_OVERRIDES = [
  "MATCH_SIZE",
  "LOBBY_DURATION",
  "FULL_LOBBY_COUNTDOWN",
  "PREPARATION_DURATION",
  "LOADING_DURATION",
  "COLYSEUS_LATENCY",
] as const;

// Nombre strictement positif lu dans la variable, sinon la valeur par défaut (une valeur invalide est signalée).
export function envNumber(name: (typeof TEST_OVERRIDES)[number], fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  console.warn(`${name}=${raw} n'est pas un nombre positif : valeur par défaut ${fallback}.`);
  return fallback;
}

// Variables de test présentes, pour prévenir au démarrage en production (une variable oubliée dans le terminal ne doit
// pas changer les parties en silence).
export function activeOverrides(): string[] {
  return TEST_OVERRIDES.filter((name) => process.env[name] !== undefined).map((name) => `${name}=${process.env[name]}`);
}
