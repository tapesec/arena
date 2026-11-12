import type { SoundName } from "../audio/AudioManager";
import type { Cue } from "./codeSounds";

// Sons communs du jeu (hors compétences réglées) : voix, coups, pas, alertes, interface, musique, et leurs règles.
// Joués par GameAudio (et App pour l'interface et la musique) ; montrés en lecture seule dans l'onglet « Sons
// communs » de animation-lab.html (voir COMMON_SOUND_SECTIONS).

// Attaques au corps à corps : le geste de l'arme chez l'attaquant, puis le coup qui porte chez la cible.
export const MELEE_ABILITIES = new Set(["backstab", "flankStrike", "powerStrike", "cripplingStrike", "poisonBlade", "gangrene", "armorBreak"]);
// Le coup porte juste après le geste.
export const HIT_DELAY = 0.15;
// Un critique (et une attaque dans le dos) sonne plus grave et plus fort.
export const HEAVY_HIT: Cue = { sound: "hit", rate: 0.8, volume: 1.3 };
export const HIT: Cue = { sound: "hit" };

// Geste de l'arme, selon la classe : épée du Gardien, dagues et bâtons plus légers.
export const SWINGS: Record<string, SoundName> = {
  gardien: "swingSword",
  lame: "swingMelee",
  arcaniste: "swingHeavy",
  pretre: "swingHeavy",
  barde: "swingMelee",
};

// Voix des personnages : trois hommes, et une voix de femme différente pour l'Arcaniste et la Prêtre.
// Pas de cri de mort de femme dans les packs : leur cri de douleur, plus grave et plus fort.
export interface Voice {
  pain: SoundName;
  death: Cue;
  healed?: SoundName;
}
export const MALE: Voice = { pain: "malePain", death: { sound: "maleDeath" } };
export const VOICES: Record<string, Voice> = {
  gardien: MALE,
  lame: MALE,
  barde: MALE,
  arcaniste: { pain: "female1Pain", death: { sound: "female1Pain", rate: 0.85, volume: 1.3 }, healed: "female1Healed" },
  pretre: { pain: "female2Pain", death: { sound: "female2Pain", rate: 0.85, volume: 1.3 }, healed: "female2Healed" },
};
export const VOICE_VOLUME = 0.7;
// En 8v8, un personnage touché ne crie pas à chaque coup : au plus une fois par intervalle, et pas toujours.
export const PAIN_INTERVAL = 1.5;
export const PAIN_CHANCE = 0.5;
export const HEALED_INTERVAL = 4;

// Pas : longueur d'une foulée en course et en marche (une foulée = un bruit de pas), seuil entre les deux.
export const RUN_STRIDE = 2.5;
export const WALK_STRIDE = 1;
export const RUN_SPEED = 2.5;
export const STEP_VOLUME_SELF = 0.35;
export const STEP_VOLUME_OTHERS = 0.22;
// Les pas des autres ne s'entendent qu'à proximité.
export const STEP_RANGE = 18;

// Contrôles subis par le joueur local : alerte prioritaire.
export const CONTROL_ALERTS: Record<string, SoundName> = { mez: "mezzed", root: "rooted", stun: "hitSoftHeavy" };

// Atténuation avec la distance à la caméra : plein volume jusqu'à FULL_VOLUME_DISTANCE, puis décroissance.
export const FULL_VOLUME_DISTANCE = 12;
export const FADE_DISTANCE = 45;
export const MIN_DISTANT_VOLUME = 0.15;
// Écart horizontal (en mètres, vu de la caméra) qui donne un son entièrement à gauche ou à droite.
export const PAN_WIDTH = 25;

export const LOW_HEALTH_RATIO = 0.3;
export const HEARTBEAT_INTERVAL = 1.4;
// Seules les compétences à longue recharge signalent leur retour.
export const READY_SOUND_MIN_COOLDOWN = 20;

// Volumes de quelques sons de GameAudio.
export const SWING_VOLUME = 0.8;
// Le soupir d'un personnage soigné, sous les autres sons de sa voix.
export const HEALED_VOLUME = 0.7;

// Résultats d'un coup ou d'un sort sur la cible.
export const BLOCK_SOUND: SoundName = "bouclier_blocage_sourd";
export const EVADE_SOUND: SoundName = "evade";
export const ABSORB_SOUND: SoundName = "absorb";

// Pas selon le sol.
export const STEP_SOUNDS = { stone: "stepStone", grass: "stepGrass", dirt: "stepDirt" } satisfies Record<string, SoundName>;

// Alertes du joueur local (toujours jouées, même au-delà de la limite de sons simultanés).
export const ALERTS = {
  death: "death",
  abilityReady: "abilityReady",
  lowHealth: "lowHealth",
  countdown: "countdown",
  fightStart: "fightStart",
  win: "jingleWin",
  lose: "jingleLose",
} satisfies Record<string, SoundName>;

// Interface (App) et musiques selon la phase.
export const UI_SOUNDS = { click: "click", classSelect: "classSelect" } satisfies Record<string, SoundName>;
export const MUSIC = { menu: "woodlandFantasy", match: "lastEncounter" };
