// Catalogue des sons du jeu, générés par ZzFX (style rétro).
//
// Chaque son est une suite de notes ("steps") : un instant de départ en secondes et les paramètres ZzFX,
// dans l'ordre : volume, hasard, fréquence, attaque, maintien, relâche, forme d'onde (0 sinus, 1 triangle,
// 2 dent de scie, 3 tangente, 4 bruit), courbe, glissement, accélération du glissement, saut de hauteur,
// moment du saut, répétition, bruit, modulation, distorsion, écho, volume de maintien, déclin,
// trémolo, filtre. Un paramètre vide prend sa valeur par défaut.
// Le "hasard" fait varier légèrement chaque lecture, pour qu'un même son ne soit pas répétitif.

export type SoundCategory = "Magie" | "Mêlée" | "Soutien" | "Alertes" | "Interface et partie";

export interface SoundStep {
  at: number;
  params: (number | undefined)[];
}

export interface SoundDef {
  label: string;
  category: SoundCategory;
  steps: SoundStep[];
}

// Raccourci pour un son d'une seule note.
const one = (params: (number | undefined)[]): SoundStep[] => [{ at: 0, params }];

// Petite mélodie : une note toutes les "interval" secondes.
const melody = (frequencies: number[], interval: number, note: (number | undefined)[]): SoundStep[] =>
  frequencies.map((frequency, i) => ({ at: i * interval, params: [note[0], note[1], frequency, ...note.slice(3)] }));

// Tintement de cloche (un seul coup) : partiels inharmoniques d'une cloche (bourdon, fondamentale, tierce mineure,
// quinte, nominale, puis aigus qui s'éteignent vite) et la frappe du battant. base : hauteur de la fondamentale (Hz),
// length : multiplie la résonance.
const BELL_PARTIALS: [ratio: number, volume: number, release: number][] = [
  [0.5, 0.9, 6],
  [1, 0.7, 4.2],
  [1.19, 0.45, 3.2],
  [1.5, 0.3, 2.6],
  [2, 0.4, 2.1],
  [2.52, 0.18, 1.6],
  [3.01, 0.1, 1],
];
const bell = (base: number, length: number, volume: number): SoundStep[] => [
  ...BELL_PARTIALS.map(([ratio, amp, release]) => ({ at: 0, params: [volume * amp, 0, base * ratio, 0.005, 0, release * length, 0] })),
  { at: 0, params: [volume * 0.35, 0, base * 14, 0, 0, 0.06, 4] },
];

export const SOUNDS = {
  // --- Magie ---
  fireLaunch: {
    label: "Boule de feu : départ",
    category: "Magie",
    steps: one([1.2, 0.05, 320, 0.02, 0.06, 0.25, 4, 1.4, 8, , , , , 0.3, , , , 0.6, 0.05]),
  },
  fireImpact: {
    label: "Boule de feu : impact",
    category: "Magie",
    steps: one([1.6, 0.1, 80, 0.01, 0.08, 0.5, 4, 2, -3, , , , , 1, , 0.3, , 0.5, 0.2]),
  },
  frost: {
    label: "Gel (tintement de glace)",
    category: "Magie",
    steps: one([1, 0.05, 1500, 0.01, 0.05, 0.3, 0, 1.8, , , 500, 0.04, 0.04, , , , , 0.7, 0.05]),
  },
  arcane: {
    label: "Sort arcanique (mez)",
    category: "Magie",
    steps: one([1, 0.05, 500, 0.05, 0.2, 0.4, 0, 1, , , , , , , 8, , , 0.6, , 0.4]),
  },
  silence: {
    label: "Silence",
    category: "Magie",
    steps: one([0.8, 0.05, 1200, 0.01, 0.05, 0.15, 4, 1, -20]),
  },
  // --- Mêlée ---
  swordHit: {
    label: "Coup d'épée",
    category: "Mêlée",
    steps: one([1.2, 0.1, 600, 0, 0.01, 0.12, 2, 2.5, -40, , , , , 1.5, , , , 0.5, 0.04]),
  },
  crit: {
    label: "Coup critique",
    category: "Mêlée",
    steps: one([1.6, 0.1, 500, 0, 0.03, 0.2, 2, 3, -30, , , , , 2, , 0.2, , 0.6, 0.06]),
  },
  backstab: {
    label: "Attaque dans le dos",
    category: "Mêlée",
    steps: one([1.4, 0.1, 250, 0, 0.02, 0.18, 2, 2, -20, , , , , 2, , 0.1, , 0.5]),
  },
  block: {
    label: "Blocage au bouclier",
    category: "Mêlée",
    steps: one([1.2, 0.02, 900, 0, 0.02, 0.35, 1, 1.5, , , 300, 0.01, , , , , , 0.5, 0.1]),
  },
  shieldBash: {
    label: "Coup de bouclier (stun)",
    category: "Mêlée",
    steps: one([1.5, 0.05, 150, 0, 0.05, 0.2, 1, 2, -5, , , , , , , , , 0.6]),
  },
  evade: {
    label: "Esquive",
    category: "Mêlée",
    steps: one([0.8, 0.05, 600, 0.03, 0.05, 0.15, 4, 1, 15]),
  },
  absorb: {
    label: "Bulle qui absorbe",
    category: "Mêlée",
    steps: one([1, 0.05, 400, 0.01, 0.05, 0.2, 0, 1, 10, , , , , , , , , 0.5]),
  },
  // --- Soutien ---
  heal: {
    label: "Soin",
    category: "Soutien",
    steps: one([1, 0, 660, 0.02, 0.12, 0.35, 0, 1, , , 330, 0.08, , , , , , 0.7, 0.08]),
  },
  buff: {
    label: "Buff",
    category: "Soutien",
    steps: one([1, 0, 880, 0.02, 0.2, 0.4, 0, 1, , , 440, 0.1, 0.1, , , , , 0.6, , 0.2]),
  },
  purify: {
    label: "Purification",
    category: "Soutien",
    steps: one([1, 0, 1200, 0.01, 0.05, 0.4, 0, 1, , , , , , , , , , 0.5, 0.1]),
  },
  resurrect: {
    label: "Résurrection",
    category: "Soutien",
    steps: melody([392, 523, 659, 784], 0.12, [0.9, 0, 0, 0.02, 0.1, 0.3, 0, 1]),
  },
  song: {
    label: "Chant de vitesse",
    category: "Soutien",
    steps: melody([523, 659, 523, 784], 0.1, [0.7, 0, 0, 0.01, 0.06, 0.15, 1, 1]),
  },
  // --- Alertes (ce qui t'arrive à toi) ---
  mezzed: {
    label: "Vous êtes mezzé",
    category: "Alertes",
    steps: one([1, 0, 200, 0.05, 0.4, 0.4, 0, 1, , , , , , , 20, , , 0.6, , 0.5]),
  },
  rooted: {
    label: "Vous êtes rooté",
    category: "Alertes",
    steps: one([1, 0.05, 200, 0, 0.05, 0.25, 4, 1, , , , , , 2, , 0.4, , 0.5]),
  },
  lowHealth: {
    label: "Vie basse (battement de cœur)",
    category: "Alertes",
    steps: [
      { at: 0, params: [1.5, 0, 60, 0, 0.05, 0.1, 0, 1] },
      { at: 0.22, params: [1.1, 0, 55, 0, 0.05, 0.12, 0, 1] },
    ],
  },
  death: {
    label: "Mort",
    category: "Alertes",
    steps: one([1.2, 0, 400, 0.02, 0.2, 0.6, 1, 1, -1, , -100, 0.15, , , , , , 0.6, 0.1]),
  },
  // Annonces d'élimination (décidées le 2026-11-21) : plus grave quand c'est un allié qui tombe.
  killEnemy: {
    label: "Élimination d'un adversaire (cloche)",
    category: "Alertes",
    steps: bell(110, 1, 0.5),
  },
  killAlly: {
    label: "Élimination d'un allié (cloche)",
    category: "Alertes",
    steps: bell(82, 1, 0.5),
  },
  lastStanding: {
    label: "Dernier survivant (cloche)",
    category: "Alertes",
    steps: bell(65, 1.7, 0.55),
  },
  abilityReady: {
    label: "Compétence disponible",
    category: "Alertes",
    steps: one([0.5, 0, 1000, 0, 0.01, 0.05]),
  },
  // --- Interface et partie ---
  click: {
    label: "Clic",
    category: "Interface et partie",
    steps: one([0.6, 0, 800, 0, 0, 0.04, 1]),
  },
  classSelect: {
    label: "Choix de classe",
    category: "Interface et partie",
    steps: one([0.8, 0, 600, 0, 0.03, 0.1, 0, 1, , , 300, 0.05]),
  },
  countdown: {
    label: "Compte à rebours",
    category: "Interface et partie",
    steps: one([0.7, 0, 880, 0, 0.02, 0.08]),
  },
  fightStart: {
    label: "Début du combat",
    category: "Interface et partie",
    steps: one([1.2, 0, 220, 0.05, 0.3, 0.4, 2, 1, , , 110, 0.15, , , , , , 0.7, 0.1]),
  },
  victory: {
    label: "Victoire",
    category: "Interface et partie",
    steps: melody([523, 659, 784, 1047], 0.15, [1, 0, 0, 0.02, 0.12, 0.3, 1, 1]),
  },
  defeat: {
    label: "Défaite",
    category: "Interface et partie",
    steps: melody([392, 349, 311, 262], 0.22, [1, 0, 0, 0.02, 0.15, 0.4, 1, 1]),
  },
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
