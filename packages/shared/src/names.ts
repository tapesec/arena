// Pseudos : règles de saisie communes au client (champ de l'accueil) et au serveur (qui revérifie).

// Pseudos de fantasy : pseudo par défaut proposé au joueur, et noms des bots.
export const FANTASY_NAMES = [
  "Aldric", "Morwen", "Brann", "Elowen", "Garrick", "Isolde", "Kael", "Lyra", "Maelis", "Nerys",
  "Orrin", "Perrin", "Quenna", "Rowan", "Seren", "Tamsin", "Ulric", "Vesna", "Wynn", "Yorick",
  "Ailith", "Bedwyr", "Cadoc", "Deira", "Eamon", "Fenna", "Gwenllian", "Hald", "Ivor", "Jory",
  "Kerra", "Lorcan", "Mira", "Niall", "Oswin", "Rhosyn", "Sigrun", "Talwyn", "Ysolde", "Zora",
];

export const NAME_MAX_LENGTH = 15;

// Garde seulement les lettres sans accent, les chiffres et le @, dans la limite de NAME_MAX_LENGTH caractères.
export function cleanName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9@]/g, "").slice(0, NAME_MAX_LENGTH);
}

// Suite de chiffres tirés au hasard (« 042 »).
export function randomDigits(count: number, random = Math.random): string {
  let digits = "";
  for (let i = 0; i < count; i++) digits += Math.floor(random() * 10);
  return digits;
}

// Pseudo proposé dans le champ de l'accueil : un nom de fantasy et 3 chiffres, pour limiter les doublons.
export function defaultPlayerName(random = Math.random): string {
  return FANTASY_NAMES[Math.floor(random() * FANTASY_NAMES.length)] + randomDigits(3, random);
}
