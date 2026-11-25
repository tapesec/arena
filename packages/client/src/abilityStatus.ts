import { isIncapacitated, isMagic, type AbilityDef, type GameErrorCode } from "@arena/shared";
import { abilityName, quote, t, type TextKey } from "./i18n";
import type { SelfFrame, TargetFrame } from "./store";

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
  // Explication affichée dans l'infobulle quand la compétence n'est pas utilisable (dans la langue du joueur).
  reason: string | null;
}

// Texte d'une raison de refus, envoyée par le serveur ou calculée ici ; abilityId : compétence citée (combo).
export function errorText(code: GameErrorCode, abilityId?: string): string {
  return t(`error.${code}` satisfies TextKey, { ability: abilityId ? quote(abilityName(abilityId)) : "" });
}

function refused(state: AbilityState, code: GameErrorCode, abilityId?: string): AbilityStatus {
  return { state, reason: errorText(code, abilityId) };
}

const READY: AbilityStatus = { state: "ready", reason: null };

export function abilityStatus(ability: AbilityDef, self: SelfFrame, target: TargetFrame | null): AbilityStatus {
  if (self.hp <= 0) return refused("disabled", "dead");
  if (isIncapacitated(self.effects)) {
    return refused("disabled", "incapacitated");
  }
  if (self.charging) return refused("disabled", "charging");
  if (self.rolling) return refused("disabled", "rolling");
  if (isMagic(ability) && self.effects.some((e) => e.kind === "silenced")) return refused("disabled", "silenced");
  if (ability.effects.some((e) => e.type === "charge") && self.effects.some((e) => e.kind === "root")) {
    return refused("disabled", "rooted");
  }
  if (ability.after && self.comboAbility !== ability.after) {
    return refused("combo", "combo", ability.after);
  }
  // Couper son chant ne coûte rien.
  if (self.song !== ability.id && self[ability.resource] < ability.cost) {
    return refused("unaffordable", ability.resource === "mana" ? "noMana" : "noEndurance");
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
      if (!target || !target.isAlly || target.isSelf || target.hp <= 0) return refused("noTarget", "needOtherAlly");
      return reach(ability, target);
    case "deadAlly":
      if (!target || !target.isAlly || target.hp > 0) return refused("noTarget", "needDeadAlly");
      return reach(ability, target);
    case "enemy": {
      if (!target || target.isAlly || target.hp <= 0) return refused("noTarget", "needEnemy");
      const status = reach(ability, target);
      if (status !== READY) return status;
      // Pas face à la cible : le personnage se tourne tout seul vers elle en lançant la compétence (voir le serveur).
      if (ability.position && target.position !== ability.position) {
        return refused("position", ability.position === "back" ? "needBack" : "needSide");
      }
      return READY;
    }
  }
}

function reach(ability: AbilityDef, target: TargetFrame): AbilityStatus {
  if (ability.melee || ability.meleeStrike ? !target.inMeleeRange : target.distance > ability.range) return refused("range", "outOfRange");
  if (ability.minRange && target.distance < ability.minRange) return refused("range", "tooClose");
  if (!target.inLineOfSight) return refused("range", "noLineOfSight");
  return READY;
}
