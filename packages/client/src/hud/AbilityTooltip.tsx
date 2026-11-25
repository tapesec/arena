// Infobulle d'une compétence (barre d'action et écran de choix de classe).
import type { AbilityDef } from "@arena/shared";
import { abilityColor, abilityDetails } from "../abilityBar";
import { abilityDescription, abilityName } from "../i18n";
import type { SelfFrame } from "../store";

// Infobulle d'une compétence : nom à la couleur de son école, coût, incantation, portée et recharge, description, et la
// raison pour laquelle elle ne part pas (barre de jeu). self : le joueur, pour les valeurs qui dépendent de lui.
// tag : mention à côté du nom (« Ultime » sur l'écran de choix).
export function AbilityTooltip({ ability, self, reason, tag }: { ability: AbilityDef; self?: SelfFrame; reason?: string | null; tag?: string }) {
  return (
    <div className="slot-tooltip">
      <div className="tooltip-name" style={{ color: abilityColor(ability.id) }}>
        {abilityName(ability.id)}
        {tag && <span className="tooltip-tag">{tag}</span>}
      </div>
      <div className="tooltip-details">{abilityDetails(ability, self).join(" · ")}</div>
      <div className="tooltip-description">{abilityDescription(ability.id)}</div>
      {reason && <div className="tooltip-reason">{reason}</div>}
    </div>
  );
}
