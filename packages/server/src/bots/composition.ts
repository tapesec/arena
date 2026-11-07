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
