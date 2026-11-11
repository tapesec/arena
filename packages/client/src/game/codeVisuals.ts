import { RAMPART_RADIUS, getAbility, type AbilityDef } from "@arena/shared";
import { statusKindsOf, type AnimationEffect, type ProjectileVisual } from "./abilityAnimations";
import { ONE_SHOT_DURATION } from "./particleDefs";
import { objectDef } from "./objects3d";
import { overlayDef } from "./overlays2d";
import { ABILITY_SOUNDS } from "./codeSounds";
import { GAME_SOUND } from "../audio/soundEdits";
import { groundMarkDef } from "./groundMarks";
import { ABILITY_FX, PROJECTILE_TRAVEL_TIME } from "./spellFx";

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
// Hauteur des indicateurs du code (« Zzz », « !!! »), au-dessus du nom (WorldOverlay).
const INDICATOR_HEIGHT = 3.1;

// Effets d'état prévus dans le code, par type d'état (EffectKind) : effets à particules (aux pieds, au corps ou à
// la tête) et ce qui n'est pas fait de particules.
const AT = { feet: 0, body: BODY_CENTER, head: HEAD_HEIGHT };
export const STATUS_CODE: Record<
  string,
  {
    particles: { recipe: string; at: keyof typeof AT }[];
    objects?: { id: string; at: keyof typeof AT }[];
    overlays?: { id: string; height: number }[];
    // Marques au sol, au rayon donné (mètres), dans la couleur du camp.
    marks?: { id: string; radius: number }[];
    extras: string[];
  }
> = {
  mez: { particles: [{ recipe: "mezHalo", at: "head" }], overlays: [{ id: "zzz", height: INDICATOR_HEIGHT }], extras: [] },
  stun: { particles: [], overlays: [{ id: "stunStars", height: HEAD_HEIGHT + 0.1 }], extras: [] },
  // La provocation est marquée par « !!! » pendant ses premières secondes.
  taunted: { particles: [], overlays: [{ id: "tauntMarks", height: INDICATOR_HEIGHT }], extras: [] },
  nearSight: { particles: [], extras: ["deux yeux fermés au-dessus de la tête (affichage du code)"] },
  root: { particles: [{ recipe: "frostMist", at: "feet" }], objects: [{ id: "iceCrystals", at: "feet" }], extras: [] },
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
  // La zone protégée (30 m), bleue dans son camp, rouge chez l'adversaire.
  rampart: { particles: [{ recipe: "rampartFlames", at: "feet" }], marks: [{ id: "rampartWall", radius: RAMPART_RADIUS }], extras: [] },
  bubble: {
    particles: [],
    objects: [
      { id: "bubble", at: "body" },
      { id: "bubbleRim", at: "body" },
    ],
    extras: [],
  },
};

// Durée donnée à un effet du code lancé une seule fois quand il devient un effet réglé : celle que le jeu lui laisse
// (une gerbe s'arrête d'elle-même, un effet continu sans fin s'arrête après ONE_SHOT_DURATION), ou plus pour ceux
// qui émettent plus longtemps.
const ONCE = ONE_SHOT_DURATION;
const LONGER: Record<string, number> = { resurrectRain: 1.2 };

function placed(recipe: string, height: number, start: number, end: number): AnimationEffect {
  return { recipe, start, end, anchor: "feet", offset: [0, height, 0] };
}

// Objet 3D du code devenu effet réglé : sa barre couvre toute sa vie (sinon il serait coupé avant de s'effacer).
function object(id: string, height: number): AnimationEffect {
  const def = objectDef(id);
  const end = Math.max(ONCE, (def?.duration ?? 0) + (def?.fadeOut ?? 0));
  return { type: "object", ...placed(id, height, 0, end) };
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
    effects.push(object("slash", BODY_CENTER));
  }
  if (visual?.beam) effects.push(object("lightBeam", 0));
  if (!visual) {
    const shape = ABILITY_FX[abilityId]?.shape;
    // Dans la couleur de la compétence, comme dans le code.
    const tint = ABILITY_FX[abilityId]?.color.toHexString();
    if (shape === "melee") effects.push({ ...object("meleeFlash", BODY_CENTER), tint });
    else if (shape) effects.push({ ...object("pulseSphere", BODY_CENTER), tint });
  }
  // Sons d'arrivée du code, en pistes (« jeu:<son> »).
  effects.push(...codeSoundTracks(abilityId, "impact", 0));
  // Sort de dégâts : la cible brûle ou se couvre de givre un instant.
  const school = ability?.school;
  if (school && !OWN_AFFLICTION.has(abilityId) && ability.effects.some((effect) => effect.type === "damage")) {
    const affliction = AFFLICTIONS[school];
    for (const recipe of affliction.recipes) effects.push(placed(recipe, 0, 0, affliction.duration));
  }
  return { effects, extras };
}

// Projectile du code (un « bolt ») devenu réglable : en ligne droite, du milieu du corps du lanceur à la cible,
// avec son cœur lumineux (dans la couleur du sort) et ses traînées. Sans projectile dans le code : réglage
// « pas de projectile ».
export function codeProjectile(abilityId: string): ProjectileVisual {
  const fx = ABILITY_FX[abilityId];
  const visual = VISUALS[abilityId];
  const base: ProjectileVisual = {
    enabled: false,
    path: "straight",
    height: 1.5,
    turns: 2,
    speed: "constant",
    from: "feet",
    fromOffset: [0, BODY_CENTER, 0],
    to: "chest",
    align: false,
    effects: [],
  };
  if (fx?.shape !== "projectile") return base;
  const effects: AnimationEffect[] = (visual?.trail ?? []).map((recipe) => ({ recipe, start: 0, end: PROJECTILE_TRAVEL_TIME, anchor: "feet", offset: [0, 0, 0] }));
  const core = visual?.core ?? 0.45;
  if (core > 0) {
    effects.push({ type: "object", recipe: "orb", start: 0, end: PROJECTILE_TRAVEL_TIME, anchor: "feet", offset: [0, 0, 0], tint: fx.color.toHexString(), scale: core });
  }
  return { ...base, enabled: true, effects };
}

// Sons du code d'une compétence (au lancement ou à l'arrivée) en pistes de sons, à partir de l'instant at.
export function codeSoundTracks(abilityId: string, moment: "cast" | "impact", at: number): AnimationEffect[] {
  return (ABILITY_SOUNDS[abilityId]?.[moment] ?? []).map((cue) => ({
    type: "sound" as const,
    recipe: `${GAME_SOUND}${cue.sound}`,
    start: at + (cue.delay ?? 0),
    end: at + (cue.delay ?? 0) + 1,
    anchor: "feet" as const,
    offset: [0, BODY_CENTER, 0] as [number, number, number],
    ...(cue.volume !== undefined && { volume: cue.volume }),
    ...(cue.rate !== undefined && { rate: cue.rate }),
  }));
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
    for (const { id, radius } of code.marks ?? []) {
      const scale = radius / Math.max(0.1, groundMarkDef(id)?.radius ?? radius);
      effects.push({ type: "ground", ...placed(id, 0, 0, 1), untilEnd: true, teamColor: true, scale });
    }
    for (const { id, height } of code.overlays ?? []) {
      const timed = (overlayDef(id)?.duration ?? 0) > 0;
      const effect: AnimationEffect = { type: "overlay", ...placed(id, height, 0, timed ? (overlayDef(id)?.duration ?? 0) + (overlayDef(id)?.fadeOut ?? 0) : 1) };
      effects.push(timed ? effect : { ...effect, untilEnd: true });
    }
    for (const { id, at } of code.objects ?? []) {
      const timed = (objectDef(id)?.duration ?? 0) > 0;
      effects.push(timed ? object(id, AT[at]) : { ...object(id, AT[at]), untilEnd: true });
    }
    extras.push(...code.extras);
  }
  return { effects, extras };
}
