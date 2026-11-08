import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { getAbility } from "@arena/shared";
import * as P from "./particles";
import { ParticleFactory, type Recipe } from "./particles";
import { ABILITY_FX, PROJECTILE_TRAVEL_TIME, type AbilityFx } from "./spellFx";

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
}
const VISUALS: Record<string, Visual> = {
  firebolt: { trail: [P.fireTrail, P.smokeTrail], impact: [P.fireBurst], core: 0.3 },
  freeze: { trail: [P.frostTrail], impact: [P.frostBurst], core: 0.22 },
  mez: { trail: [P.arcaneTrail], impact: [P.arcaneBurst], core: 0.2 },
  silence: { trail: [P.silenceTrail], impact: [P.silencePuff], core: 0 },
  aoeMez: { trail: [P.arcaneTrail], impact: [P.arcaneBurst], area: [P.arcaneMist], core: 0.25 },
  aoeRoot: { trail: [P.frostTrail], impact: [P.frostBurst], area: [P.frostWave, P.frostField], core: 0.25 },
  blast: { area: [P.fireWave, P.fireField] },
  heal: { ground: [P.healColumn] },
  instantHeal: { impact: [P.healFlash] },
  groupHeal: { area: [P.healField] },
};
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

  constructor(private scene: Scene) {
    this.particles = new ParticleFactory(scene);
    this.particles.prewarm(P.RECIPES);
  }

  // caster et target : les ancres des personnages (absentes si hors de vue).
  play(abilityId: string, caster: TransformNode | undefined, target: TransformNode | undefined) {
    const fx = ABILITY_FX[abilityId];
    if (!fx) return;
    const visual = VISUALS[abilityId];
    const areaRadius = fx.area ? (getAbility(abilityId)?.radius ?? 0) : 0;

    if (fx.shape === "projectile" && caster && target) {
      this.launchProjectile(fx, visual, caster, target, () => {
        if (visual) this.burst(visual, target);
        else this.spawnPulse(fx.color, target, 0.6);
        if (areaRadius) this.zone(fx, visual, target.getAbsolutePosition(), areaRadius);
      });
      return;
    }
    // Une zone centrée sur le lanceur (Déflagration, Soin de groupe) ou sur la cible.
    const anchor = target ?? caster;
    if (!anchor) return;
    if (areaRadius) this.zone(fx, visual, (caster ?? anchor).getAbsolutePosition(), areaRadius);
    if (visual) this.burst(visual, anchor);
    else if (fx.shape === "melee") this.spawnMelee(fx.color, anchor);
    else this.spawnPulse(fx.color, anchor, 1);
  }

  // Particules d'impact sur un personnage : à hauteur du corps, ou aux pieds.
  private burst(visual: Visual, anchor: TransformNode) {
    const feet = anchor.getAbsolutePosition();
    for (const recipe of visual.impact ?? []) recipe(this.particles, feet.add(new Vector3(0, BODY_CENTER, 0)));
    for (const recipe of visual.ground ?? []) recipe(this.particles, feet.clone());
  }

  // Zone d'effet : le disque de portée, et les particules qui la remplissent.
  private zone(fx: AbilityFx, visual: Visual | undefined, center: Vector3, radius: number) {
    const recipes = visual?.area ?? [];
    this.spawnArea(fx.color, center, radius, recipes.length ? AREA_ALPHA_WITH_PARTICLES : AREA_ALPHA);
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
