import catalogJson from "./appearanceCatalog.json";
import {
  PAIRED_SOCKETS,
  WEAPON_SLOTS,
  appearanceUrl,
  isFantasyRace,
  accessoryKey,
  accessorySocket,
  isInstrument,
  isMonster,
  playKey,
  weaponKey,
  weaponSocket,
  type Appearance,
  type ItemColors,
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
// Zone de couleur d'un objet (voir ItemColors), avec sa couleur d'origine ; pour un glTF, la plus grande surface vient
// en premier (un FBX garde l'ordre de ses matériaux).
export interface ColorZone {
  id: string;
  color: string;
}
export interface CatalogWeapon {
  id: string;
  pack: string;
  name: string;
  file: string;
  colors: ColorZone[];
}
export interface CatalogAccessory {
  id: string;
  socket: Socket;
  file: string;
  colors: ColorZone[];
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
  // Palette des objets Hearthfold : fichier, cases par côté, matériau qui l'utilise, couleur moyenne de chaque case.
  palette: { file: string; grid: number; material: string; colors: string[] };
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
  // Couleurs d'objets : seulement pour les objets portés, leurs zones connues, et des couleurs #rrggbb.
  const worn = new Set([...appearance.weapons.map((w) => w.item), ...appearance.accessories]);
  const itemColors = Object.fromEntries(
    Object.entries(appearance.itemColors ?? {})
      .filter(([item]) => worn.has(item))
      .map(([item, colors]) => {
        const zones = colorZones(item);
        return [item, Object.fromEntries(Object.entries(colors).filter(([zone, color]) => zones.some((z) => z.id === zone) && /^#[0-9a-f]{6}$/i.test(color)))];
      })
      .filter(([, colors]) => Object.keys(colors).length),
  ) as Record<string, ItemColors>;
  return {
    ...appearance,
    hair: appearance.hair.filter((id) => valid.some((h) => h.id === id)),
    // Une arme par place connue (la première) : un fichier modifié à la main peut en avoir deux, ou une place inconnue.
    weapons: appearance.weapons.filter((w, i, all) => w.slot in WEAPON_SLOTS && all.findIndex((x) => x.slot === w.slot) === i),
    outfitColors: Object.keys(outfitColors).length ? outfitColors : undefined,
    skin: race && body.skins ? variant(appearance.skin) : undefined,
    raceHairColor: race ? variant(appearance.raceHairColor) : undefined,
    itemColors: Object.keys(itemColors).length ? itemColors : undefined,
  };
}

// Zones de couleur d'une arme ou d'un accessoire (aucune s'il n'est pas au catalogue).
export function colorZones(item: string): ColorZone[] {
  return (CATALOG.weapons.find((w) => w.id === item) ?? CATALOG.accessories.find((a) => a.id === item))?.colors ?? [];
}

// Couleurs à appliquer à un objet, avec la palette Hearthfold si une de ses cases est repeinte.
function itemPaint(appearance: Appearance, item: string): Pick<MountedItem, "colors" | "palette"> {
  const colors = appearance.itemColors?.[item];
  if (!colors || !Object.keys(colors).length) return {};
  const { file, grid, material } = CATALOG.palette;
  return { colors, palette: Object.keys(colors).some((zone) => zone.startsWith("c")) ? { texture: appearanceUrl(file), grid, material } : undefined };
}

export function genderOf(model: string): string | null {
  return isMonster(model) ? null : (CATALOG.bodies.find((b) => b.id === model)?.gender ?? null);
}

// Tous les objets du modèle, avec leur clé de placement.
export function mountedItems(appearance: Appearance): MountedItem[] {
  const items: MountedItem[] = [];
  for (const weapon of appearance.weapons) {
    const def = CATALOG.weapons.find((w) => w.id === weapon.item);
    if (!def) continue;
    // Un instrument tenu deux fois n'a qu'un placement « joué » : seul le premier en joue.
    const plays = isInstrument(weapon.item) && appearance.weapons.find((w) => w.item === weapon.item) === weapon;
    items.push({
      key: weaponKey(weapon),
      file: def.file,
      socket: weaponSocket(weapon.slot),
      ...itemPaint(appearance, weapon.item),
      ...(plays ? { playKey: playKey(weapon.item) } : {}),
    });
  }
  for (const id of appearance.accessories) {
    const def = CATALOG.accessories.find((a) => a.id === id);
    if (!def) continue;
    const paint = itemPaint(appearance, id);
    if (PAIRED_SOCKETS.has(def.socket)) {
      items.push({ key: accessoryKey(id, "r"), file: def.file, socket: accessorySocket(def, "r"), part: "right", ...paint });
      items.push({ key: accessoryKey(id, "l"), file: def.file, socket: accessorySocket(def, "l"), part: "left", ...paint });
    } else items.push({ key: accessoryKey(id, "c"), file: def.file, socket: accessorySocket(def, "c"), hang: def.socket === "cape", ...paint });
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
