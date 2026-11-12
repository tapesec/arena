import type { EffectKind } from "@arena/shared";
import { abilityColor, abilityIcon } from "./abilityBar";
import { EFFECT_ABILITIES, OWN } from "./effectIconMap";

// Icônes des effets pour le HUD : celle de la compétence qui pose l'effet (on la reconnaît depuis la barre d'action),
// ou une icône propre quand plusieurs compétences le posent (stun, root, snare : icons/effects/, voir SOURCES.txt).
const EFFECT_FILES = import.meta.glob<string>("./icons/effects/*.svg", { query: "?raw", import: "default", eager: true });
const OWN_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(EFFECT_FILES).map(([file, svg]) => [file.slice("./icons/effects/".length, -".svg".length), svg]),
);

export function effectIcon(kind: EffectKind): { svg: string; color: string } | null {
  const own = OWN[kind];
  if (own) {
    const svg = OWN_ICONS[own.icon];
    return svg ? { svg, color: own.color } : null;
  }
  const ability = EFFECT_ABILITIES[kind];
  const svg = ability ? abilityIcon(ability) : undefined;
  return ability && svg ? { svg, color: abilityColor(ability) } : null;
}
