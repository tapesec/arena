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
  hair: { id: string }[];
  monsters: { id: string }[];
  weapons: CatalogWeapon[];
  accessories: CatalogAccessory[];
}
export const CATALOG = catalogJson as AppearanceCatalog;

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
    } else items.push({ key: accessoryKey(id, "c"), file: def.file, socket: accessorySocket(def, "c") });
  }
  return items;
}
