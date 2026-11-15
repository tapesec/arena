import data from "./gameAppearances.json";
import { isMonster, type GameAppearance } from "./appearance";
import type { CustomCharacter } from "./characterAssets";

// Personnages du jeu par classe et par camp, construits d'après l'éditeur d'apparence (npm run build-appearances).
export const GAME_APPEARANCES = data as unknown as Record<string, (GameAppearance | null)[]>;

// Personnage d'un joueur : l'apparence de son camp, fixe par équipe (la première équipe prend le camp 1, la seconde le
// camp 2) ; undefined sans apparence pour ce camp (le modèle de la classe sert alors).
export function gameCharacter(classId: string, team: number): CustomCharacter | undefined {
  const character = GAME_APPEARANCES[classId]?.[team];
  return character ? { ...character, recolors: [] } : undefined;
}

// Les deux camps de la classe ont leur apparence : son ancien modèle (et ses armes) ne sert plus en jeu.
export function hasBothCamps(classId: string): boolean {
  const variants = GAME_APPEARANCES[classId];
  return variants?.length === 2 && variants.every((character) => character);
}

// Corps d'une race parmi les personnages du jeu (même squelette que nos bibliothèques d'animations), s'il y en a un :
// gabarit du reciblage des animations Mixamo (voir CharacterAssets.loadMixamo).
export function raceBody(): string | undefined {
  for (const variants of Object.values(GAME_APPEARANCES)) {
    for (const character of variants) if (character && !isMonster(character.appearance.model)) return character.body;
  }
  return undefined;
}

// Fichiers des personnages du jeu (corps et objets), relatifs à public/models/.
export function gameCharacterFiles(): string[] {
  const files = new Set<string>();
  for (const variants of Object.values(GAME_APPEARANCES)) {
    for (const character of variants) {
      if (!character) continue;
      files.add(character.body);
      for (const item of character.items) files.add(item.file);
    }
  }
  return [...files];
}
