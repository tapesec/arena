import { CLASS_LIST, type ClassId } from "@arena/shared";

// Composition visée pour une équipe de 8, dans l'ordre d'importance :
// d'abord un soigneur, un tank et un contrôleur, puis des dégâts.
const PREFERRED: ClassId[] = ["pretre", "gardien", "barde", "arcaniste", "lame", "pretre", "arcaniste", "lame"];

// Classe qu'un bot choisit pour compléter son équipe, compte tenu des classes déjà prises.
export function pickBotClass(teamClasses: ClassId[]): ClassId {
  const taken = new Map<ClassId, number>();
  for (const c of teamClasses) taken.set(c, (taken.get(c) ?? 0) + 1);

  const wanted = new Map<ClassId, number>();
  for (const c of PREFERRED) {
    wanted.set(c, (wanted.get(c) ?? 0) + 1);
    if ((taken.get(c) ?? 0) < wanted.get(c)!) return c;
  }
  // Équipe déjà complète selon la composition visée : classe au hasard.
  return CLASS_LIST[Math.floor(Math.random() * CLASS_LIST.length)].id;
}

// Bots d'une équipe à l'ouverture de la salle : une classe de chaque, un second Prêtre, puis des Lames ou des
// Arcanistes tirés au hasard. Pour une équipe plus petite (tests), on garde les premiers.
export function initialBotClasses(teamSize: number, random = Math.random): ClassId[] {
  const classes: ClassId[] = ["pretre", "gardien", "barde", "arcaniste", "lame", "pretre"];
  while (classes.length < teamSize) classes.push(random() < 0.5 ? "lame" : "arcaniste");
  return classes.slice(0, teamSize);
}

// Ordre dans lequel les bots cèdent leur place aux joueurs : les dégâts d'abord, le soigneur et le tank en dernier.
const REMOVAL_ORDER: ClassId[] = ["lame", "arcaniste", "barde", "gardien", "pretre"];

// Bot qui laisse sa place à un joueur qui arrive : d'abord un doublon (une classe que plusieurs bots jouent), puis
// dans l'ordre REMOVAL_ORDER. Retourne l'index du bot dans la liste, -1 s'il n'y en a pas.
export function botToReplace(botClasses: ClassId[]): number {
  if (botClasses.length === 0) return -1;
  const count = (c: ClassId) => botClasses.filter((b) => b === c).length;
  const rank = (c: ClassId) => REMOVAL_ORDER.indexOf(c);
  let best = 0;
  for (let i = 1; i < botClasses.length; i++) {
    const [a, b] = [botClasses[i], botClasses[best]];
    const aDup = count(a) > 1;
    const bDup = count(b) > 1;
    if (aDup !== bDup ? aDup : rank(a) < rank(b)) best = i;
  }
  return best;
}
