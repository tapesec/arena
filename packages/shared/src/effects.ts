// Effets actifs sur un personnage, synchronisés vers les clients pour l'affichage.
export type EffectKind =
  | "mez"
  | "stun"
  | "root"
  | "snare"
  | "immuneMez"
  | "immuneStun"
  | "immuneRoot"
  | "evasion"
  | "rage"
  | "concentration"
  | "guarded"
  | "intercept"
  | "buffHp"
  | "buffStrength"
  | "speed"
  | "regenAura"
  | "bubble";

export type EffectCategory = "control" | "debuff" | "immunity" | "buff";

export const EFFECTS: Record<EffectKind, { label: string; category: EffectCategory }> = {
  mez: { label: "Mez", category: "control" },
  stun: { label: "Stun", category: "control" },
  root: { label: "Root", category: "control" },
  snare: { label: "Ralenti", category: "debuff" },
  immuneMez: { label: "Immunisé mez", category: "immunity" },
  immuneStun: { label: "Immunisé stun", category: "immunity" },
  immuneRoot: { label: "Immunisé root", category: "immunity" },
  evasion: { label: "Évasion", category: "buff" },
  rage: { label: "Rage", category: "buff" },
  concentration: { label: "Concentration", category: "buff" },
  guarded: { label: "Gardé", category: "buff" },
  intercept: { label: "Interception", category: "buff" },
  buffHp: { label: "Buff vie", category: "buff" },
  buffStrength: { label: "Buff force", category: "buff" },
  speed: { label: "Vitesse", category: "buff" },
  regenAura: { label: "Aura régén.", category: "buff" },
  bubble: { label: "Bulle", category: "buff" },
};

// Durée restante envoyée pour un effet sans limite de temps.
export const PERMANENT = -1;
