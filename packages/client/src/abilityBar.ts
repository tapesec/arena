import { getAbility, isMagic, type AbilityDef } from "@arena/shared";
import { ABILITY_FX } from "./game/spellFx";
import type { SelfFrame, TargetFrame } from "./store";

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

// Une compétence peut-elle partir maintenant ? Et sinon, pourquoi : la barre l'affiche d'un coup d'œil.
// - unaffordable : pas assez de mana ou d'endurance
// - range : cible hors de portée ou hors de vue
// - position : pas face à la cible, ou pas dans le dos / sur le flanc qu'exige la technique
// - noTarget : pas de cible qui convienne
// - combo : technique qui ne part que juste après une autre (son ouverture n'a pas porté au dernier coup d'arme)
// - disabled : personnage neutralisé, réduit au silence (sorts) ou mort
export type AbilityState = "ready" | "unaffordable" | "range" | "position" | "noTarget" | "combo" | "disabled";

export interface AbilityStatus {
  state: AbilityState;
  // Explication affichée dans l'infobulle quand la compétence n'est pas utilisable.
  reason: string | null;
}

const READY: AbilityStatus = { state: "ready", reason: null };

export function abilityStatus(ability: AbilityDef, self: SelfFrame, target: TargetFrame | null): AbilityStatus {
  if (self.hp <= 0) return { state: "disabled", reason: "Vous êtes mort" };
  if (self.effects.some((e) => e.kind === "mez" || e.kind === "stun" || e.kind === "rampart")) {
    return { state: "disabled", reason: "Vous êtes neutralisé" };
  }
  if (self.charging) return { state: "disabled", reason: "Charge en cours" };
  if (isMagic(ability) && self.effects.some((e) => e.kind === "silenced")) return { state: "disabled", reason: "Vous êtes réduit au silence" };
  if (ability.effects.some((e) => e.type === "charge") && self.effects.some((e) => e.kind === "root")) {
    return { state: "disabled", reason: "Impossible en étant enraciné" };
  }
  if (ability.after && self.comboAbility !== ability.after) {
    return { state: "combo", reason: `Combo : juste après « ${getAbility(ability.after)?.name ?? ability.after} »` };
  }
  if (self[ability.resource] < ability.cost) {
    return { state: "unaffordable", reason: ability.resource === "mana" ? "Pas assez de mana" : "Pas assez d'endurance" };
  }

  switch (ability.target) {
    case "self":
    case "enemiesAround":
      return READY;
    case "ally":
      // Sans allié ciblé, la compétence s'applique au lanceur.
      if (!target || !target.isAlly || target.isSelf || target.hp <= 0) return READY;
      return reach(ability, target);
    case "otherAlly":
      if (!target || !target.isAlly || target.isSelf || target.hp <= 0) return { state: "noTarget", reason: "Ciblez un autre allié" };
      return reach(ability, target);
    case "deadAlly":
      if (!target || !target.isAlly || target.hp > 0) return { state: "noTarget", reason: "Ciblez un allié mort" };
      return reach(ability, target);
    case "enemy": {
      if (!target || target.isAlly || target.hp <= 0) return { state: "noTarget", reason: "Ciblez un ennemi" };
      const status = reach(ability, target);
      if (status !== READY) return status;
      if (!target.facing) return { state: "position", reason: "Faites face à la cible" };
      if (ability.position && target.position !== ability.position) {
        return { state: "position", reason: ability.position === "back" ? "Placez-vous dans son dos" : "Placez-vous sur son flanc" };
      }
      return READY;
    }
  }
}

function reach(ability: AbilityDef, target: TargetFrame): AbilityStatus {
  if (ability.melee || ability.meleeStrike ? !target.inMeleeRange : target.distance > ability.range) return { state: "range", reason: "Cible hors de portée" };
  if (ability.minRange && target.distance < ability.minRange) return { state: "range", reason: "Cible trop proche" };
  if (!target.inLineOfSight) return { state: "range", reason: "Cible hors de vue" };
  return READY;
}

// Lignes de détail de l'infobulle : coût, temps d'incantation, portée, recharge.
export function abilityDetails(ability: AbilityDef): string[] {
  const details: string[] = [];
  if (ability.cost > 0) details.push(`${ability.cost} ${ability.resource === "mana" ? "mana" : "endurance"}`);
  details.push(ability.melee ? "Prochain coup d'arme" : ability.castTime > 0 ? `Incantation ${format(ability.castTime)} s` : "Instantané");
  if (ability.target === "self") details.push("Sur soi");
  else if (ability.target === "enemiesAround") details.push(`Autour de soi (${ability.radius} m)`);
  else if (ability.minRange) details.push(`Portée ${ability.minRange} à ${ability.range} m`);
  else details.push(ability.melee || ability.meleeStrike ? "Au contact" : `Portée ${ability.range} m`);
  if (ability.after) details.push(`Combo après « ${getAbility(ability.after)?.name ?? ability.after} »`);
  if (ability.cooldown > 0) details.push(`Recharge ${ability.cooldown >= 60 ? `${ability.cooldown / 60} min` : `${format(ability.cooldown)} s`}`);
  return details;
}

function format(value: number): string {
  return String(value).replace(".", ",");
}
