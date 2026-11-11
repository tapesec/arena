import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Constants } from "@babylonjs/core/Engines/constants";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { getAbility, type AbilityDef } from "@arena/shared";
import * as P from "./particles";
import { ParticleFactory, type Recipe } from "./particles";
import { oneShot, recipeById } from "./particleDefs";
import { ABILITY_FX, PROJECTILE_TRAVEL_TIME, type AbilityFx } from "./spellFx";
import { StatusFx } from "./statusFx";
import { TargetVisuals } from "./targetVisuals";
import { tuningOf, type AnimationTuning } from "./abilityAnimations";
import animationTuning from "./animationTuning.json";

const TUNING = animationTuning as unknown as AnimationTuning;
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";

// Effets à particules par compétence : pendant le vol d'un projectile (trail), à son arrivée ou sur la cible
// (impact, à hauteur du corps ; ground, aux pieds), et sur la zone d'effet (area, avec son rayon).
// Une compétence sans entrée garde les formes simples (impulsion, éclair) de ABILITY_FX.
interface Visual {
  trail?: Recipe[];
  impact?: Recipe[];
  ground?: Recipe[];
  area?: Recipe[];
  // Projectile : diamètre du cœur lumineux (0 = particules seules).
  core?: number;
  // Estafilade lumineuse sur la cible (coups spéciaux de mêlée).
  slash?: boolean;
  // Rayon de lumière qui descend sur la cible (résurrection).
  beam?: boolean;
}
const VISUALS: Record<string, Visual> = {
  firebolt: { trail: [P.fireTrail, P.smokeTrail], impact: [P.fireBurst], core: 0.3 },
  freeze: { trail: [P.frostTrail], impact: [P.frostBurst], core: 0.22 },
  frostbolt: { trail: [P.frostTrail], impact: [P.frostBurst], core: 0.22 },
  nearSight: { trail: [P.arcaneTrail], impact: [P.arcaneBurst], core: 0.15 },
  burn: { impact: [P.fireBurst] },
  frostNova: { area: [P.frostWave, P.frostField] },
  mez: { trail: [P.arcaneTrail], impact: [P.arcaneBurst], core: 0.2 },
  silence: { trail: [P.silenceTrail], impact: [P.silencePuff], core: 0 },
  aoeMez: { trail: [P.arcaneTrail], impact: [P.arcaneBurst], area: [P.arcaneMist], core: 0.25 },
  aoeRoot: { trail: [P.frostTrail], impact: [P.frostBurst], area: [P.frostWave, P.frostField], core: 0.25 },
  blast: { area: [P.fireWave, P.fireField] },
  heal: { ground: [recipeById("healColumn")] },
  instantHeal: { impact: [recipeById("healFlash")] },
  groupHeal: { area: [P.healField] },
  backstab: { slash: true },
  powerStrike: { slash: true },
  cripplingStrike: { slash: true },
  chargeImpact: { slash: true, impact: [recipeById("critSparks")] },
  rallyCry: { area: [P.rallyWave] },
  flankStrike: { slash: true },
  buffHp: { ground: [recipeById("buffSpiral")] },
  buffStrength: { ground: [recipeById("buffSpiral")] },
  resurrect: { ground: [recipeById("resurrectRain")], beam: true },
  speedSong: { impact: [recipeById("noteBurst")] },
};
// Effet sur la cible touchée par un sort de dégâts, selon son type (AbilityDef.school) : elle brûle un instant, ou
// se couvre de givre le temps du ralentissement du Trait de givre. La Brûlure (un dot) a son effet à part, qui
// dure autant qu'elle (voir StatusFx).
type School = NonNullable<AbilityDef["school"]>;
const AFFLICTIONS: Record<School, { recipes: Recipe[]; duration: number }> = {
  fire: { recipes: [recipeById("burning"), recipeById("burningSmoke")], duration: 1.2 },
  frost: { recipes: [recipeById("frostCoat")], duration: 4 },
};
const OWN_AFFLICTION = new Set(["burn"]);

const SLASH_DURATION = 0.25;
const BUBBLE_POP_DURATION = 0.3;
const BEAM_DURATION = 1.4;
const BEAM_HEIGHT = 9;
// Le disque qui montre la portée exacte d'une zone reste, plus discret quand des particules l'accompagnent.
const AREA_ALPHA = 0.45;
const AREA_ALPHA_WITH_PARTICLES = 0.22;

// Hauteur (au-dessus des pieds) à laquelle voyagent les projectiles et apparaissent les impulsions.
const BODY_CENTER = 1.1;
const PULSE_DURATION = 0.5;
const MELEE_DURATION = 0.25;
const AREA_DURATION = 0.7;

// Un effet passager : il vit "duration" secondes et se met à jour à chaque image.
interface TransientEffect {
  mesh: Mesh;
  age: number;
  duration: number;
  // progress : de 0 (début) à 1 (fin).
  animate(progress: number): void;
  onEnd?(): void;
}

// Effets visuels des compétences : projectiles, impulsions, impacts, zones,
// et liens entre un Gardien et le joueur qu'il protège.
export class SpellEffects {
  private effects: TransientEffect[] = [];
  private guardLinks = new Map<string, LinesMesh>();
  private particles: ParticleFactory;
  // Effets qui suivent un personnage un moment (brûlure…) : leur point d'attache est recopié à chaque image.
  private attached: { system: ParticleSystem; at: Vector3; anchor: TransformNode; left: number }[] = [];
  // États qui durent (mez, stun, root, bulle), mis à jour à chaque image par le jeu.
  readonly statuses: StatusFx;
  // Impact, état et zone réglés sur la page de réglage.
  readonly targets: TargetVisuals;

  constructor(private scene: Scene) {
    this.particles = new ParticleFactory(scene);
    this.particles.prewarm(P.RECIPES);
    this.statuses = new StatusFx(scene, this.particles);
    this.targets = new TargetVisuals(this.particles, TUNING);
  }

  // caster et target : les ancres des personnages (absentes si hors de vue).
  play(abilityId: string, caster: TransformNode | undefined, target: TransformNode | undefined) {
    const fx = ABILITY_FX[abilityId];
    if (!fx) return;
    const visual = VISUALS[abilityId];
    const areaRadius = fx.area ? (getAbility(abilityId)?.radius ?? 0) : 0;
    // Impact et zone réglés sur la page de réglage : ils remplacent ceux du code (voir TargetVisuals).
    const tuned = tuningOf(TUNING, abilityId);
    const ownImpact = tuned?.impact !== undefined;
    const zoneRecipes = tuned?.zone !== undefined ? [] : (visual?.area ?? []);
    // Avec des effets de zone réglés, le disque de portée reste discret.
    const tunedZoneFx = !!tuned?.zone?.length;

    if (fx.shape === "projectile" && caster && target) {
      this.launchProjectile(fx, visual, caster, target, () => {
        if (ownImpact) {
          // Rien de plus sur la cible.
        } else if (visual) this.burst(visual, target);
        else this.spawnPulse(fx.color, target, 0.6);
        if (areaRadius) this.zone(fx, zoneRecipes, tunedZoneFx, target.getAbsolutePosition(), areaRadius);
      });
      return;
    }
    // Une zone centrée sur le lanceur (Déflagration, Soin de groupe) ou sur la cible.
    const anchor = target ?? caster;
    if (!anchor) return;
    if (areaRadius) this.zone(fx, zoneRecipes, tunedZoneFx, (caster ?? anchor).getAbsolutePosition(), areaRadius);
    if (ownImpact) return;
    if (visual) this.burst(visual, anchor);
    else if (fx.shape === "melee") this.spawnMelee(fx.color, anchor);
    else this.spawnPulse(fx.color, anchor, 1);
  }

  // Dégâts magiques subis : la cible brûle (ou gèle…) un instant, selon le type du sort.
  // Un projectile n'a d'effet qu'à son arrivée.
  magicHit(abilityId: string, target: TransformNode) {
    const school = getAbility(abilityId)?.school;
    if (!school || OWN_AFFLICTION.has(abilityId) || tuningOf(TUNING, abilityId)?.impact !== undefined) return;
    const affliction = AFFLICTIONS[school];
    const start = () => {
      if (target.isDisposed()) return;
      for (const recipe of affliction.recipes) {
        const at = target.getAbsolutePosition().clone();
        const system = recipe(this.particles, at);
        if (system) this.attached.push({ system, at, anchor: target, left: affliction.duration });
      }
    };
    if (ABILITY_FX[abilityId]?.shape === "projectile") setTimeout(start, PROJECTILE_TRAVEL_TIME * 1000);
    else start();
  }

  // La bulle absorbe un coup et éclate : un anneau lumineux qui s'élargit, et des éclats irisés.
  bubblePop(anchor: TransformNode) {
    const center = anchor.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0));
    oneShot(recipeById("bubbleShards")(this.particles, center.clone()));
    const ring = CreateTorus("bubblePop", { diameter: 2.4, thickness: 0.1, tessellation: 48 }, this.scene);
    ring.rotation.x = Math.PI / 2;
    ring.bakeCurrentTransformIntoVertices();
    ring.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const material = this.glowMaterial(new Color3(0.75, 0.65, 1), 1);
    material.alphaMode = Constants.ALPHA_ADD;
    ring.material = material;
    ring.isPickable = false;
    ring.position.copyFrom(center);
    this.effects.push({
      mesh: ring,
      age: 0,
      duration: BUBBLE_POP_DURATION,
      animate: (progress) => {
        ring.scaling.setAll(1 + progress * 0.8);
        material.alpha = 1 - progress;
      },
    });
  }

  // Coup critique : gerbe d'étincelles dorées sur la cible.
  critHit(anchor: TransformNode) {
    oneShot(recipeById("critSparks")(this.particles, anchor.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0))));
  }

  // Particules d'impact sur un personnage : à hauteur du corps, ou aux pieds.
  private burst(visual: Visual, anchor: TransformNode) {
    const feet = anchor.getAbsolutePosition();
    const body = feet.add(new Vector3(0, BODY_CENTER, 0));
    for (const recipe of visual.impact ?? []) oneShot(recipe(this.particles, body.clone()));
    for (const recipe of visual.ground ?? []) oneShot(recipe(this.particles, feet.clone()));
    if (visual.slash) {
      this.spawnSlash(body);
      oneShot(recipeById("critSparks")(this.particles, body.clone(), 0.6));
    }
    if (visual.beam) this.spawnBeam(feet);
  }

  // Estafilade : croissant lumineux tourné vers la caméra, incliné au hasard, qui s'élargit et s'éteint.
  private spawnSlash(at: Vector3) {
    const outer: Vector3[] = [];
    const inner: Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const angle = -1.1 + t * 2.2;
      // Plus épais au milieu, effilé aux deux bouts.
      const thickness = 0.28 * Math.sin(Math.PI * t);
      outer.push(new Vector3(Math.sin(angle), Math.cos(angle) - 0.5, 0));
      inner.push(new Vector3(Math.sin(angle) * (1 - thickness), (Math.cos(angle) - 0.5) * (1 - thickness) - thickness * 0.5, 0));
    }
    const mesh = CreateRibbon("slash", { pathArray: [outer, inner], sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    const material = this.glowMaterial(new Color3(1, 0.95, 0.8), 1);
    material.alphaMode = Constants.ALPHA_ADD;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.position.copyFrom(at);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    this.effects.push({
      mesh,
      age: 0,
      duration: SLASH_DURATION,
      animate: (progress) => {
        mesh.scaling.setAll(0.8 + progress * 0.6);
        material.alpha = 1 - progress;
      },
    });
  }

  // Rayon de lumière dorée qui descend du ciel sur le personnage, puis s'estompe.
  private spawnBeam(feet: Vector3) {
    const mesh = CreateCylinder("beam", { height: BEAM_HEIGHT, diameterTop: 1.6, diameterBottom: 1, tessellation: 24, cap: Mesh.NO_CAP }, this.scene);
    const material = this.glowMaterial(new Color3(1, 0.85, 0.45), 0);
    material.alphaMode = Constants.ALPHA_ADD;
    material.backFaceCulling = false;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.position.set(feet.x, feet.y + BEAM_HEIGHT / 2, feet.z);
    this.effects.push({
      mesh,
      age: 0,
      duration: BEAM_DURATION,
      animate: (progress) => {
        // Descend du ciel pendant le premier quart, puis s'estompe.
        const drop = Math.min(1, progress * 4);
        mesh.scaling.y = drop;
        mesh.position.y = feet.y + BEAM_HEIGHT * (1 - drop / 2);
        material.alpha = 0.55 * (progress < 0.25 ? 1 : 1 - (progress - 0.25) / 0.75);
      },
    });
  }

  // Zone d'effet : le disque de portée, et les particules qui la remplissent.
  private zone(fx: AbilityFx, recipes: Recipe[], tunedParticles: boolean, center: Vector3, radius: number) {
    this.spawnArea(fx.color, center, radius, recipes.length || tunedParticles ? AREA_ALPHA_WITH_PARTICLES : AREA_ALPHA);
    for (const recipe of recipes) recipe(this.particles, center.clone(), radius);
  }

  // Trait entre chaque joueur gardé et son Gardien. links : id du protégé → [ancre du protégé, ancre du Gardien].
  updateGuardLinks(links: Map<string, [TransformNode, TransformNode]>) {
    for (const [id, mesh] of this.guardLinks) {
      if (!links.has(id)) {
        mesh.dispose();
        this.guardLinks.delete(id);
      }
    }
    for (const [id, [guarded, guardian]] of links) {
      const points = [
        guarded.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0)),
        guardian.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0)),
      ];
      const existing = this.guardLinks.get(id);
      if (existing) {
        CreateLines("guardLink", { points, instance: existing });
      } else {
        const line = CreateLines("guardLink", { points, updatable: true }, this.scene);
        line.color = new Color3(0.85, 0.9, 1);
        line.alpha = 0.6;
        line.isPickable = false;
        this.guardLinks.set(id, line);
      }
    }
  }

  update(dt: number) {
    this.particles.update();
    for (const item of [...this.attached]) {
      item.left -= dt;
      if (!item.anchor.isDisposed()) item.at.copyFrom(item.anchor.getAbsolutePosition());
      if (item.left > 0) continue;
      this.attached = this.attached.filter((a) => a !== item);
      item.system.emitter = item.at.clone();
      item.system.stop();
    }
    for (const effect of [...this.effects]) {
      effect.age += dt;
      if (effect.age >= effect.duration) {
        this.effects = this.effects.filter((e) => e !== effect);
        effect.mesh.dispose(false, true);
        effect.onEnd?.();
        continue;
      }
      effect.animate(effect.age / effect.duration);
    }
  }

  dispose() {
    for (const effect of this.effects) effect.mesh.dispose(false, true);
    for (const line of this.guardLinks.values()) line.dispose();
    this.statuses.dispose();
    this.targets.dispose();
    this.particles.dispose();
    this.effects = [];
    this.guardLinks.clear();
  }

  // Projectile qui suit la cible même si elle bouge pendant le vol : un cœur lumineux, et sa traînée de particules.
  private launchProjectile(fx: AbilityFx, visual: Visual | undefined, caster: TransformNode, target: TransformNode, onArrive: () => void) {
    const from = caster.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0));
    const mesh = CreateSphere("projectile", { diameter: visual?.core ?? 0.45, segments: 8 }, this.scene);
    mesh.material = this.glowMaterial(fx.color, 1);
    mesh.isPickable = false;
    mesh.isVisible = (visual?.core ?? 0.45) > 0;
    mesh.position.copyFrom(from);
    // Les traînées suivent la position du projectile (même vecteur) ; arrêtées à l'arrivée, elles s'éteignent seules.
    const trails = (visual?.trail ?? []).map((recipe) => recipe(this.particles, mesh.position));
    this.effects.push({
      mesh,
      age: 0,
      duration: PROJECTILE_TRAVEL_TIME,
      animate: (progress) => {
        if (target.isDisposed()) return;
        const to = target.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0));
        Vector3.LerpToRef(from, to, progress, mesh.position);
      },
      onEnd: () => {
        for (const trail of trails) {
          if (!trail) continue;
          // L'émetteur ne doit plus suivre le projectile, qui va disparaître.
          trail.emitter = mesh.position.clone();
          trail.stop();
        }
        if (!target.isDisposed()) onArrive();
      },
    });
  }

  // Sphère translucide qui grossit et s'estompe autour du personnage.
  private spawnPulse(color: Color3, anchor: TransformNode, size: number) {
    const mesh = CreateSphere("pulse", { diameter: 1, segments: 12 }, this.scene);
    const material = this.glowMaterial(color, 0.5);
    mesh.material = material;
    mesh.isPickable = false;
    this.effects.push({
      mesh,
      age: 0,
      duration: PULSE_DURATION,
      animate: (progress) => {
        if (!anchor.isDisposed()) mesh.position.copyFrom(anchor.getAbsolutePosition()).y += BODY_CENTER;
        mesh.scaling.setAll(size * (0.8 + progress * 1.6));
        material.alpha = 0.5 * (1 - progress);
      },
    });
  }

  // Éclair bref et aplati à l'impact d'un coup spécial de mêlée.
  private spawnMelee(color: Color3, anchor: TransformNode) {
    const mesh = CreateSphere("meleeHit", { diameter: 1, segments: 8 }, this.scene);
    const material = this.glowMaterial(color, 0.9);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.position.copyFrom(anchor.getAbsolutePosition()).y += BODY_CENTER;
    this.effects.push({
      mesh,
      age: 0,
      duration: MELEE_DURATION,
      animate: (progress) => {
        mesh.scaling.set(1.4 * (0.5 + progress), 0.25, 1.4 * (0.5 + progress));
        material.alpha = 0.9 * (1 - progress);
      },
    });
  }

  // Disque au sol qui s'étend jusqu'au rayon de la zone d'effet, puis s'estompe.
  private spawnArea(color: Color3, center: Vector3, radius: number, alpha = AREA_ALPHA) {
    const mesh = CreateDisc("area", { radius: 1, tessellation: 48 }, this.scene);
    const material = this.glowMaterial(color, alpha);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(center.x, center.y + 0.06, center.z);
    this.effects.push({
      mesh,
      age: 0,
      duration: AREA_DURATION,
      animate: (progress) => {
        mesh.scaling.setAll(radius * Math.min(1, 0.3 + progress * 2));
        material.alpha = alpha * (1 - progress);
      },
    });
  }

  // Matériau lumineux, insensible à l'éclairage de la scène.
  private glowMaterial(color: Color3, alpha: number): StandardMaterial {
    const material = new StandardMaterial("fx", this.scene);
    material.emissiveColor = color;
    material.diffuseColor = Color3.Black();
    material.disableLighting = true;
    material.alpha = alpha;
    return material;
  }
}
