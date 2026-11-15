import { UAL_TO_MIXAMO } from "./mixamo";

// Apparences essayées dans l'éditeur d'apparence (onglets « Apparence » et « Placement » de animation-lab.html), en
// développement seulement : un personnage assemblé à la volée à partir des packs (corps d'une race et pièces de tenue
// Quaternius, ou monstre du pack Fantasy Monsters), avec ses armes et ses accessoires. Les choix sont enregistrés dans
// appearances.json ; le jeu ne les lit pas encore (les modèles du jeu seront construits d'après eux).
// Les modèles viennent de public/dev-models/appearance/ (scripts/prepare-appearance-lab.mjs).

export type Vec3 = [number, number, number];

export type Socket = "head" | "chest" | "neck" | "shoulder" | "wrist" | "hip" | "foot" | "back" | "cape";

export interface OutfitColor {
  variant: number;
  tint?: string;
  tintFrom?: number;
}

// Texture de couleur qui remplace celle d'un matériau (variante du pack), éventuellement teinte (voir textureTint.ts).
export interface Recolor {
  material: string;
  texture: string;
  tint?: { color: string; from: number };
}

// Objet à accrocher au personnage : sa clé de placement, son fichier, son point d'accroche par défaut, et pour une
// paire la pièce gardée.
export interface MountedItem {
  key: string;
  file: string;
  socket: DefaultSocket;
  part?: "right" | "left";
  // Cape : elle pend toute seule, droite et avec un balancement (voir createCustom), au lieu de suivre l'os.
  hang?: boolean;
}

// Placement d'une arme ou d'un accessoire sur un os : position (m), rotation (radians, angles d'Euler) et échelle, dans
// le repère de l'os.
export interface Mount {
  bone: string;
  position: Vec3;
  rotation: Vec3;
  scale: number;
}

// Où se tient une arme : main droite, main gauche, ou rangée dans le dos.
export type WeaponSlot = "right" | "left" | "back";
export const WEAPON_SLOTS: Record<WeaponSlot, string> = { right: "Main droite", left: "Main gauche", back: "Dans le dos" };

export interface HeldWeapon {
  item: string;
  slot: WeaponSlot;
}

export interface Appearance {
  // Corps d'une race (« Elf_Male ») ou monstre (« monster:GoblinWarrior »).
  model: string;
  // Corps d'une race : seulement la tête et le cou (les pièces de tenue couvrent le reste), ou le corps entier.
  headOnly?: boolean;
  // Pièces de tenue Quaternius (du même genre que le corps) et coiffures (une coupe, plus barbe ou moustache) ;
  // ignorées pour un monstre.
  parts: string[];
  hair: string[];
  // Races du pack Fantasy Races : leurs propres cheveux, gardés sauf si false (crâne rasé) ou si une coupe les remplace.
  raceHair?: boolean;
  // Couleur de chaque tenue portée (clé : Knight, Ranger…) : variante du pack (1 à 3) et teinte libre éventuelle : la
  // teinte tintFrom (degrés, une des couleurs principales de la texture) devient la couleur CSS tint.
  outfitColors?: Record<string, OutfitColor>;
  // Races du pack Fantasy Races : variante de couleur de la peau et de leurs cheveux (1 à 3 ; 1 par défaut).
  skin?: number;
  raceHairColor?: number;
  // Teinte des coiffures humaines et des sourcils (couleur CSS) ; sans elle, leur texture grise. Les cheveux d'une race
  // gardent leurs couleurs (texture déjà colorée).
  hairColor?: string;
  weapons: HeldWeapon[];
  // Accessoires portés par-dessus la tenue (pack Hearthfold), qu'on ait un corps ou un monstre.
  accessories: string[];
}

// Contenu de appearances.json : deux variantes par classe (une par camp), et les placements réglés par modèle
// (corps ou monstre) puis par objet (clé de weaponKey ou accessoryKey).
export interface AppearanceFile {
  variants: Record<string, (Appearance | null)[]>;
  mounts: Record<string, Record<string, Mount>>;
}

export const EMPTY_APPEARANCES: AppearanceFile = { variants: {}, mounts: {} };

export const RACES: Record<string, string> = {
  Human: "Humain athlétique",
  HumanRegular: "Humain",
  HumanTeen: "Humain jeune",
  Elf: "Elfe",
  WaterElfEars: "Elfe aquatique (oreilles)",
  WaterElfFins: "Elfe aquatique (nageoires)",
  Orc: "Orc",
  Dragonborn: "Draconien",
  Ape: "Homme-singe",
};

// Coupe de cheveux (une seule à la fois), par opposition aux poils du visage (barbe, moustache), cumulables.
export function isHairCut(id: string): boolean {
  return id.startsWith("Hair_") && !/^Hair_(Beard|Moustache|MuttonChops)/.test(id);
}

// Races du pack Fantasy Races (elles ont leurs propres cheveux) ; les autres corps sont humains.
export function isFantasyRace(race: string): boolean {
  return !race.startsWith("Human");
}
export const GENDERS: Record<string, string> = { Male: "Homme", Female: "Femme" };
export const PART_SLOTS: Record<string, string> = {
  Head: "Tête",
  Body: "Torse",
  Arms: "Bras",
  Legs: "Jambes",
  Feet: "Pieds",
  Acc: "Accessoires",
};

export const ACCESSORY_SOCKETS: Record<Socket, string> = {
  head: "Tête",
  chest: "Torse",
  neck: "Cou",
  shoulder: "Épaules",
  wrist: "Poignets",
  hip: "Hanches",
  foot: "Pieds",
  back: "Dos",
  cape: "Cape",
};

// Accessoires en paire (épaulières, gantelets, bottes…) : un fichier, la pièce droite à la racine et la gauche en
// enfant « <nom>_L ». Chacune se place à part.
export const PAIRED_SOCKETS = new Set<Socket>(["shoulder", "wrist", "foot"]);

const MONSTER = "monster:";
export function isMonster(model: string): boolean {
  return model.startsWith(MONSTER);
}
export function monsterModel(id: string): string {
  return `${MONSTER}${id}`;
}

// Fichier (dans public/dev-models/appearance/) du modèle de base.
export function modelFile(appearance: Appearance): string {
  if (isMonster(appearance.model)) return `monsters/${appearance.model.slice(MONSTER.length)}.glb`;
  return `bodies/${appearance.model}${appearance.headOnly ? "_Head" : ""}.glb`;
}

export function appearanceUrl(file: string): string {
  return `/dev-models/appearance/${file}`;
}

// Clé d'un placement : l'objet et sa place (main, côté d'une paire).
export function weaponKey(weapon: HeldWeapon): string {
  return `${weapon.item}@${weapon.slot}`;
}
export function accessoryKey(item: string, side: "r" | "l" | "c"): string {
  return `${item}@${side}`;
}

// Os de nos personnages (squelette Quaternius) où s'accroche chaque objet par défaut ; pour un monstre, l'os Mixamo
// correspondant. at : os dont la position sert de point d'accroche (sinon l'os lui-même) ; ground : posé au sol sous ce
// point (bottes).
export interface DefaultSocket {
  bone: string;
  at?: string;
  ground?: boolean;
}
export function weaponSocket(slot: WeaponSlot): DefaultSocket {
  if (slot === "back") return { bone: "spine_03" };
  return { bone: slot === "right" ? "hand_r" : "hand_l" };
}
export function accessorySocket(accessory: { id: string; socket: Socket }, side: "r" | "l" | "c"): DefaultSocket {
  const s = side === "l" ? "l" : "r";
  switch (accessory.socket) {
    case "head":
      return { bone: "Head" };
    case "chest":
      return { bone: "spine_03", at: "neck_01" };
    case "neck":
      return { bone: "neck_01" };
    case "shoulder":
      return { bone: `upperarm_${s}` };
    case "wrist":
      // Les brassards suivent l'avant-bras ; gants et gantelets, la main.
      return /Bracers|Vambraces/.test(accessory.id) ? { bone: `lowerarm_${s}`, at: `hand_${s}` } : { bone: `hand_${s}` };
    case "hip":
      return { bone: "pelvis" };
    case "foot":
      return { bone: `foot_${s}`, ground: true };
    case "back":
      return { bone: "spine_03" };
    case "cape":
      // Le haut de la cape (son point d'origine dans le pack) se pose à la base du cou, et le suit quand le buste se
      // penche.
      return { bone: "neck_01" };
  }
}

// Nom de l'os dans le modèle : le même pour un corps, son équivalent Mixamo pour un monstre.
export function boneName(model: string, bone: string): string {
  return isMonster(model) ? (UAL_TO_MIXAMO.get(bone) ?? bone) : bone;
}
