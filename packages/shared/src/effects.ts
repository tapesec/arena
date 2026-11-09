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
  | "bubble"
  // Provoqué par un Gardien : moins de dégâts sur tout autre que lui.
  | "taunted"
  // Arrêt net très court (provocation) : ne bouge plus, mais peut agir.
  | "halted"
  // Cri de ralliement : immunisé aux contrôles magiques.
  | "magicImmune"
  // Rempart : le Gardien ne peut plus rien faire, son groupe proche est protégé de la mêlée.
  | "rampart"
  | "meleeImmune";

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
  taunted: { label: "Provoqué", category: "debuff" },
  halted: { label: "Arrêté", category: "control" },
  magicImmune: { label: "Immunisé magie", category: "immunity" },
  rampart: { label: "Rempart", category: "buff" },
  meleeImmune: { label: "Protégé (Rempart)", category: "buff" },
};

// Durée restante envoyée pour un effet sans limite de temps.
export const PERMANENT = -1;
