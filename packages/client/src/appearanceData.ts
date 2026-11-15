import catalogJson from "./appearanceCatalog.json";
import {
  PAIRED_SOCKETS,
  accessoryKey,
  accessorySocket,
  isMonster,
  weaponKey,
  weaponSocket,
  type Appearance,
  type MountedItem,
  type Socket,
} from "./game/appearance";

// Catalogue des modèles de l'éditeur d'apparence (scripts/prepare-appearance-lab.mjs), lu seulement par
// animation-lab.html : le jeu n'embarque pas cette liste.

export interface CatalogBody {
  id: string;
  race: string;
  gender: string;
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
}
export const CATALOG = catalogJson as AppearanceCatalog;

// Coiffures qui vont à un corps : son genre, et la version « Teen » pour le corps jeune.
export function hairFor(race: string, gender: string): AppearanceCatalog["hair"] {
  return CATALOG.hair.filter((h) => h.gender === gender && h.teen === (race === "HumanTeen"));
}

// Apparence affichable : coiffures qui existent et vont au corps (une apparence enregistrée avec un ancien catalogue
// peut en citer d'autres), aucune pour un monstre.
export function sanitizedAppearance(appearance: Appearance): Appearance {
  const body = CATALOG.bodies.find((b) => b.id === appearance.model);
  const valid = body ? hairFor(body.race, body.gender) : [];
  return { ...appearance, hair: appearance.hair.filter((id) => valid.some((h) => h.id === id)) };
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
