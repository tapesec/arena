import { Color3 } from "@babylonjs/core/Maths/math.color";

// Couleurs par "école" de magie.
const FIRE = new Color3(1, 0.45, 0.1);
const FROST = new Color3(0.45, 0.85, 1);
const ARCANE = new Color3(0.75, 0.45, 1);
const NATURE = new Color3(0.4, 1, 0.5);
const HOLY = new Color3(1, 0.88, 0.4);
const PHYSICAL = new Color3(1, 1, 1);
const RAGE = new Color3(1, 0.2, 0.15);

// Forme de l'effet visuel :
// - projectile : une sphère lumineuse voyage du lanceur à la cible
// - pulse : une sphère qui grossit et s'estompe sur la cible (soin, buff…)
// - melee : un éclair bref à l'impact d'un coup spécial
export type FxShape = "projectile" | "pulse" | "melee";

export interface AbilityFx {
  color: Color3;
  shape: FxShape;
  // Cercle au sol à l'arrivée, du rayon de la zone d'effet de la compétence.
  area?: boolean;
}

export const ABILITY_FX: Record<string, AbilityFx> = {
  // Gardien
  guard: { color: PHYSICAL, shape: "pulse" },
  intercept: { color: PHYSICAL, shape: "pulse" },
  shieldBash: { color: HOLY, shape: "melee" },
  charge: { color: PHYSICAL, shape: "pulse" },
  chargeImpact: { color: HOLY, shape: "melee" },
  powerStrike: { color: PHYSICAL, shape: "melee" },
  taunt: { color: RAGE, shape: "pulse" },
  rallyCry: { color: HOLY, shape: "pulse", area: true },
  cripplingStrike: { color: PHYSICAL, shape: "melee" },
  rampart: { color: RAGE, shape: "pulse" },
  // Arcaniste
  firebolt: { color: FIRE, shape: "projectile" },
  blast: { color: FIRE, shape: "pulse", area: true },
  freeze: { color: FROST, shape: "projectile" },
  concentration: { color: ARCANE, shape: "pulse" },
  bubble: { color: ARCANE, shape: "pulse" },
  frostbolt: { color: FROST, shape: "projectile" },
  nearSight: { color: ARCANE, shape: "projectile" },
  burn: { color: FIRE, shape: "pulse" },
  frostNova: { color: FROST, shape: "pulse", area: true },
  arcanePower: { color: ARCANE, shape: "pulse" },
  // Prêtre
  heal: { color: NATURE, shape: "pulse" },
  groupHeal: { color: NATURE, shape: "pulse", area: true },
  instantHeal: { color: NATURE, shape: "pulse" },
  purify: { color: HOLY, shape: "pulse" },
  buffHp: { color: HOLY, shape: "pulse" },
  buffStrength: { color: HOLY, shape: "pulse" },
  resurrect: { color: HOLY, shape: "pulse" },
  renew: { color: NATURE, shape: "pulse" },
  divineIntervention: { color: HOLY, shape: "pulse", area: true },
  // Barde
  aoeMez: { color: ARCANE, shape: "projectile", area: true },
  mez: { color: ARCANE, shape: "projectile" },
  aoeRoot: { color: FROST, shape: "projectile", area: true },
  silence: { color: PHYSICAL, shape: "projectile" },
  speedSong: { color: HOLY, shape: "pulse" },
  // Lame
  backstab: { color: PHYSICAL, shape: "melee" },
  flankStrike: { color: PHYSICAL, shape: "melee" },
  evasion: { color: PHYSICAL, shape: "pulse" },
  rage: { color: RAGE, shape: "pulse" },
};

// Durée de vol d'un projectile, en secondes : les chiffres de dégâts attendent son arrivée.
export const PROJECTILE_TRAVEL_TIME = 0.3;

// Projectile réglé sur la page de réglage (true, false), sinon undefined : le jeu garde celui du code.
let tunedProjectile: (abilityId: string) => boolean | undefined = () => undefined;

export function setProjectileLookup(lookup: (abilityId: string) => boolean | undefined) {
  tunedProjectile = lookup;
}

// La compétence envoie un projectile (son effet et ses dégâts attendent son arrivée).
export function isProjectile(abilityId: string): boolean {
  return tunedProjectile(abilityId) ?? ABILITY_FX[abilityId]?.shape === "projectile";
}
