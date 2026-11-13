import { FANTASY_NAMES, NAME_MAX_LENGTH, randomDigits } from "@arena/shared";

// Les pseudos sont comparés sans tenir compte de la casse (« rowan » et « Rowan » se confondent à l'écran) :
// les ensembles `taken` contiennent les noms pris en minuscules.
export function nameKey(name: string): string {
  return name.toLowerCase();
}

// Pseudos de fantasy tirés au hasard pour les bots (tous différents dans une salle).
const TITLES = ["le Gris", "la Rouge", "le Hardi", "l'Ancien", "la Brave", "le Sage", "Cœur-de-Fer", "Pied-Léger"];

export function randomName(taken: Set<string>, random = Math.random): string {
  const free = FANTASY_NAMES.filter((n) => !taken.has(nameKey(n)));
  if (free.length) return free[Math.floor(random() * free.length)];
  // Tous les noms simples sont pris : nom suivi d'un surnom.
  for (let i = 0; i < 100; i++) {
    const name = `${FANTASY_NAMES[Math.floor(random() * FANTASY_NAMES.length)]} ${TITLES[Math.floor(random() * TITLES.length)]}`;
    if (!taken.has(nameKey(name))) return name;
  }
  for (let i = 1; ; i++) if (!taken.has(nameKey(`Aventurier ${i}`))) return `Aventurier ${i}`;
}

// Pseudo déjà pris par un joueur : 3 chiffres au hasard en suffixe. Le début est raccourci si besoin pour rester
// dans la limite de NAME_MAX_LENGTH caractères.
export function suffixPlayerName(name: string, taken: Set<string>, random = Math.random): string {
  const base = name.slice(0, NAME_MAX_LENGTH - 3);
  for (let i = 0; i < 1000; i++) {
    const candidate = base + randomDigits(3, random);
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  // Tirage malchanceux : on parcourt les 1000 suffixes dans l'ordre.
  for (let n = 0; n < 1000; n++) {
    const candidate = base + String(n).padStart(3, "0");
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return randomName(taken, random);
}

// Pseudo d'un bot repris par un joueur : le bot reçoit un chiffre en suffixe (un autre nom si les 10 sont pris).
export function suffixBotName(name: string, taken: Set<string>, random = Math.random): string {
  const free = [..."0123456789"].map((digit) => name + digit).filter((candidate) => !taken.has(nameKey(candidate)));
  return free.length ? free[Math.floor(random() * free.length)] : randomName(taken, random);
}

// Pseudo choisi par un joueur qui entre dans la salle (players : ceux déjà présents). Déjà porté par un joueur, il
// reçoit 3 chiffres en suffixe ; porté par un bot, c'est le bot qui reçoit un chiffre en suffixe (son nom est
// modifié ici).
export function claimName(wanted: string, players: { name: string; isBot: boolean }[], random = Math.random): string {
  const taken = new Set(players.map((p) => nameKey(p.name)));
  const humanHasIt = players.some((p) => !p.isBot && nameKey(p.name) === nameKey(wanted));
  const name = humanHasIt ? suffixPlayerName(wanted, taken, random) : wanted;
  taken.add(nameKey(name));
  for (const p of players) {
    if (!p.isBot || nameKey(p.name) !== nameKey(name)) continue;
    p.name = suffixBotName(p.name, taken, random);
    taken.add(nameKey(p.name));
  }
  return name;
}
