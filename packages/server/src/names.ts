// Pseudos de fantasy tirés au hasard pour les joueurs et les bots (tous différents dans une salle).
const NAMES = [
  "Aldric", "Morwen", "Brann", "Elowen", "Garrick", "Isolde", "Kael", "Lyra", "Maelis", "Nerys",
  "Orrin", "Perrin", "Quenna", "Rowan", "Seren", "Tamsin", "Ulric", "Vesna", "Wynn", "Yorick",
  "Ailith", "Bedwyr", "Cadoc", "Deira", "Eamon", "Fenna", "Gwenllian", "Hald", "Ivor", "Jory",
  "Kerra", "Lorcan", "Mira", "Niall", "Oswin", "Rhosyn", "Sigrun", "Talwyn", "Ysolde", "Zora",
];
const TITLES = ["le Gris", "la Rouge", "le Hardi", "l'Ancien", "la Brave", "le Sage", "Cœur-de-Fer", "Pied-Léger"];

export function randomName(taken: Set<string>, random = Math.random): string {
  const free = NAMES.filter((n) => !taken.has(n));
  if (free.length) return free[Math.floor(random() * free.length)];
  // Tous les noms simples sont pris : nom suivi d'un surnom.
  for (let i = 0; i < 100; i++) {
    const name = `${NAMES[Math.floor(random() * NAMES.length)]} ${TITLES[Math.floor(random() * TITLES.length)]}`;
    if (!taken.has(name)) return name;
  }
  return `Aventurier ${taken.size + 1}`;
}
