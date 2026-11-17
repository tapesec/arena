import { NEAR_SIGHT_FACTOR, type ClassId, type EffectKind } from "@arena/shared";

// Noms et descriptions du contenu du jeu en anglais. En français, ils viennent directement de @arena/shared
// (la référence du GDD et du tableur) : voir content.ts.

export const CLASSES_EN: Record<ClassId, { name: string; role: string; summary: string }> = {
  gardien: { name: "Guardian", role: "Tank", summary: "Protects vulnerable allies and holds the front line." },
  arcaniste: { name: "Arcanist", role: "Magic damage", summary: "Heavy damage from range, as long as someone protects them." },
  pretre: { name: "Priest", role: "Healer", summary: "Keeps the group alive, brings the dead back and strengthens allies." },
  barde: { name: "Bard", role: "Crowd control", summary: "Neutralizes the enemy group and controls the pace of the fight." },
  lame: { name: "Blade", role: "Melee damage", summary: "Hunts down and kills fragile targets, casters first." },
};

export const EFFECTS_EN: Record<EffectKind, string> = {
  mez: "Mez",
  stun: "Stun",
  root: "Root",
  snare: "Snare",
  immuneMez: "Mez immunity",
  immuneStun: "Stun immunity",
  immuneRoot: "Root immunity",
  evasion: "Evasion",
  rage: "Rage",
  concentration: "Concentration",
  guarded: "Guarded",
  intercept: "Intercept",
  buffHp: "Health buff",
  buffStrength: "Strength buff",
  speed: "Speed",
  secondWind: "Second Wind",
  buffDexterity: "Dexterity buff",
  oblivion: "Oblivion",
  ballad: "Rhythmic Ballad",
  bubble: "Bubble",
  taunted: "Taunted",
  halted: "Halted",
  magicImmune: "Magic immunity",
  rampart: "Rampart",
  meleeImmune: "Protected (Rampart)",
  nearSight: "Nearsighted",
  burning: "Burning",
  arcanePower: "Arcane Power",
  renew: "Renew",
  silenced: "Silence",
  sprint: "Sprint",
  poisoned: "Poison",
  gangrene: "Gangrene",
  armorBroken: "Armor Broken",
};

// Une entrée par compétence de @arena/shared (un test vérifie qu'il n'en manque aucune).
export const ABILITIES_EN: Record<string, { name: string; description: string }> = {
  // --- Gardien ---
  guard: {
    name: "Guard",
    description:
      "75% chance to block melee attacks aimed at the protected ally (within 4 m), while both the ally and the Guardian stand still. Recast on the same ally to remove the protection.",
  },
  intercept: {
    name: "Intercept",
    description: "Takes the next hit aimed at an ally in their place (10 s, within 4 m).",
  },
  shieldBash: { name: "Shield Bash", description: "Stun 2 s. Melee style: fires on your next weapon swing." },
  charge: {
    name: "Charge",
    description:
      "Rush an enemy between 10 and 30 m away. On arrival: 100 damage and a 4 s stun, neither of which can be evaded or blocked, even on a stun-immune target.",
  },
  powerStrike: {
    name: "Power Strike",
    description: "100 damage instead of the normal hit, from any position. Melee style: fires on your next weapon swing.",
  },
  taunt: {
    name: "Taunt",
    description:
      "For 6 s, the target deals 50% less damage to anyone but the Guardian. It stops dead on the spot: its cast is interrupted, its attack stops and it turns to face the Guardian.",
  },
  rallyCry: {
    name: "Rallying Cry",
    description: "The Guardian and allies within 20 m are immune to magic crowd control for 6 s; active ones are removed.",
  },
  cripplingStrike: {
    name: "Crippling Strike",
    description:
      "100 damage instead of the normal hit, and a snare for 8 s. From behind the target. Melee style: fires on your next weapon swing.",
  },
  rampart: {
    name: "Rampart",
    description:
      "For 10 s, the Guardian and allies within 30 m take no melee attacks. The Guardian can't do anything else; the effect ends if they die or are mezzed or stunned.",
  },

  // --- Arcaniste ---
  firebolt: { name: "Fire Bolt", description: "Fire projectile: 250 damage." },
  blast: {
    name: "Blast",
    description: "Explosion around you, no target needed: 450 damage at the center, down to 100 at the edge, to enemies within 7 m.",
  },
  concentration: { name: "Concentration", description: "Your next spell can't be interrupted." },
  frostbolt: { name: "Frost Bolt", description: "Frost projectile: 150 damage, and slows the target by 40% for 4 s." },
  nearSight: { name: "Nearsight", description: `For 15 s, the target's spell range is reduced by ${Math.round((1 - NEAR_SIGHT_FACTOR) * 100)}%.` },
  burn: {
    name: "Burn",
    description: "The target burns: 400 damage over 10 s (40 per second). Breaks mez and root, but doesn't interrupt casting.",
  },
  frostNova: {
    name: "Frost Nova",
    description: "Roots enemies within 15 m of you for 12 s: they start moving again slowly, then at full speed. Damage frees them.",
  },
  arcanePower: { name: "Arcane Power", description: "For 15 s, all of the Arcanist's damage spells are critical hits (× 1.5)." },
  freeze: { name: "Freeze", description: "Roots the target for 10 s: it starts moving again slowly, then at full speed. Damage frees it." },
  bubble: {
    name: "Bubble",
    description: "On yourself: fully absorbs the next melee hit, effects included, then fades. Doesn't protect against spells.",
  },

  // --- Prêtre ---
  heal: { name: "Heal", description: "Restores 300 health to an ally (to yourself if no ally is targeted)." },
  instantHeal: { name: "Flash Heal", description: "Instantly restores 200 health to an ally." },
  groupHeal: {
    name: "Group Heal",
    description:
      "Restores 900 health split among allies within 30 m (Priest included), according to how much health each is missing. Overhealing is lost.",
  },
  buffHp: { name: "Health Buff", description: "+200 maximum health, until the Priest or the target dies." },
  buffStrength: { name: "Strength Buff", description: "+15% damage (melee and spells) and healing, until the Priest or the target dies." },
  resurrect: { name: "Resurrection", description: "Raises a dead ally at 50% health, without any buffs." },
  renew: {
    name: "Renew",
    description: "Restores 500 health to an ally over 10 s, one tick per second. Recasting restarts it; Renews from several Priests stack.",
  },
  divineIntervention: {
    name: "Divine Intervention",
    description: "Raises every dead ally within 30 m at 50% health, without any buffs.",
  },

  // --- Barde ---
  mez: { name: "Mesmerize", description: "Puts the target to sleep for 10 s. Damage wakes it up." },
  awaken: { name: "Awaken", description: "Removes mez from an ally (not stun)." },
  aoeMez: { name: "Mass Mesmerize", description: "Puts the target and enemies within 10 m of it to sleep for 10 s. Damage wakes them up." },
  silence: {
    name: "Oblivion",
    description: "For 10 s, the target's next spell has no effect (mana spent, cooldown started).",
  },
  speedSong: {
    name: "Song of Speed",
    description: "Toggles the song: +100% run speed for allies within 30 m. Only one song at a time.",
  },
  secondWind: {
    name: "Song of Second Wind",
    description: "Toggles the song: +50 mana and +5 endurance per second for allies within 30 m. Only one song at a time.",
  },
  buffDexterity: {
    name: "Dexterity Buff",
    description: "Melee swings and casts 15% faster, until the Bard or the target dies.",
  },
  ballad: {
    name: "Rhythmic Ballad",
    description:
      "For 10 s, all allies run 100% faster and are immune to roots and snares (active ones are removed). Each ally loses it as soon as they act.",
  },

  // --- Lame ---
  backstab: {
    name: "Backstab",
    description: "270 damage instead of the normal hit. From behind the target. Melee style: fires on your next weapon swing.",
  },
  flankStrike: {
    name: "Flank Strike",
    description:
      "190 damage instead of the normal hit, and slows by 40% for 8 s. From the target's side. Melee style: fires on your next weapon swing.",
  },
  evasion: { name: "Evasion", description: "75% chance to evade melee attacks for 8 s." },
  kick: {
    name: "Kick",
    description:
      "50 damage and a 10 s silence: the target can't cast spells, and its cast is interrupted. Instant melee attack (can be evaded or blocked).",
  },
  sprint: { name: "Sprint", description: "Doubles run speed for 10 s (doesn't stack with Song of Speed)." },
  poisonBlade: {
    name: "Poisoned Blade",
    description: "Combo, right after a Backstab that landed: 300 poison damage over 10 s. Melee style: fires on your next weapon swing.",
  },
  gangrene: {
    name: "Gangrene",
    description:
      "Combo, right after a Poisoned Blade that landed: 350 damage, and the target receives 50% less healing for 10 s. Melee style: fires on your next weapon swing.",
  },
  armorBreak: {
    name: "Armor Break",
    description:
      "Combo, right after a Flank Strike that landed: 250 damage, and the target takes 25% more melee damage for 10 s. Melee style: fires on your next weapon swing.",
  },
  rage: { name: "Rage", description: "Every hit is a critical hit for 10 s." },
};
