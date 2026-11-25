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
import { getAbility, revivesInArea, terrainHeight } from "@arena/shared";
import * as P from "./particles";
import { ParticleFactory, type Recipe } from "./particles";
import { oneShot, recipeById } from "./particleDefs";
import { ABILITY_FX, PROJECTILE_TRAVEL_TIME, isProjectile, setProjectileLookup, type AbilityFx } from "./spellFx";
import { AFFLICTIONS, AREA_REVIVE, BODY_CENTER, OWN_AFFLICTION, VISUALS, type CodeVisual } from "./codeVisuals";

// Moments réglés sur la page de réglage pour une compétence (par défaut, d'après animationTuning.json) : ils
// remplacent l'impact et la zone du code.
export interface TunedMoments {
  // Projectile réglé : il est joué par TargetVisuals (le code n'en dessine pas).
  projectile: boolean;
  impact: boolean;
  zone: boolean;
  zoneParticles: boolean;
}

function tunedMoments(abilityId: string): TunedMoments {
  const tuned = tuningOf(TUNING, abilityId);
  return { projectile: !!tuned?.projectile?.enabled, impact: tuned?.impact !== undefined, zone: tuned?.zone !== undefined, zoneParticles: !!tuned?.zone?.length };
}

const recipes = (ids: string[] | undefined): Recipe[] => (ids ?? []).map(recipeById);
import { StatusFx } from "./statusFx";
import { TargetVisuals } from "./targetVisuals";
import { GroundMarks, setGroundMarkDefs, type GroundMarkDef } from "./groundMarks";
import groundMarks from "./groundMarks.json";
import { Objects3D, setObjectDefs, type ObjectDef } from "./objects3d";
import objects3d from "./objects3d.json";
import { Overlays2D, setOverlayDefs, type OverlayDef } from "./overlays2d";
import overlays2d from "./overlays2d.json";
import type { Scenery } from "./abilityEffects";
import { tuningOf, zoneCenterIsTarget } from "./abilityAnimations";
import { TUNING } from "./tuning";

// Marques au sol réglées sur la page de réglage (elles remplacent celles de départ de même nom).
setGroundMarkDefs(groundMarks as unknown as Record<string, GroundMarkDef>);
setObjectDefs(objects3d as unknown as Record<string, ObjectDef>);
setOverlayDefs(overlays2d as unknown as Record<string, OverlayDef>);
// Projectile réglé (ou retiré) sur la page de réglage.
setProjectileLookup((abilityId) => tuningOf(TUNING, abilityId)?.projectile?.enabled);
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";

const SLASH_DURATION = 0.25;
const BUBBLE_POP_DURATION = 0.3;
const BEAM_DURATION = 1.4;
const BEAM_HEIGHT = 9;
// Couleurs de l'éclatement de la bulle, de l'estafilade et du rayon de lumière.
const BUBBLE_POP_COLOR = new Color3(0.75, 0.65, 1);
const SLASH_COLOR = new Color3(1, 0.95, 0.8);
const BEAM_COLOR = new Color3(1, 0.85, 0.45);
// Le disque qui montre la portée exacte d'une zone reste, plus discret quand des particules l'accompagnent.
const AREA_ALPHA = 0.45;
const AREA_ALPHA_WITH_PARTICLES = 0.22;

const PULSE_DURATION = 0.5;
const MELEE_DURATION = 0.25;
const AREA_DURATION = 0.7;
// Repère des sorts ennemis (décidé le 2026-11-21) : un liseré rouge (celui des noms ennemis) au bord de leurs zones, et
// un anneau rouge bref aux pieds de l'allié qu'un sort ennemi atteint. Les couleurs propres à chaque sort ne changent pas.
const ENEMY_MARK_COLOR = Color3.FromHexString("#ff5a52");
const ENEMY_RING_DURATION = 0.9;
const ENEMY_RING_THICKNESS = 0.12;
const ENEMY_HIT_RADIUS = 0.9;

// Un effet passager : il vit "duration" secondes et se met à jour à chaque image.
interface TransientEffect {
  mesh: Mesh;
  age: number;
  duration: number;
  // progress : de 0 (début) à 1 (fin).
  animate(progress: number): void;
  onEnd?(): void;
  // Effet interrompu avant sa fin (page de réglage relancée) : arrêter ce qui le suit encore, sans son arrivée.
  onCancel?(): void;
  // Forme de la réserve : rendue à la réserve à la fin au lieu d'être détruite.
  pool?: PooledShape;
}

// Formes des effets passagers les plus fréquents (chaque sort, chaque coup spécial) : gardées en réserve et réutilisées.
// Créer un maillage et son matériau prenait 0,5 à 1 ms à chaque fois, de quoi saccader dans les grosses mêlées.
type PooledShape = "projectile" | "pulse" | "melee" | "area" | "slash" | "beam" | "bubblePop";

interface PooledMesh {
  mesh: Mesh;
  material: StandardMaterial;
}

// Effets visuels des compétences : projectiles, impulsions, impacts, zones,
// et liens entre un Gardien et le joueur qu'il protège.
export class SpellEffects {
  private effects: TransientEffect[] = [];
  private pools = new Map<PooledShape, PooledMesh[]>();
  private guardLinks = new Map<string, LinesMesh>();
  private particles: ParticleFactory;
  // Effets qui suivent un personnage un moment (brûlure…) : leur point d'attache est recopié à chaque image.
  private attached: { system: ParticleSystem; at: Vector3; anchor: TransformNode; left: number }[] = [];
  // États qui durent (mez, stun, root, bulle), mis à jour à chaque image par le jeu.
  readonly statuses: StatusFx;
  // Impact, état et zone réglés sur la page de réglage.
  readonly targets: TargetVisuals;
  // Marques au sol des compétences réglées.
  readonly marks: GroundMarks;
  // Objets 3D des compétences réglées.
  readonly objects: Objects3D;
  // Affichage 2D (textes, symboles) des compétences réglées.
  readonly overlays: Overlays2D;

  // heightAt : hauteur du sol (le terrain de l'arène en jeu, le sol plat de la page de réglage).
  constructor(
    private scene: Scene,
    heightAt: (x: number, z: number) => number = terrainHeight,
  ) {
    this.particles = new ParticleFactory(scene);
    this.particles.prewarm(P.RECIPES);
    this.marks = new GroundMarks(scene, heightAt);
    this.objects = new Objects3D(scene);
    this.overlays = new Overlays2D(scene);
    this.statuses = new StatusFx(scene, this.particles, this.scenery);
    this.targets = new TargetVisuals(this.particles, TUNING, this.scenery);
    // Un état dont les effets sont réglés ne joue plus les particules ni les objets d'état du code.
    this.statuses.isTuned = (playerId, kind) => this.targets.hasTunedStatus(playerId, kind);
  }

  // caster et target : les ancres des personnages (absentes si hors de vue).
  // tuned : moments réglés (la page de réglage donne ceux de son brouillon).
  // mark : repère des sorts ennemis (zone d'un lanceur ennemi, sort ennemi qui atteint un allié du joueur).
  play(
    abilityId: string,
    caster: TransformNode | undefined,
    target: TransformNode | undefined,
    tuned = tunedMoments(abilityId),
    mark: { enemyZone: boolean; enemyHit: boolean } = { enemyZone: false, enemyHit: false },
  ) {
    const fx = ABILITY_FX[abilityId];
    if (!fx) return;
    const visual = VISUALS[abilityId];
    const areaRadius = fx.area ? (getAbility(abilityId)?.radius ?? 0) : 0;
    // L'anneau d'impact suit l'allié touché ; celui de la zone reste où elle a frappé.
    const markHit = (anchor: TransformNode) => {
      if (mark.enemyHit && !anchor.isDisposed()) this.spawnEnemyRing(Vector3.Zero(), ENEMY_HIT_RADIUS, anchor);
    };
    const markZone = (center: Vector3) => {
      if (mark.enemyZone && areaRadius) this.spawnEnemyRing(center, areaRadius);
    };
    // Impact et zone réglés sur la page de réglage : ils remplacent ceux du code (voir TargetVisuals).
    const ownImpact = tuned.impact;
    const zoneRecipes = tuned.zone ? [] : recipes(visual?.area);
    // Avec des effets de zone réglés, le disque de portée reste discret.
    const tunedZoneFx = tuned.zoneParticles;

    // Un sort lancé sur soi (soin) n'a pas de trajet.
    if (isProjectile(abilityId) && caster && target && caster !== target) {
      // Un projectile réglé est dessiné ailleurs : on n'attend ici que son arrivée.
      const flight = tuned.projectile ? { core: 0, trail: [] } : visual;
      this.launchProjectile(fx, flight, caster, target, () => {
        if (ownImpact) {
          // Rien de plus sur la cible.
        } else if (visual) this.burst(visual, target);
        else if (fx.shape === "melee") this.spawnMelee(fx.color, target);
        else this.spawnPulse(fx.color, target, 0.6);
        markHit(target);
        if (areaRadius) this.zone(fx, zoneRecipes, tunedZoneFx, target.getAbsolutePosition(), areaRadius);
        markZone(target.getAbsolutePosition());
      });
      return;
    }
    // Une zone centrée sur le lanceur (Déflagration, Soin de groupe) ou sur la cible.
    const anchor = target ?? caster;
    if (!anchor) return;
    // Centrée sur la cible d'un sort offensif (même sans projectile), sinon sur le lanceur.
    const center = zoneCenterIsTarget(abilityId) && target ? target : (caster ?? anchor);
    if (areaRadius) this.zone(fx, zoneRecipes, tunedZoneFx, center.getAbsolutePosition(), areaRadius);
    markZone(center.getAbsolutePosition());
    if (target && target !== caster) markHit(target);
    if (ownImpact) return;
    if (visual) this.burst(visual, anchor);
    else if (fx.shape === "melee") this.spawnMelee(fx.color, anchor);
    else this.spawnPulse(fx.color, anchor, 1);
  }

  // Allié relevé par une résurrection de zone (Intervention divine) : la pluie d'étincelles et le rayon de lumière
  // tombent sur lui, pas sur le lanceur. Un impact réglé est joué par TargetVisuals.
  revived(abilityId: string, target: TransformNode, tunedImpact = tunedMoments(abilityId).impact) {
    const ability = getAbility(abilityId);
    if (!ability || !revivesInArea(ability) || tunedImpact) return;
    this.burst(AREA_REVIVE, target);
  }

  // Dégâts magiques subis : la cible brûle (ou gèle…) un instant, selon le type du sort.
  // Un projectile n'a d'effet qu'à son arrivée.
  magicHit(abilityId: string, target: TransformNode, tunedImpact = tunedMoments(abilityId).impact) {
    const school = getAbility(abilityId)?.school;
    if (!school || OWN_AFFLICTION.has(abilityId) || tunedImpact) return;
    const affliction = AFFLICTIONS[school];
    const start = () => {
      if (target.isDisposed()) return;
      for (const recipe of recipes(affliction.recipes)) {
        const at = target.getAbsolutePosition().clone();
        const system = recipe(this.particles, at);
        if (system) this.attached.push({ system, at, anchor: target, left: affliction.duration });
      }
    };
    if (isProjectile(abilityId)) setTimeout(start, PROJECTILE_TRAVEL_TIME * 1000);
    else start();
  }

  // La bulle absorbe un coup et éclate : un anneau lumineux qui s'élargit, et des éclats irisés.
  bubblePop(anchor: TransformNode) {
    const center = anchor.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0));
    oneShot(recipeById("bubbleShards")(this.particles, center.clone()));
    const { mesh: ring, material } = this.take("bubblePop", BUBBLE_POP_COLOR, 1);
    ring.position.copyFrom(center);
    this.effects.push({
      mesh: ring,
      pool: "bubblePop",
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
  private burst(visual: CodeVisual, anchor: TransformNode) {
    const feet = anchor.getAbsolutePosition();
    const body = feet.add(new Vector3(0, BODY_CENTER, 0));
    for (const recipe of recipes(visual.impact)) oneShot(recipe(this.particles, body.clone()));
    for (const recipe of recipes(visual.ground)) oneShot(recipe(this.particles, feet.clone()));
    if (visual.slash) {
      this.spawnSlash(body);
      oneShot(recipeById("critSparks")(this.particles, body.clone(), 0.6));
    }
    if (visual.beam) this.spawnBeam(feet);
  }

  // Estafilade : croissant lumineux tourné vers la caméra, incliné au hasard, qui s'élargit et s'éteint.
  private spawnSlash(at: Vector3) {
    const { mesh, material } = this.take("slash", SLASH_COLOR, 1);
    mesh.position.copyFrom(at);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    this.effects.push({
      mesh,
      pool: "slash",
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
    const { mesh, material } = this.take("beam", BEAM_COLOR, 0);
    mesh.position.set(feet.x, feet.y + BEAM_HEIGHT / 2, feet.z);
    this.effects.push({
      mesh,
      pool: "beam",
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
        // Mis à jour sans recalculer son volume englobant : toujours dessiné (sinon éliminé hors de sa place d'origine).
        line.alwaysSelectAsActiveMesh = true;
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
        // Avant de rendre la forme : la fin d'un projectile lit encore sa position.
        effect.onEnd?.();
        this.release(effect);
        continue;
      }
      effect.animate(effect.age / effect.duration);
    }
  }

  // Marques, objets et affichages 2D : après les joueurs d'effets qui les déplacent.
  updateScenery(dt: number) {
    this.marks.update(dt);
    this.objects.update(dt);
    this.overlays.update(dt);
  }

  // Marques au sol et objets 3D, pour les joueurs d'effets.
  // Un seul objet, partagé par tous les joueurs d'effets : le jeu y branche ensuite les sons (sounds).
  private sceneryRef: Scenery | null = null;
  get scenery(): Scenery {
    this.sceneryRef ??= { marks: this.marks, objects: this.objects, overlays: this.overlays, sounds: null };
    return this.sceneryRef;
  }

  // Efface les effets passagers en cours (projectiles, impulsions, brûlures…) : la page de réglage relance sa lecture.
  clearTransient() {
    for (const effect of this.effects) {
      effect.onCancel?.();
      this.release(effect);
    }
    this.effects = [];
    for (const item of this.attached) item.system.stop();
    this.attached = [];
  }

  dispose() {
    for (const effect of this.effects) effect.mesh.dispose(false, true);
    for (const pool of this.pools.values()) for (const { mesh } of pool) mesh.dispose(false, true);
    this.pools.clear();
    for (const line of this.guardLinks.values()) line.dispose();
    this.statuses.dispose();
    this.targets.dispose();
    this.marks.dispose();
    this.objects.dispose();
    this.overlays.dispose();
    this.particles.dispose();
    this.effects = [];
    this.guardLinks.clear();
  }

  // Projectile qui suit la cible même si elle bouge pendant le vol : un cœur lumineux, et sa traînée de particules.
  private launchProjectile(fx: AbilityFx, visual: CodeVisual | undefined, caster: TransformNode, target: TransformNode, onArrive: () => void) {
    const from = caster.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0));
    const core = visual?.core ?? 0.45;
    const { mesh } = this.take("projectile", fx.color, 1);
    mesh.scaling.setAll(core);
    mesh.isVisible = core > 0;
    mesh.position.copyFrom(from);
    // Les traînées suivent la position du projectile (même vecteur) ; arrêtées à l'arrivée, elles s'éteignent seules.
    const trails = recipes(visual?.trail).map((recipe) => recipe(this.particles, mesh.position));
    const stopTrails = () => {
      for (const trail of trails) {
        if (!trail) continue;
        // L'émetteur ne doit plus suivre le projectile, qui va disparaître.
        trail.emitter = mesh.position.clone();
        trail.stop();
      }
    };
    this.effects.push({
      mesh,
      age: 0,
      duration: PROJECTILE_TRAVEL_TIME,
      pool: "projectile",
      animate: (progress) => {
        if (target.isDisposed()) return;
        const to = target.getAbsolutePosition().add(new Vector3(0, BODY_CENTER, 0));
        Vector3.LerpToRef(from, to, progress, mesh.position);
      },
      onEnd: () => {
        stopTrails();
        if (!target.isDisposed()) onArrive();
      },
      // Les traînées lisent la position de la sphère, qui repartira avec un autre projectile : elles doivent s'arrêter.
      onCancel: stopTrails,
    });
  }

  // Sphère translucide qui grossit et s'estompe autour du personnage.
  private spawnPulse(color: Color3, anchor: TransformNode, size: number) {
    const { mesh, material } = this.take("pulse", color, 0.5);
    this.effects.push({
      mesh,
      pool: "pulse",
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
    const { mesh, material } = this.take("melee", color, 0.9);
    mesh.position.copyFrom(anchor.getAbsolutePosition()).y += BODY_CENTER;
    this.effects.push({
      mesh,
      age: 0,
      duration: MELEE_DURATION,
      pool: "melee",
      animate: (progress) => {
        mesh.scaling.set(1.4 * (0.5 + progress), 0.25, 1.4 * (0.5 + progress));
        material.alpha = 0.9 * (1 - progress);
      },
    });
  }

  // Disque au sol qui s'étend jusqu'au rayon de la zone d'effet, puis s'estompe.
  private spawnArea(color: Color3, center: Vector3, radius: number, alpha = AREA_ALPHA) {
    const { mesh, material } = this.take("area", color, alpha);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(center.x, center.y + 0.06, center.z);
    this.effects.push({
      mesh,
      age: 0,
      duration: AREA_DURATION,
      pool: "area",
      animate: (progress) => {
        mesh.scaling.setAll(radius * Math.min(1, 0.3 + progress * 2));
        material.alpha = alpha * (1 - progress);
      },
    });
  }

  // Anneau rouge au sol (bord d'une zone ennemie, ou pieds d'un allié touché) qui s'estompe.
  // parent : l'ancre que l'anneau suit (center est alors relatif à elle).
  private spawnEnemyRing(center: Vector3, radius: number, parent?: TransformNode) {
    const tessellation = radius > 3 ? 48 : 24;
    const mesh = CreateTorus("enemyRing", { diameter: radius * 2, thickness: ENEMY_RING_THICKNESS, tessellation }, this.scene);
    const material = this.glowMaterial(ENEMY_MARK_COLOR, 0.95);
    mesh.material = material;
    mesh.isPickable = false;
    if (parent) mesh.parent = parent;
    mesh.position.set(center.x, center.y + 0.08, center.z);
    this.effects.push({
      mesh,
      age: 0,
      duration: ENEMY_RING_DURATION,
      animate: (progress) => {
        material.alpha = 0.95 * (1 - progress * progress);
      },
    });
  }

  // Forme de la réserve, remise à zéro (position, rotation, échelle), avec sa couleur et son opacité.
  private take(shape: PooledShape, color: Color3, alpha: number): PooledMesh {
    const item = this.pools.get(shape)?.pop() ?? this.createShape(shape);
    const { mesh, material } = item;
    mesh.position.setAll(0);
    mesh.rotation.setAll(0);
    mesh.scaling.setAll(1);
    mesh.isVisible = true;
    mesh.setEnabled(true);
    material.emissiveColor.copyFrom(color);
    material.alpha = alpha;
    return item;
  }

  // Fin d'un effet passager : sa forme retourne à la réserve (cachée), les autres sont détruites.
  private release(effect: TransientEffect) {
    if (!effect.pool) {
      effect.mesh.dispose(false, true);
      return;
    }
    effect.mesh.setEnabled(false);
    const pool = this.pools.get(effect.pool) ?? [];
    pool.push({ mesh: effect.mesh, material: effect.mesh.material as StandardMaterial });
    this.pools.set(effect.pool, pool);
  }

  // Maillage et matériau propres à une forme de la réserve, créés une fois.
  private createShape(shape: PooledShape): PooledMesh {
    let mesh: Mesh;
    switch (shape) {
      case "projectile":
      case "melee":
        mesh = CreateSphere(shape, { diameter: 1, segments: 8 }, this.scene);
        break;
      case "pulse":
        mesh = CreateSphere("pulse", { diameter: 1, segments: 12 }, this.scene);
        break;
      case "area":
        mesh = CreateDisc("area", { radius: 1, tessellation: 48 }, this.scene);
        break;
      case "slash":
        mesh = CreateRibbon("slash", { pathArray: slashPaths(), sideOrientation: Mesh.DOUBLESIDE }, this.scene);
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        break;
      case "beam":
        mesh = CreateCylinder("beam", { height: BEAM_HEIGHT, diameterTop: 1.6, diameterBottom: 1, tessellation: 24, cap: Mesh.NO_CAP }, this.scene);
        break;
      case "bubblePop":
        mesh = CreateTorus("bubblePop", { diameter: 2.4, thickness: 0.1, tessellation: 48 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.bakeCurrentTransformIntoVertices();
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        break;
    }
    const material = this.glowMaterial(new Color3(), 1);
    if (shape === "slash" || shape === "beam" || shape === "bubblePop") material.alphaMode = Constants.ALPHA_ADD;
    if (shape === "beam") material.backFaceCulling = false;
    mesh.material = material;
    mesh.isPickable = false;
    return { mesh, material };
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

// Estafilade : croissant plus épais au milieu, effilé aux deux bouts (bord extérieur, bord intérieur).
function slashPaths(): Vector3[][] {
  const outer: Vector3[] = [];
  const inner: Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const angle = -1.1 + t * 2.2;
    const thickness = 0.28 * Math.sin(Math.PI * t);
    outer.push(new Vector3(Math.sin(angle), Math.cos(angle) - 0.5, 0));
    inner.push(new Vector3(Math.sin(angle) * (1 - thickness), (Math.cos(angle) - 0.5) * (1 - thickness) - thickness * 0.5, 0));
  }
  return [outer, inner];
}
