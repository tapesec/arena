import { DEXTERITY_FACTOR, type AbilityDef } from "@arena/shared";
import { abilityName, formatDecimal, quote, t } from "./i18n";
import { ABILITY_FX } from "./game/spellFx";
import type { SelfFrame } from "./store";

// Icônes des compétences (game-icons.net, voir icons/SOURCES.txt), chargées à la compilation en texte SVG :
// leur couleur est celle du texte (currentColor), donnée par l'école de la compétence.
const ICON_FILES = import.meta.glob<string>("./icons/*.svg", { query: "?raw", import: "default", eager: true });
const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(ICON_FILES).map(([file, svg]) => [file.slice("./icons/".length, -".svg".length), svg]),
);

export function abilityIcon(abilityId: string): string | undefined {
  return ICONS[abilityId];
}

// Couleur d'une compétence : celle de son école dans les effets visuels (feu, givre, arcane, nature, sacré…).
export function abilityColor(abilityId: string): string {
  return ABILITY_FX[abilityId]?.color.toHexString() ?? "#ffffff";
}

// Lignes de détail de l'infobulle : coût, temps d'incantation, portée, recharge.
// self : pour le chant en cours (couper est gratuit) et le Buff dextérité (incantation plus rapide).
export function abilityDetails(ability: AbilityDef, self?: SelfFrame): string[] {
  const details: string[] = [];
  if (self?.song === ability.id) details.push(t("ability.stopSong"));
  else if (ability.cost > 0) details.push(t("ability.cost", { cost: ability.cost, resource: t(ability.resource === "mana" ? "ability.costMana" : "ability.costEndurance") }));
  const dexterity = self?.effects.some((e) => e.kind === "buffDexterity") ? DEXTERITY_FACTOR : 1;
  const castTime = Math.round(ability.castTime * dexterity * 100) / 100;
  details.push(ability.melee ? t("ability.nextSwing") : ability.castTime > 0 ? t("ability.castTime", { seconds: format(castTime) }) : t("ability.instant"));
  if (ability.target === "self") details.push(t("ability.self"));
  else if (ability.target === "enemiesAround") details.push(t("ability.around", { radius: ability.radius ?? 0 }));
  else if (ability.minRange) details.push(t("ability.rangeMinMax", { min: ability.minRange, max: ability.range }));
  else details.push(ability.melee || ability.meleeStrike ? t("ability.melee") : t("ability.range", { range: ability.range }));
  if (ability.after) details.push(t("ability.comboAfter", { ability: quote(abilityName(ability.after)) }));
  if (ability.cooldown > 0) {
    details.push(ability.cooldown >= 60 ? t("ability.cooldownMin", { minutes: ability.cooldown / 60 }) : t("ability.cooldownSec", { seconds: format(ability.cooldown) }));
  }
  return details;
}

// Nombre tel quel (sans zéros inutiles), avec la virgule décimale en français.
function format(value: number): string {
  return Number.isInteger(value) ? String(value) : formatDecimal(value, String(value).split(".")[1].length);
}
