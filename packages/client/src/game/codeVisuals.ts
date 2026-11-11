import { getAbility, type AbilityDef } from "@arena/shared";
import { statusKindsOf, type AnimationEffect } from "./abilityAnimations";
import { ONE_SHOT_DURATION } from "./particleDefs";
import { ABILITY_FX } from "./spellFx";

// Visuels de compétence prévus dans le code (avant la page de réglage), décrits par le nom de leurs effets à
// particules. SpellEffects et StatusFx les jouent tant qu'un moment n'est pas réglé ; la page de réglage les montre
// et les convertit en effets réglables (codeImpact, codeStatus, codeZone) comme point de départ.

// Effets à particules par compétence : pendant le vol d'un projectile (trail), à son arrivée ou sur la cible
// (impact, à hauteur du corps ; ground, aux pieds), et sur la zone d'effet (area, avec son rayon).
// Une compétence sans entrée garde les formes simples (impulsion, éclair) de ABILITY_FX.
export interface CodeVisual {
  trail?: string[];
  impact?: string[];
  ground?: string[];
  area?: string[];
  // Projectile : diamètre du cœur lumineux (0 = particules seules).
  core?: number;
  // Estafilade lumineuse sur la cible (coups spéciaux de mêlée).
  slash?: boolean;
  // Rayon de lumière qui descend sur la cible (résurrection).
  beam?: boolean;
}
export const VISUALS: Record<string, CodeVisual> = {
  firebolt: { trail: ["fireTrail", "smokeTrail"], impact: ["fireBurst"], core: 0.3 },
  freeze: { trail: ["frostTrail"], impact: ["frostBurst"], core: 0.22 },
  frostbolt: { trail: ["frostTrail"], impact: ["frostBurst"], core: 0.22 },
  nearSight: { trail: ["arcaneTrail"], impact: ["arcaneBurst"], core: 0.15 },
  burn: { impact: ["fireBurst"] },
  frostNova: { area: ["frostWave", "frostField"] },
  mez: { trail: ["arcaneTrail"], impact: ["arcaneBurst"], core: 0.2 },
  silence: { trail: ["silenceTrail"], impact: ["silencePuff"], core: 0 },
  aoeMez: { trail: ["arcaneTrail"], impact: ["arcaneBurst"], area: ["arcaneMist"], core: 0.25 },
  aoeRoot: { trail: ["frostTrail"], impact: ["frostBurst"], area: ["frostWave", "frostField"], core: 0.25 },
  blast: { area: ["fireWave", "fireField"] },
  heal: { ground: ["healColumn"] },
  instantHeal: { impact: ["healFlash"] },
  groupHeal: { area: ["healField"] },
  backstab: { slash: true },
  powerStrike: { slash: true },
  cripplingStrike: { slash: true },
  chargeImpact: { slash: true, impact: ["critSparks"] },
  rallyCry: { area: ["rallyWave"] },
  flankStrike: { slash: true },
  buffHp: { ground: ["buffSpiral"] },
  buffStrength: { ground: ["buffSpiral"] },
  resurrect: { ground: ["resurrectRain"], beam: true },
  speedSong: { impact: ["noteBurst"] },
};

// Effet sur la cible touchée par un sort de dégâts, selon son type (AbilityDef.school) : elle brûle un instant, ou
// se couvre de givre le temps du ralentissement du Trait de givre. La Brûlure (un dot) a son effet à part, qui
// dure autant qu'elle (voir StatusFx).
type School = NonNullable<AbilityDef["school"]>;
export const AFFLICTIONS: Record<School, { recipes: string[]; duration: number }> = {
  fire: { recipes: ["burning", "burningSmoke"], duration: 1.2 },
  frost: { recipes: ["frostCoat"], duration: 4 },
};
export const OWN_AFFLICTION = new Set(["burn"]);

// Hauteur (au-dessus des pieds) du milieu du corps, où apparaissent les impacts, et de la tête des personnages.
export const BODY_CENTER = 1.1;
export const HEAD_HEIGHT = 2.35;

// Effets d'état prévus dans le code, par type d'état (EffectKind) : effets à particules (aux pieds, au corps ou à
// la tête) et ce qui n'est pas fait de particules.
const AT = { feet: 0, body: BODY_CENTER, head: HEAD_HEIGHT };
export const STATUS_CODE: Record<string, { particles: { recipe: string; at: keyof typeof AT }[]; extras: string[] }> = {
  mez: { particles: [{ recipe: "mezHalo", at: "head" }], extras: ["« Zzz » au-dessus de la tête (affichage 2D)"] },
  stun: { particles: [], extras: ["étoiles qui tournent autour de la tête (objets 3D)"] },
  root: { particles: [{ recipe: "frostMist", at: "feet" }], extras: ["cristaux de glace aux pieds, qui fondent (objets 3D)"] },
  burning: {
    particles: [
      { recipe: "burning", at: "feet" },
      { recipe: "burningSmoke", at: "feet" },
    ],
    extras: [],
  },
  rage: { particles: [{ recipe: "rageFlames", at: "feet" }], extras: [] },
  arcanePower: {
    particles: [
      { recipe: "arcaneColumn", at: "feet" },
      { recipe: "arcaneSparks", at: "feet" },
    ],
    extras: [],
  },
  magicImmune: { particles: [{ recipe: "rallyHalo", at: "head" }], extras: [] },
  rampart: { particles: [{ recipe: "rampartFlames", at: "feet" }], extras: ["zone crénelée au sol (marque au sol)"] },
  bubble: { particles: [], extras: ["bulle irisée pendant 2 s (objet 3D)"] },
};

// Durée donnée à un effet du code lancé une seule fois quand il devient un effet réglé : celle que le jeu lui laisse
// (une gerbe s'arrête d'elle-même, un effet continu sans fin s'arrête après ONE_SHOT_DURATION), ou plus pour ceux
// qui émettent plus longtemps.
const ONCE = ONE_SHOT_DURATION;
const LONGER: Record<string, number> = { resurrectRain: 1.2 };

function placed(recipe: string, height: number, start: number, end: number): AnimationEffect {
  return { recipe, start, end, anchor: "feet", offset: [0, height, 0] };
}

// Ce que le code joue sur la cible à l'impact : effets à particules, et le reste (formes lumineuses).
export function codeImpact(abilityId: string): { effects: AnimationEffect[]; extras: string[] } {
  const visual = VISUALS[abilityId];
  const ability = getAbility(abilityId);
  const effects: AnimationEffect[] = [];
  const extras: string[] = [];
  for (const recipe of visual?.impact ?? []) effects.push(placed(recipe, BODY_CENTER, 0, LONGER[recipe] ?? ONCE));
  for (const recipe of visual?.ground ?? []) effects.push(placed(recipe, 0, 0, LONGER[recipe] ?? ONCE));
  if (visual?.slash) {
    effects.push(placed("critSparks", BODY_CENTER, 0, ONCE));
    extras.push("estafilade lumineuse (objet 3D)");
  }
  if (visual?.beam) extras.push("rayon de lumière qui descend du ciel (objet 3D)");
  if (!visual) {
    const shape = ABILITY_FX[abilityId]?.shape;
    if (shape === "melee") extras.push("éclair aplati (objet 3D)");
    else if (shape) extras.push("sphère lumineuse qui grossit et s'efface (objet 3D)");
  }
  // Sort de dégâts : la cible brûle ou se couvre de givre un instant.
  const school = ability?.school;
  if (school && !OWN_AFFLICTION.has(abilityId) && ability.effects.some((effect) => effect.type === "damage")) {
    const affliction = AFFLICTIONS[school];
    for (const recipe of affliction.recipes) effects.push(placed(recipe, 0, 0, affliction.duration));
  }
  return { effects, extras };
}

// Ce que le code joue sur la zone d'effet (à la taille de la zone).
export function codeZone(abilityId: string): AnimationEffect[] {
  return (VISUALS[abilityId]?.area ?? []).map((recipe) => ({ ...placed(recipe, 0, 0, ONCE), fitZone: true }));
}

// Ce que le code montre pendant les états laissés par la compétence.
export function codeStatus(abilityId: string): { effects: AnimationEffect[]; extras: string[] } {
  const effects: AnimationEffect[] = [];
  const extras: string[] = [];
  for (const kind of statusKindsOf(abilityId)) {
    const code = STATUS_CODE[kind];
    if (!code) continue;
    for (const { recipe, at } of code.particles) effects.push({ ...placed(recipe, AT[at], 0, 1), untilEnd: true });
    extras.push(...code.extras);
  }
  return { effects, extras };
}
