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

// Texture de couleur qui remplace celle d'un matériau (variante du pack), éventuellement teinte, ou palette dont des
// cases sont repeintes (voir textureTint.ts).
export interface Recolor {
  material: string;
  texture: string;
  tint?: { color: string; from: number };
  cells?: { grid: number; colors: Record<number, string> };
}

// Couleurs choisies pour une arme ou un accessoire, par zone (voir le catalogue de l'éditeur) : « m:<matériau> » pour un
// matériau entier, « c<case> » pour une case de la palette Hearthfold ; valeur : couleur CSS (#rrggbb).
export type ItemColors = Record<string, string>;

// Objet à accrocher au personnage : sa clé de placement, son fichier, son point d'accroche par défaut, et pour une
// paire la pièce gardée.
export interface MountedItem {
  key: string;
  file: string;
  socket: DefaultSocket;
  part?: "right" | "left";
  // Cape : elle pend toute seule, droite et avec un balancement (voir createCustom), au lieu de suivre l'os.
  hang?: boolean;
  // Couleurs choisies, par zone ; palette : la palette Hearthfold (pour les zones « c<case> ») et son matériau.
  colors?: ItemColors;
  palette?: { texture: string; grid: number; material: string };
  // Instrument (luth) : clé de son placement « joué », entre les mains pendant les animations de jeu (voir
  // INSTRUMENT_ANIMATIONS) ; les armes tenues en main sont cachées pendant ce temps.
  playKey?: string;
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
  // Corps d'une race (« Elf_Male »), monstre (« monster:GoblinWarrior ») ou modèle complet (« custom:Arcaniste_Tripo »).
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
  // Couleurs des armes et accessoires, par objet (identifiant du catalogue) : les deux mains, ou les deux pièces d'une
  // paire, partagent celles de leur objet.
  itemColors?: Record<string, ItemColors>;
}

// Contenu de appearances.json : deux variantes par classe (une par camp), et les placements réglés par modèle
// (corps ou monstre) puis par objet (clé de weaponKey ou accessoryKey).
export interface AppearanceFile {
  variants: Record<string, (Appearance | null)[]>;
  mounts: Record<string, Record<string, Mount>>;
}

// Personnage du jeu, construit d'après appearances.json par scripts/build-appearances.ts (gameAppearances.json) : corps
// déjà assemblé (tenue, cheveux et couleurs compris), objets à accrocher avec leurs couleurs (palette déjà repeinte) et
// placements réglés. Chemins relatifs à public/models/. appearance : seulement ce qui sert encore (modèle, objets).
export interface GameAppearance {
  appearance: Appearance;
  body: string;
  items: MountedItem[];
  mounts: Record<string, Mount>;
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

// Modèle complet, déjà habillé (généré avec Tripo), sur notre squelette (axes et noms des os Quaternius, voir
// scripts/align-tripo-skeleton.mjs) : nos animations s'y branchent par nom d'os, sans ses déplacements d'os (autres
// proportions) sauf celui du bassin. Pas de tenue ni de coiffure.
const CUSTOM = "custom:";
export const CUSTOM_MODELS: Record<string, string> = { Arcaniste_Tripo: "Arcaniste (Tripo)" };
export function isCustom(model: string): boolean {
  return model.startsWith(CUSTOM);
}
export function customModel(id: string): string {
  return `${CUSTOM}${id}`;
}

// Fichier (dans public/dev-models/appearance/) du modèle de base.
export function modelFile(appearance: Appearance): string {
  if (isMonster(appearance.model)) return `monsters/${appearance.model.slice(MONSTER.length)}.glb`;
  if (isCustom(appearance.model)) return `custom/${appearance.model.slice(CUSTOM.length)}.glb`;
  return `bodies/${appearance.model}${appearance.headOnly ? "_Head" : ""}.glb`;
}

export function appearanceUrl(file: string): string {
  return `/dev-models/appearance/${file}`;
}

// Clé d'un placement : l'objet et sa place (main, côté d'une paire).
export function weaponKey(weapon: HeldWeapon): string {
  return `${weapon.item}@${weapon.slot}`;
}
// Instruments du catalogue : le Barde en joue pendant ses chants (voir MountedItem.playKey).
export function isInstrument(item: string): boolean {
  return /(^|\/)Weapon_Lute$/.test(item);
}
// Placement d'un instrument pendant qu'on en joue : dans un repère qui suit les deux mains (voir createCustom).
export const PLAY_SLOT = "play";
// Nom de ce repère (l'éditeur le lit comme os du placement « joué »).
export const PLAY_FRAME = "mains (chant)";
export function playKey(item: string): string {
  return `${item}@${PLAY_SLOT}`;
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
