import type { SoundName } from "../audio/AudioManager";

// Sons des compétences prévus dans le code (GameAudio les joue tant qu'un moment n'a pas ses sons réglés sur la page
// de réglage, qui les convertit en pistes comme point de départ).

// Un son à jouer, avec son réglage : volume, vitesse de lecture (plus lente = plus grave) et délai en secondes.
export interface Cue {
  sound: SoundName;
  volume?: number;
  rate?: number;
  delay?: number;
}

// Sons d'une compétence : au lancement (sur le lanceur) et à l'arrivée (sur la cible).
export const ABILITY_SOUNDS: Record<string, { cast?: Cue[]; impact?: Cue[] }> = {
  firebolt: { cast: [{ sound: "spellFire" }], impact: [{ sound: "spellFire", rate: 0.8, volume: 0.9 }] },
  blast: { cast: [{ sound: "spellFire", rate: 0.7 }] },
  freeze: { impact: [{ sound: "spellIce" }] },
  mez: { impact: [{ sound: "spellFantasy2" }] },
  aoeMez: { impact: [{ sound: "spellFantasy2" }] },
  concentration: { cast: [{ sound: "spellGeneric" }] },
  frostbolt: { impact: [{ sound: "ICEBrk_Skill_Freeze_Whoosh_Break_Impact_Layered_Movement_Shatter_03" }] },
  nearSight: { impact: [{ sound: "Wind_effects_5" }] },
  burn: { impact: [{ sound: "FIREWhsh_Whoosh_Fire_Deep_Growl_Monster_Saturated_Crisp_03" }] },
  frostNova: { cast: [{ sound: "ICEBrk_Skill_Freeze_Whoosh_Break_Impact_Layered_Movement_Shatter_03", rate: 0.85 }] },
  // Pas encore de son choisi dans le tableur : un son de sort générique, plus grave.
  arcanePower: { cast: [{ sound: "spellGeneric", rate: 0.7 }, { sound: "spellFantasy3", volume: 0.7 }] },
  bubble: { cast: [{ sound: "spellFantasy1", rate: 1.3 }] },
  silence: { impact: [{ sound: "spellFantasy1" }] },
  heal: { impact: [{ sound: "Healing_Full" }] },
  groupHeal: { cast: [{ sound: "spellHeal" }] },
  instantHeal: { impact: [{ sound: "spellHeal" }] },
  buffHp: { impact: [{ sound: "spellFantasy0" }] },
  buffStrength: { impact: [{ sound: "spellFantasy0" }] },
  resurrect: { impact: [{ sound: "spellFantasy3" }] },
  renew: { impact: [{ sound: "spellHeal", volume: 0.7 }] },
  divineIntervention: { cast: [{ sound: "spellHeal" }], impact: [{ sound: "spellFantasy3" }] },
  // Barde
  awaken: { impact: [{ sound: "spellFantasy4" }] },
  speedSong: { cast: [{ sound: "song" }] },
  secondWind: { cast: [{ sound: "song", rate: 0.85 }] },
  buffDexterity: { impact: [{ sound: "spellFantasy0" }] },
  ballad: { cast: [{ sound: "song", rate: 1.2 }] },
  guard: { impact: [{ sound: "hitWood" }] },
  intercept: { impact: [{ sound: "hitWood" }] },
  shieldBash: { impact: [{ sound: "hitWoodHeavy" }, { sound: "hitSoftHeavy", volume: 0.8 }] },
  evasion: { cast: [{ sound: "evade" }] },
  rage: { cast: [{ sound: "crit" }] },
  // Gardien. Charge et Rempart : sons d'impact et de sort en attendant mieux (pas de galop ni de grondement).
  charge: { cast: [{ sound: "swingHeavy", rate: 0.8 }] },
  chargeImpact: { impact: [{ sound: "hitPlateHeavy" }, { sound: "hitSoftHeavy", volume: 0.8 }] },
  taunt: { cast: [{ sound: "provocation_face_me_coward_1" }] },
  rallyCry: { cast: [{ sound: "ralliement_hold_the_line" }] },
  rampart: { cast: [{ sound: "hitPlateHeavy", rate: 0.8 }, { sound: "spellFire", rate: 0.6, volume: 0.7 }] },
};
