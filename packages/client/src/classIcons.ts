import { abilityIcon } from "./abilityBar";

// Deux épées croisées : séparateur du décompte, icône de l'attaque automatique, emblème de la bannière de fin.
export const SWORDS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M64 32l176 176-32 32L32 64zm384 0L272 208l32 32L480 64zM176 272l-80 80-48-16 16 48-32 32 32 32 32-32 48 16-16-48 80-80zm160 0-32 32 80 80-16 48 48-16 32 32 32-32-32-32 16-48-48 16z"/></svg>';

// Icône d'une classe (sceau des annonces, tableau de fin) : celle de sa compétence la plus reconnaissable.
const CLASS_ICON: Record<string, string> = { gardien: "guard", arcaniste: "firebolt", pretre: "heal", barde: "ballad", lame: "backstab" };
export const classIcon = (classId: string) => abilityIcon(CLASS_ICON[classId] ?? "") ?? SWORDS;
