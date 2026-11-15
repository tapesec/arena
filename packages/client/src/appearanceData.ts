import catalogJson from "./appearanceCatalog.json";
import {
  PAIRED_SOCKETS,
  appearanceUrl,
  isFantasyRace,
  accessoryKey,
  accessorySocket,
  isMonster,
  weaponKey,
  weaponSocket,
  type Appearance,
  type MountedItem,
  type Recolor,
  type Socket,
} from "./game/appearance";

// Catalogue des modèles de l'éditeur d'apparence (scripts/prepare-appearance-lab.mjs), lu seulement par
// animation-lab.html : le jeu n'embarque pas cette liste.

export interface CatalogBody {
  id: string;
  race: string;
  gender: string;
  // Races : matériau de la peau et ses trois variantes de couleur (fichiers dans dev-models/appearance/).
  skinMaterial?: string;
  skins?: string[];
}
export interface CatalogPart {
  id: string;
  gender: string;
  outfit: string;
  slot: string;
}
export interface CatalogWeapon {
  id: string;
  pack: string;
  name: string;
  file: string;
}
export interface CatalogAccessory {
  id: string;
  socket: Socket;
  file: string;
}
export interface AppearanceCatalog {
  bodies: CatalogBody[];
  parts: CatalogPart[];
  // kind : coupe, ou poils du visage (cumulables avec une coupe) ; teen : version pour le corps « Teen ».
  hair: { id: string; gender: string; kind: "cut" | "facial"; teen: boolean }[];
  monsters: { id: string }[];
  weapons: CatalogWeapon[];
  accessories: CatalogAccessory[];
  // Variantes de couleur des tenues (par tenue : Knight…) et des cheveux des races.
  outfitColors: Record<string, string[]>;
  raceHairColors: string[];
}
export const CATALOG = catalogJson as AppearanceCatalog;

// Coiffures qui vont à un corps : son genre, et la version « Teen » pour le corps jeune.
export function hairFor(race: string, gender: string): AppearanceCatalog["hair"] {
  return CATALOG.hair.filter((h) => h.gender === gender && h.teen === (race === "HumanTeen"));
}

// Apparence affichable : coiffures qui existent et vont au corps (une apparence enregistrée avec un ancien catalogue
// peut en citer d'autres), aucune pour un monstre.
// Les couleurs hors de 1 à 3 (fichier modifié à la main) ou sans objet pour ce corps (peau d'un humain) sont retirées.
export function sanitizedAppearance(appearance: Appearance): Appearance {
  const body = CATALOG.bodies.find((b) => b.id === appearance.model);
  const valid = body ? hairFor(body.race, body.gender) : [];
  const variant = (n: number | undefined) => (n !== undefined && [1, 2, 3].includes(n) ? n : undefined);
  const outfits = body ? outfitsOf(appearance) : [];
  const outfitColors = Object.fromEntries(
    Object.entries(appearance.outfitColors ?? {}).filter(([outfit, color]) => outfits.includes(outfit) && variant(color.variant)),
  );
  const race = !!body && isFantasyRace(body.race);
  return {
    ...appearance,
    hair: appearance.hair.filter((id) => valid.some((h) => h.id === id)),
    outfitColors: Object.keys(outfitColors).length ? outfitColors : undefined,
    skin: race && body.skins ? variant(appearance.skin) : undefined,
    raceHairColor: race ? variant(appearance.raceHairColor) : undefined,
  };
}

export function genderOf(model: string): string | null {
  return isMonster(model) ? null : (CATALOG.bodies.find((b) => b.id === model)?.gender ?? null);
}

// Tous les objets du modèle, avec leur clé de placement.
export function mountedItems(appearance: Appearance): MountedItem[] {
  const items: MountedItem[] = [];
  for (const weapon of appearance.weapons) {
    const def = CATALOG.weapons.find((w) => w.id === weapon.item);
    if (def) items.push({ key: weaponKey(weapon), file: def.file, socket: weaponSocket(weapon.slot) });
  }
  for (const id of appearance.accessories) {
    const def = CATALOG.accessories.find((a) => a.id === id);
    if (!def) continue;
    if (PAIRED_SOCKETS.has(def.socket)) {
      items.push({ key: accessoryKey(id, "r"), file: def.file, socket: accessorySocket(def, "r"), part: "right" });
      items.push({ key: accessoryKey(id, "l"), file: def.file, socket: accessorySocket(def, "l"), part: "left" });
    } else items.push({ key: accessoryKey(id, "c"), file: def.file, socket: accessorySocket(def, "c"), hang: def.socket === "cape" });
  }
  return items;
}

// Texture de la variante de couleur d'une tenue (adresse).
export function outfitTexture(outfit: string, variant: number): string | null {
  const file = CATALOG.outfitColors[outfit]?.[variant - 1];
  return file ? appearanceUrl(file) : null;
}

// Tenues portées (Knight, Ranger…), d'après les pièces choisies.
export function outfitsOf(appearance: Appearance): string[] {
  return [...new Set(appearance.parts.map((id) => CATALOG.parts.find((p) => p.id === id)?.outfit).filter((o): o is string => !!o))];
}

// Textures de couleur à appliquer : variantes et teintes des tenues, peau et cheveux des races (la variante 1, celle des
// modèles, n'a rien à remplacer).
export function recolorsOf(appearance: Appearance): Recolor[] {
  const body = CATALOG.bodies.find((b) => b.id === appearance.model);
  if (!body) return [];
  const recolors: Recolor[] = [];
  for (const outfit of outfitsOf(appearance)) {
    const color = appearance.outfitColors?.[outfit];
    const file = CATALOG.outfitColors[outfit]?.[(color?.variant ?? 1) - 1];
    const tint = color?.tint && color.tintFrom !== undefined ? { color: color.tint, from: color.tintFrom } : undefined;
    if (color && file && (color.variant !== 1 || tint)) recolors.push({ material: `MI_${outfit}`, texture: appearanceUrl(file), tint });
  }
  const skin = appearance.skin ?? 1;
  if (body.skinMaterial && body.skins && skin !== 1) recolors.push({ material: body.skinMaterial, texture: appearanceUrl(body.skins[skin - 1]) });
  const hair = appearance.raceHairColor ?? 1;
  if (isFantasyRace(body.race) && hair !== 1) recolors.push({ material: "MI_FantasyHair", texture: appearanceUrl(CATALOG.raceHairColors[hair - 1]) });
  return recolors;
}
