// Deux épées croisées : séparateur du décompte, icône de l'attaque automatique, emblème de la bannière de fin.
export const SWORDS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M64 32l176 176-32 32L32 64zm384 0L272 208l32 32L480 64zM176 272l-80 80-48-16 16 48-32 32 32 32 32-32 48 16-16-48 80-80zm160 0-32 32 80 80-16 48 48-16 32 32 32-32-32-32 16-48-48 16z"/></svg>';

// Icônes des classes (choisies le 2026-11-22, game-icons.net, voir icons/SOURCES.txt), sur le sceau des annonces et
// dans le tableau de fin : bouclier écartelé (Gardien), chapeau de mage (Arcaniste), prêtre solaire (Prêtre), lyre
// (Barde), assassin encapuchonné (Lame).
const CLASS_FILES = import.meta.glob<string>("./icons/classes/*.svg", { query: "?raw", import: "default", eager: true });
const CLASS_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(CLASS_FILES).map(([file, svg]) => [file.slice("./icons/classes/".length, -".svg".length), svg]),
);

export const classIcon = (classId: string) => CLASS_ICONS[classId] ?? SWORDS;
