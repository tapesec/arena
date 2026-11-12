import type { EffectKind } from "@arena/shared";

// Compétence dont l'effet reprend l'icône et la couleur ; les immunités reprennent celles du contrôle.
export const EFFECT_ABILITIES: Partial<Record<EffectKind, string>> = {
  mez: "mez",
  immuneMez: "mez",
  evasion: "evasion",
  rage: "rage",
  concentration: "concentration",
  guarded: "guard",
  intercept: "intercept",
  buffHp: "buffHp",
  buffStrength: "buffStrength",
  speed: "speedSong",
  secondWind: "secondWind",
  buffDexterity: "buffDexterity",
  oblivion: "silence",
  ballad: "ballad",
  bubble: "bubble",
  taunted: "taunt",
  halted: "taunt",
  magicImmune: "rallyCry",
  rampart: "rampart",
  meleeImmune: "rampart",
  nearSight: "nearSight",
  burning: "burn",
  arcanePower: "arcanePower",
  renew: "renew",
  silenced: "kick",
  sprint: "sprint",
  poisoned: "poisonBlade",
  gangrene: "gangrene",
  armorBroken: "armorBreak",
};

// Effets à icône propre (et couleur), sans compétence unique.
export const OWN: Partial<Record<EffectKind, { icon: string; color: string }>> = {
  stun: { icon: "stun", color: "#ffd84a" },
  immuneStun: { icon: "stun", color: "#ffd84a" },
  root: { icon: "root", color: "#7fd0ff" },
  immuneRoot: { icon: "root", color: "#7fd0ff" },
  snare: { icon: "snare", color: "#9fd27a" },
};
