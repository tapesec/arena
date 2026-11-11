import { StrictMode, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Scene } from "@babylonjs/core/scene";
import { CLASS_LIST, CLASSES, EFFECTS, getAbility, type ClassId, type EffectKind } from "@arena/shared";
import {
  MAX_RATE,
  MIN_RATE,
  castTimeOf,
  clampAbilityAnimation,
  clampMomentEffects,
  effectsOf,
  momentLength,
  statusDurationOf,
  statusKindsOf,
  targetsSelf,
  zoneCenterIsTarget,
  shiftEffect,
  releaseTime,
  suggestedAbilityAnimation,
  type AbilityAnimation,
  type AnimationEffect,
  type AnimationTuning,
  type EffectAnchor,
  type EffectKey,
  type ClassAnimationTuning,
  type TargetReaction,
} from "./game/abilityAnimations";
import { CharacterAnimator, framesPerSecond, type AnimationInput } from "./game/CharacterAnimator";
import { ABILITY_FX, PROJECTILE_TRAVEL_TIME, isProjectile } from "./game/spellFx";
import { SpellEffects } from "./game/SpellEffects";
import { codeImpact, codeStatus, codeZone } from "./game/codeVisuals";
import type { PlayerVisual } from "./game/PlayerVisual";
import { CharacterAssets, type CharacterAnimationSet, type CharacterInstance } from "./game/characterAssets";
import { AbilityEffectPlayer, EFFECT_ANCHORS, effectPosition, type EffectTrack } from "./game/abilityEffects";
import {
  BUILTIN_DEFS,
  CODE_RECIPES,
  DEFAULT_DEF,
  createFromDef,
  particleEffectChoices,
  particleEffectLabel,
  setParticleEffectDefs,
  type ParticleEffectDef,
} from "./game/particleDefs";
import { EffectEditor, EffectList, RequestsPanel, newEffectDef, type EffectStatus, type ParticleRequest } from "./particleLab";
import { ParticleFactory, type Recipe } from "./game/particles";
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import catalog from "./animationCatalog.json";
import "./styles.css";

// Page de réglage des animations de compétence (http://localhost:5173/animation-lab.html), en développement
// seulement. Pour chaque compétence d'une classe : l'animation, la portion jouée et la vitesse, sur une timeline.
// Les réglages sont gardés en brouillon dans le navigateur, puis enregistrés dans src/game/animationTuning.json,
// que le jeu lit (voir AbilityAnimation pour leur sens).

const LIBRARIES = ["/dev-models/animations/UAL1.glb", "/dev-models/animations/UAL2.glb"];
const DRAFT_KEY = "arena.animationLab.draft2";
const SELECTION_KEY = "arena.animationLab.selection";
const FX_DRAFT_KEY = "arena.animationLab.fxDraft2";
type ParticleDefs = Record<string, ParticleEffectDef>;
// Pause dans la pose normale entre deux lectures « comme en jeu ».
const IDLE_PAUSE = 0.8;
// Pas de la timeline : une image d'animation à 60 images/s.
const SNAP = 1 / 60;

const IN_GAME = new Set((catalog as { name: string; inGame: boolean }[]).filter((a) => a.inGame).map((a) => a.name));

interface FrameInfo {
  // Position de lecture (secondes) dans l'animation du lanceur, ou depuis le début du moment réglé ; null si rien
  // ne joue.
  playhead: number | null;
  // Progression de l'incantation simulée (0 à 1), null hors incantation.
  cast: number | null;
  // Onglet des effets, en comparaison : position à l'écran (pixels CSS) des étiquettes des deux versions.
  labels?: { x: number; y: number; text: string }[];
  // Moment de l'impact : position dans l'animation de réaction de la cible (secondes), null hors réaction.
  reactionHead?: number | null;
}

// Moments d'une compétence réglés sur la page : le geste du lanceur, puis ce que subit la cible (impact, état) et
// la zone d'effet.
type Moment = "caster" | "impact" | "status" | "zone";

// Disque de portée d'une zone dans le jeu (SpellEffects.spawnArea) : durée de son expansion et transparence
// (seul, ou avec des particules).
const AREA_DURATION = 0.7;
const AREA_ALPHA = 0.45;
const AREA_ALPHA_WITH_PARTICLES = 0.22;

class Stage {
  private engine: Engine;
  private scene: Scene;
  private assets: CharacterAssets;
  private holder: TransformNode;
  private fx: ParticleFactory;
  private instance: CharacterInstance | null = null;
  private animator: CharacterAnimator | null = null;
  private build = 0;
  // Réglage montré, partagé avec l'animateur (le même objet est modifié à chaque changement).
  private tuning: ClassAnimationTuning = {};
  private abilityId = "";
  private entry: AbilityAnimation | null = null;
  private mode: "play" | "scrub" = "scrub";
  // Instant montré en pose figée, pour chaque moment (secondes dans l'animation du lanceur, ou depuis l'impact,
  // le début de l'état, l'apparition de la zone).
  private scrubTimes: Record<Moment, number> = { caster: 0, impact: 0, status: 0, zone: 0 };
  private moment: Moment = "caster";
  private cycle: { phase: "idle" | "cast" | "after"; time: number } = { phase: "idle", time: 0 };
  // Animation figée pour la pose montrée (sans fondu), tant qu'on ne relance pas la lecture.
  private frozen: AnimationGroup | null = null;
  private effects: AbilityEffectPlayer;
  // Cible : mannequin face au lanceur, à distance réglable (le lanceur lui-même pour une compétence sur soi).
  private targetHolder: TransformNode;
  private target: CharacterInstance | null = null;
  private targetAnimator: CharacterAnimator | null = null;
  private targetBuild = 0;
  private targetFrozen: AnimationGroup | null = null;
  private targetFx: AbilityEffectPlayer;
  private zoneFx: AbilityEffectPlayer;
  private statusShown = 4;
  // Lecture comme en jeu : temps depuis le départ du sort, et réaction de la cible déjà lancée.
  private sequence: { time: number; reacted: boolean } | null = null;
  // Visuels du code (projectile, impact, zone, état) joués comme en jeu pour les moments pas encore réglés.
  private codeFx: SpellEffects;
  // Mannequin vu par les visuels d'état du code (ce que StatusFx lit d'un joueur).
  private codeDummy = {
    sessionId: CODE_DUMMY,
    isAlive: true,
    root: null as TransformNode | null,
    character: null as CharacterInstance | null,
    state: { effects: [] as { kind: string; remaining: number; source: string }[], castAbility: "", songActive: false, charging: false, team: 1 },
    hasEffect: (_kind: string) => false,
    playingAbility: () => null,
    handsPosition: () => false,
  };
  private zoneDisc: Mesh;
  private zoneMaterial: StandardMaterial;
  // Onglet des effets à particules : effet réglé (et version du code à comparer, à droite du personnage), joué en
  // boucle sur le personnage au repos.
  private fxPreview: { def: ParticleEffectDef; anchor: EffectAnchor; compare: Recipe | null; key: string } | null = null;
  private fxRuns: { system: ParticleSystem | null; at: Vector3; created: number; compare: boolean }[] = [];
  private clock = 0;
  private camera: ArcRotateCamera;
  onFrame: ((info: FrameInfo) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.09, 0.1, 0.13, 1);
    new HemisphericLight("sky", new Vector3(0, 1, 0.3), this.scene).intensity = 0.9;
    const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.6), this.scene);
    sun.intensity = 1.6;
    // Trois-quarts face (le personnage regarde vers +z) ; la souris tourne autour, la molette rapproche.
    const camera = new ArcRotateCamera("camera", Math.PI / 3, 1.25, 5.5, new Vector3(0, 1.1, 0), this.scene);
    this.camera = camera;
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 60;
    camera.wheelPrecision = 40;
    camera.attachControl(canvas, true);
    const floor = CreateDisc("floor", { radius: 40, tessellation: 96 }, this.scene);
    floor.rotation.x = Math.PI / 2;
    const material = new StandardMaterial("floor", this.scene);
    material.diffuseColor = new Color3(0.15, 0.16, 0.19);
    material.specularColor = Color3.Black();
    floor.material = material;
    this.holder = new TransformNode("holder", this.scene);
    // La cible regarde le lanceur.
    this.targetHolder = new TransformNode("targetHolder", this.scene);
    this.targetHolder.rotation.y = Math.PI;
    this.targetHolder.position.z = 6;
    this.assets = new CharacterAssets(this.scene, LIBRARIES);
    this.fx = new ParticleFactory(this.scene);
    this.effects = new AbilityEffectPlayer(this.fx);
    this.targetFx = new AbilityEffectPlayer(this.fx);
    this.zoneFx = new AbilityEffectPlayer(this.fx);
    this.codeFx = new SpellEffects(this.scene);
    // Un état réglé dans le brouillon remplace les particules d'état du code.
    this.codeFx.statuses.isTuned = () => this.entry?.status !== undefined;
    this.zoneDisc = CreateDisc("zone", { radius: 1, tessellation: 64 }, this.scene);
    this.zoneDisc.rotation.x = Math.PI / 2;
    this.zoneMaterial = new StandardMaterial("zone", this.scene);
    this.zoneMaterial.disableLighting = true;
    this.zoneMaterial.emissiveColor = new Color3(0.5, 0.7, 1);
    this.zoneMaterial.alpha = AREA_ALPHA;
    this.zoneDisc.material = this.zoneMaterial;
    this.zoneDisc.isVisible = false;
    this.scene.onBeforeRenderObservable.add(() => this.tick(Math.min(this.engine.getDeltaTime() / 1000, 0.1)));
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", this.resize);
  }

  private resize = () => this.engine.resize();

  async load(classId: string): Promise<CharacterInstance | null> {
    const build = ++this.build;
    this.effects.stopAll();
    this.targetFx.stopAll();
    this.stopFx();
    this.resetRuns();
    this.animator = null;
    this.frozen = null;
    this.instance?.dispose();
    this.instance = null;
    const instance = await this.assets.create(classId, this.holder);
    if (build !== this.build) {
      instance?.dispose();
      return null;
    }
    if (!instance) return null;
    instance.setTeam(0);
    this.instance = instance;
    this.restart();
    return instance;
  }

  // Mannequin cible, de la classe choisie, dans l'autre camp.
  async loadTarget(classId: string): Promise<void> {
    const build = ++this.targetBuild;
    this.targetFx.stopAll();
    this.targetAnimator = null;
    this.targetFrozen = null;
    this.target?.dispose();
    this.target = null;
    const instance = await this.assets.create(classId, this.targetHolder);
    if (build !== this.targetBuild) {
      instance?.dispose();
      return;
    }
    if (!instance) return;
    instance.setTeam(1);
    this.target = instance;
    this.targetAnimator = new CharacterAnimator(instance.animations, instance.set, {});
    this.updateTargetVisibility();
    if (this.mode === "scrub") this.showFrame();
  }

  setDistance(distance: number) {
    this.targetHolder.position.z = distance;
    if (this.moment !== "caster") this.frameMoment();
  }

  setStatusShown(seconds: number) {
    this.statusShown = seconds;
  }

  setMoment(moment: Moment) {
    if (moment === this.moment) return;
    this.moment = moment;
    this.frameMoment();
    if (this.mode === "scrub") this.showFrame();
  }

  // Durée d'une animation, en secondes.
  clipLength(name: string): number {
    const group = this.instance?.animations.get(name);
    return group ? (group.to - group.from) / framesPerSecond(group) : 0;
  }

  select(abilityId: string, entry: AbilityAnimation | null) {
    const changed = abilityId !== this.abilityId || entry?.animation !== this.entry?.animation;
    const switched = abilityId !== this.abilityId;
    this.abilityId = abilityId;
    this.entry = entry;
    for (const key of Object.keys(this.tuning)) delete this.tuning[key];
    if (entry) this.tuning[abilityId] = entry;
    if (switched) {
      this.updateTargetVisibility();
      this.frameMoment();
    }
    if (this.mode === "scrub") this.showFrame();
    else if (changed) this.restart();
  }

  // Lecture comme en jeu : pose normale, incantation, départ du sort, impact, état, puis on recommence.
  play() {
    this.mode = "play";
    this.restart();
  }

  // Pose figée à un instant du moment réglé.
  scrub(time: number) {
    this.mode = "scrub";
    this.scrubTimes[this.moment] = time;
    this.showFrame();
  }

  get playing(): boolean {
    return this.mode === "play";
  }

  previewEffect(def: ParticleEffectDef | null, anchor: EffectAnchor, compare: Recipe | null) {
    const key = def ? `${JSON.stringify(def)}|${anchor}|${compare ? 1 : 0}` : "";
    if (key === (this.fxPreview?.key ?? "")) return;
    const switched = !!def !== !!this.fxPreview;
    this.stopFx();
    this.fxPreview = def ? { def, anchor, compare, key } : null;
    this.resetRuns();
    this.updateTargetVisibility();
    // Changement d'onglet : pose normale animée, ou retour à la pose figée de l'animation.
    if (switched) {
      this.frameMoment();
      this.restart();
    }
  }

  // Personnage qui subit la compétence : le mannequin, ou le lanceur pour une compétence sur soi.
  private targetCharacter(): CharacterInstance | null {
    return targetsSelf(this.abilityId) ? this.instance : this.target;
  }

  private updateTargetVisibility() {
    this.targetHolder.setEnabled(!this.fxPreview && !targetsSelf(this.abilityId));
  }

  // Centre de la zone d'effet : la cible d'un sort offensif, sinon le lanceur.
  private zoneCenter(out: Vector3): Vector3 {
    return zoneCenterIsTarget(this.abilityId) ? out.set(0, 0, this.targetHolder.position.z) : out.set(0, 0, 0);
  }

  // Caméra tournée vers ce que règle le moment : le lanceur, la cible ou toute la zone.
  private frameMoment() {
    const moment = this.fxPreview ? "caster" : this.moment;
    if (moment === "zone") {
      const radius = getAbility(this.abilityId)?.radius ?? 5;
      this.camera.setTarget(this.zoneCenter(new Vector3()).addInPlace(new Vector3(0, 1, 0)));
      this.camera.radius = Math.max(8, radius * 2.2);
    } else if (moment === "caster" || targetsSelf(this.abilityId)) {
      this.camera.setTarget(new Vector3(0, 1.1, 0));
      this.camera.radius = 5.5;
    } else {
      this.camera.setTarget(new Vector3(0, 1.1, this.targetHolder.position.z));
      this.camera.radius = 5.5;
    }
  }

  private resetRuns() {
    if (!this.fxPreview) return;
    this.fxRuns = [{ system: null, at: new Vector3(), created: -Infinity, compare: false }];
    if (this.fxPreview.compare) this.fxRuns.push({ system: null, at: new Vector3(), created: -Infinity, compare: true });
  }

  private stopFx() {
    for (const run of this.fxRuns) {
      if (!run.system) continue;
      run.system.emitter = run.at.clone();
      run.system.stop();
    }
    this.fxRuns = [];
  }

  // Effet du réglage : rejoué après sa fin s'il est bref (gerbe, durée limitée), entretenu sinon.
  private tickFx(instance: CharacterInstance) {
    const preview = this.fxPreview!;
    const def = preview.def;
    // Une main qui se referme est rejouée pour revoir la fermeture.
    const period =
      def.emission === "burst"
        ? def.life[1] + 1
        : def.duration > 0
          ? def.duration + def.life[1] + 1
          : def.shape === "fingers"
            ? def.closeTime + def.life[1] + 1.5
            : Infinity;
    for (const run of this.fxRuns) {
      // En comparaison, les deux versions de part et d'autre du personnage, un peu devant lui.
      const side = preview.compare ? (run.compare ? 0.8 : -0.8) : 0;
      const offset: [number, number, number] = [side, 0, preview.compare ? 0.4 : 0];
      effectPosition(instance, { recipe: "", start: 0, end: 0, anchor: preview.anchor, offset }, 0, run.at);
      if (this.clock - run.created < period) continue;
      if (run.system) {
        run.system.emitter = run.at.clone();
        run.system.stop();
      }
      run.system = run.compare ? preview.compare!(this.fx, run.at) : createFromDef(this.fx, run.at, def, "preview");
      run.created = this.clock;
    }
  }

  // Étiquettes « Réglages » et « Code » au-dessus des deux versions comparées.
  private fxLabels(): FrameInfo["labels"] {
    if (!this.fxPreview?.compare) return [];
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const canvas = this.engine.getRenderingCanvas();
    const ratio = (canvas?.clientWidth ?? width) / Math.max(1, width);
    const viewport = this.camera.viewport.toGlobal(width, height);
    return this.fxRuns.map((run) => {
      const above = run.at.add(new Vector3(0, 0.7, 0));
      const projected = Vector3.Project(above, Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
      return { x: projected.x * ratio, y: projected.y * ratio, text: run.compare ? "Code" : "Réglages" };
    });
  }

  private restart() {
    const instance = this.instance;
    if (!instance) return;
    this.effects.stopAll();
    this.targetFx.stopAll();
    this.zoneFx.stopAll();
    this.sequence = null;
    this.codeFx.clearTransient();
    this.zoneDisc.isVisible = false;
    for (const group of instance.animations.values()) group.stop();
    this.frozen = null;
    // Nouvel animateur : il remet les fondus que la pose figée retire.
    this.animator = new CharacterAnimator(instance.animations, instance.set, this.tuning);
    this.unfreezeTarget();
    this.cycle = { phase: "idle", time: IDLE_PAUSE - 0.3 };
    if (this.mode === "scrub" && !this.fxPreview) this.showFrame();
  }

  private unfreezeTarget() {
    const target = this.target;
    if (!target || (!this.targetFrozen && this.targetAnimator)) return;
    for (const group of target.animations.values()) group.stop();
    this.targetFrozen = null;
    this.targetAnimator = new CharacterAnimator(target.animations, target.set, {});
  }

  private showFrame() {
    const instance = this.instance;
    if (!instance || this.fxPreview) return;
    const group = this.entry && instance.animations.get(this.entry.animation);
    if (group) {
      if (this.frozen !== group) {
        for (const other of instance.animations.values()) other.stop();
        group.enableBlending = false;
        group.start(false, 1, group.from, group.to);
        group.pause();
        this.frozen = group;
      }
      group.goToFrame(group.from + this.scrubTimes.caster * framesPerSecond(group));
      instance.setStowed(true);
    }
    this.showTargetFrame();
    const time = this.scrubTimes[this.moment];
    const reaction = this.entry?.impact?.reaction;
    this.onFrame?.({
      playhead: time,
      cast: null,
      reactionHead: this.moment === "impact" && reaction ? reactionClipTime(reaction, time) : null,
    });
  }

  // Pose de la cible figée dans sa réaction, à l'instant montré de l'impact.
  private showTargetFrame() {
    const target = this.target;
    const reaction = this.entry?.impact?.reaction;
    const group = reaction && target?.animations.get(reaction.animation);
    if (!target || this.moment !== "impact" || !group || targetsSelf(this.abilityId)) {
      this.unfreezeTarget();
      return;
    }
    if (this.targetFrozen !== group) {
      for (const other of target.animations.values()) other.stop();
      group.enableBlending = false;
      group.start(false, 1, group.from, group.to);
      group.pause();
      this.targetFrozen = group;
    }
    group.goToFrame(group.from + reactionClipTime(reaction, this.scrubTimes.impact) * framesPerSecond(group));
  }

  private idleInput(): AnimationInput {
    return { alive: true, castAbility: "", castElapsed: 0, castDuration: 0, stunned: false, rooted: false, charging: false, rampart: false, forward: 0, right: 0 };
  }

  private tick(dt: number) {
    this.fx.update();
    this.codeFx.update(dt);
    this.tickCodeStatus(dt, this.mode === "play" && !this.fxPreview && this.sequence ? this.sequence.time : null);
    this.clock += dt;
    const instance = this.instance;
    const animator = this.animator;
    const entry = this.entry;
    if (!this.targetFrozen) this.targetAnimator?.update(this.idleInput());
    if (this.fxPreview) {
      if (!instance || !animator) return;
      animator.update(this.idleInput());
      instance.setStowed(false);
      this.tickFx(instance);
      this.onFrame?.({ playhead: null, cast: null, labels: this.fxLabels() });
      return;
    }
    // Pose figée : les effets actifs à cet instant sont montrés à leur place.
    if (this.mode === "scrub" && instance && entry) {
      const time = this.scrubTimes[this.moment];
      if (this.moment === "caster" && this.frozen) this.effects.update(instance, { abilityId: this.abilityId, entry, time });
      else this.effects.stopAll();
      this.showMoments(this.moment === "caster" ? null : time, this.moment);
      return;
    }
    if (this.mode !== "play" || !instance || !animator || !entry) return;
    const castTime = castTimeOf(this.abilityId);
    const cycle = this.cycle;
    cycle.time += dt;
    const release = () => {
      animator.ability(this.abilityId);
      cycle.phase = "after";
      this.sequence = { time: 0, reacted: false };
      // Ce que le jeu joue lui-même : projectile, et impact et zone du code s'ils ne sont pas réglés.
      const target = targetsSelf(this.abilityId) ? this.holder : this.targetHolder;
      const tuned = { impact: entry.impact !== undefined, zone: entry.zone !== undefined, zoneParticles: !!entry.zone?.length };
      this.codeFx.play(this.abilityId, this.holder, target, tuned);
      if (getAbility(this.abilityId)?.effects.some((effect) => effect.type === "damage")) this.codeFx.magicHit(this.abilityId, target, tuned.impact);
      if (this.abilityId === "bubble") this.codeFx.statuses.bubbleWasApplied(CODE_DUMMY);
    };
    if (cycle.phase === "idle" && cycle.time >= IDLE_PAUSE) {
      cycle.time = 0;
      if (castTime > 0) cycle.phase = "cast";
      else release();
    } else if (cycle.phase === "cast" && cycle.time >= castTime) {
      cycle.time = 0;
      release();
    } else if (cycle.phase === "after" && cycle.time > 0.2 && ((!animator.performingAbility && this.sequenceDone()) || cycle.time > 15)) {
      cycle.phase = "idle";
      cycle.time = 0;
      this.sequence = null;
      this.targetFx.stopAll();
      this.zoneFx.stopAll();
    }
    const casting = cycle.phase === "cast";
    animator.update({ ...this.idleInput(), castAbility: casting ? this.abilityId : "", castElapsed: casting ? cycle.time : 0, castDuration: castTime });
    instance.setStowed(casting || animator.performingAbility);
    this.effects.update(instance, animator.playingAbility());
    const impactTime = this.tickSequence(dt);
    if (this.moment === "caster") {
      const group = instance.animations.get(entry.animation);
      const frame = group?.isPlaying ? group.animatables[0]?.masterFrame : undefined;
      this.onFrame?.({
        playhead: group && frame !== undefined ? (frame - group.from) / framesPerSecond(group) : null,
        cast: casting ? Math.min(1, cycle.time / castTime) : null,
      });
    } else {
      const reaction = entry.impact?.reaction;
      const reactionTime = reaction && impactTime !== null ? reactionClipTime(reaction, impactTime) : null;
      this.onFrame?.({
        playhead: impactTime,
        cast: casting ? Math.min(1, cycle.time / castTime) : null,
        reactionHead: this.moment === "impact" && reaction && impactTime !== null && reactionTime! < reaction.end ? reactionTime : null,
      });
    }
  }

  // Après le départ du sort : vol du projectile, puis impact (réaction et effets), état et zone. Rend le temps
  // depuis l'impact (null avant).
  private tickSequence(dt: number): number | null {
    const sequence = this.sequence;
    if (!sequence) return null;
    sequence.time += dt;
    const travel = isProjectile(this.abilityId) ? PROJECTILE_TRAVEL_TIME : 0;
    const time = sequence.time - travel;
    if (time >= 0) {
      const reaction = this.entry?.impact?.reaction;
      if (!sequence.reacted && reaction && !targetsSelf(this.abilityId)) this.targetAnimator?.reactTuned(reaction);
      sequence.reacted = true;
    }
    // L'état est posé par le serveur dès le départ du sort, sans attendre le projectile.
    this.showMoments(time, null, sequence.time);
    return time >= 0 ? time : null;
  }

  private sequenceDone(): boolean {
    const sequence = this.sequence;
    if (!sequence) return true;
    const travel = isProjectile(this.abilityId) ? PROJECTILE_TRAVEL_TIME : 0;
    return sequence.time - travel > this.sequenceLength();
  }

  // Durée de ce qui suit l'impact dans la lecture comme en jeu.
  private sequenceLength(): number {
    const entry = this.entry;
    const radius = getAbility(this.abilityId)?.radius ?? 0;
    return Math.max(
      momentLength(this.impactEffects(), entry?.impact?.reaction),
      momentLength(this.zoneEffects()),
      // L'état part du départ du sort, avant l'impact.
      statusKindsOf(this.abilityId).length ? this.statusShown - (isProjectile(this.abilityId) ? PROJECTILE_TRAVEL_TIME : 0) : 0,
      radius ? AREA_DURATION : 0,
    );
  }

  // Effets de chaque moment : ceux du réglage, sinon ceux du code convertis en effets.
  private impactEffects(): AnimationEffect[] {
    return this.entry?.impact?.effects ?? codeImpact(this.abilityId).effects;
  }

  private statusEffects(): AnimationEffect[] {
    return this.entry?.status ?? codeStatus(this.abilityId).effects;
  }

  private zoneEffects(): AnimationEffect[] {
    return this.entry?.zone ?? codeZone(this.abilityId);
  }

  // Visuels d'état du code (particules non réglées, étoiles, cristaux, bulle…) sur la cible, tant que l'état dure
  // dans la lecture (statusTime : depuis son début, null hors état).
  private tickCodeStatus(dt: number, statusTime: number | null) {
    const kinds = statusKindsOf(this.abilityId);
    const self = targetsSelf(this.abilityId);
    const target = self ? this.instance : this.target;
    const root = self ? this.holder : this.targetHolder;
    if (statusTime === null || statusTime < 0 || statusTime >= this.statusShown || !kinds.length || !target) {
      this.codeFx.statuses.update(dt, [], 0);
      return;
    }
    // Toujours le même objet : StatusFx suit chaque joueur par identité (sinon tout repartirait à chaque image).
    const left = this.statusShown - statusTime;
    const dummy = this.codeDummy;
    dummy.root = root;
    dummy.character = target;
    // Un buff sur soi (Rempart) est dans le camp du lanceur.
    dummy.state.team = self ? 0 : 1;
    dummy.state.effects = kinds.map((kind) => ({ kind, remaining: left, source: "" }));
    dummy.hasEffect = (kind: string) => kinds.includes(kind);
    this.codeFx.statuses.update(dt, [dummy as unknown as PlayerVisual], 0);
  }

  // Effets de la cible et de la zone à un instant après l'impact (time, négatif pendant le vol du projectile) et
  // depuis le début de l'état (statusTime), ou d'un seul moment en pose figée (only).
  private showMoments(time: number | null, only: Moment | null, statusTime = time) {
    const entry = this.entry;
    const target = this.targetCharacter();
    const tracks: EffectTrack[] = [];
    const zoneTracks: EffectTrack[] = [];
    const radius = getAbility(this.abilityId)?.radius ?? 0;
    let disc = 0;
    if (time !== null && entry) {
      // En lecture, les moments pas encore réglés sont joués par le code lui-même (codeFx) ; en pose figée, ils sont
      // montrés convertis en effets.
      const impact = only ? this.impactEffects() : (entry.impact?.effects ?? []);
      const status = only ? this.statusEffects() : (entry.status ?? []);
      const zoneEffects = only ? this.zoneEffects() : (entry.zone ?? []);
      if ((!only || only === "impact") && time >= 0 && time <= momentLength(impact, entry.impact?.reaction)) {
        tracks.push({ id: "impact", effects: impact, time });
      }
      if ((!only || only === "status") && status.length && statusTime !== null && (only || statusTime < this.statusShown)) {
        tracks.push({ id: "status", effects: status, time: statusTime });
      }
      if ((!only || only === "zone") && radius && time >= 0) {
        const zone = { center: this.zoneCenter(new Vector3()), yaw: 0, radius };
        if (zoneEffects.length && (only || time <= momentLength(zoneEffects))) zoneTracks.push({ id: "zone", effects: zoneEffects, time, zone });
        // Le disque de portée en pose figée (en lecture, c'est celui du jeu), plus discret avec des particules.
        if (only) {
          disc = zoneEffects.length ? AREA_ALPHA_WITH_PARTICLES : AREA_ALPHA;
          this.zoneDisc.scaling.setAll(radius);
          this.zoneDisc.position.copyFrom(zone.center).y += 0.03;
        }
      }
    }
    this.targetFx.updateTracks(target, tracks);
    this.zoneFx.updateTracks(null, zoneTracks);
    this.zoneDisc.isVisible = disc > 0;
    this.zoneMaterial.alpha = disc;
    const color = ABILITY_FX[this.abilityId]?.color;
    if (color) this.zoneMaterial.emissiveColor.copyFrom(color);
  }

  disposed = false;
  dispose() {
    this.disposed = true;
    this.build++;
    this.targetBuild++;
    window.removeEventListener("resize", this.resize);
    this.instance?.dispose();
    this.target?.dispose();
    this.codeFx.dispose();
    this.fx.dispose();
    this.engine.dispose();
  }
}

// Identifiant du mannequin pour les visuels d'état du code.
const CODE_DUMMY = "lab-target";

// Instant de l'animation de réaction (secondes dans l'animation) à un instant après l'impact.
function reactionClipTime(reaction: TargetReaction, time: number): number {
  return Math.min(reaction.end, reaction.start + Math.max(0, time) * reaction.rate);
}

// Compétences d'une classe, dans l'ordre de sa barre, puis celles qui n'y sont pas mais ont une animation (la
// Bulle, l'impact de la Charge).
function abilityIds(classId: ClassId, set: CharacterAnimationSet | null): string[] {
  const ids = [...CLASSES[classId].abilities];
  if (set) {
    for (const id of [...Object.keys(set.castGestures ?? {}), ...Object.keys(set.abilities)]) {
      if (id !== "default" && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function abilityName(id: string): string {
  if (id === "chargeImpact") return "Charge (impact à l'arrivée)";
  return getAbility(id)?.name ?? id;
}

// Compétences jouées par une posture tenue pendant tout l'effet (course de la Charge, garde du Rempart).
function isStance(set: CharacterAnimationSet | null, id: string): boolean {
  return set?.abilities[id] === "";
}

// Compétences (et moment) qui utilisent un effet à particules, d'après les réglages.
function effectUses(tuning: AnimationTuning, recipe: string): string[] {
  const uses: string[] = [];
  for (const entries of Object.values(tuning)) {
    for (const [abilityId, entry] of Object.entries(entries)) {
      for (const [moment, effects] of momentEffects(entry)) {
        if (effects.some((effect) => effect.recipe === recipe)) uses.push(`${abilityName(abilityId)} (${momentLabel(moment, abilityId)})`);
      }
    }
  }
  return uses;
}

// Effets de chaque moment d'un réglage.
function momentEffects(entry: AbilityAnimation): [Moment, AnimationEffect[]][] {
  return [
    ["caster", entry.effects ?? []],
    ["impact", entry.impact?.effects ?? []],
    ["status", entry.status ?? []],
    ["zone", entry.zone ?? []],
  ];
}

// Nom d'un moment dans ses onglets.
function momentLabel(moment: Moment, abilityId: string): string {
  if (moment === "caster") return "Lanceur";
  if (moment === "impact") return targetsSelf(abilityId) ? "Impact (sur soi)" : "Impact sur la cible";
  if (moment === "zone") return `Zone (${getAbility(abilityId)?.radius ?? 0} m)`;
  const kinds = statusKindsOf(abilityId).map((kind) => EFFECTS[kind as EffectKind]?.label ?? kind);
  const duration = statusDurationOf(abilityId);
  return `Pendant l'état : ${kinds.join(", ")}${Number.isFinite(duration) ? `, ${seconds(duration)}` : ", permanent"}`;
}

// Visuels du code d'un moment : effets à particules (convertibles) et le reste (objets, affichage 2D…).
function codeOf(moment: Moment, abilityId: string): { effects: AnimationEffect[]; extras: string[] } {
  if (moment === "impact") return codeImpact(abilityId);
  if (moment === "status") return codeStatus(abilityId);
  return { effects: codeZone(abilityId), extras: [] };
}

function listOf(effects: AnimationEffect[]): string {
  return [...new Set(effects.map((effect) => `« ${particleEffectLabel(effect.recipe)} »`))].join(", ");
}

// Ce que fait le jeu pour un moment pas encore réglé.
function momentCodeNote(moment: Moment, abilityId: string): string {
  const { effects, extras } = codeOf(moment, abilityId);
  if (!effects.length && !extras.length) return "Pas encore réglé : en jeu, rien de particulier pour ce moment.";
  const parts = [effects.length && `les effets ${listOf(effects)}`, ...extras].filter(Boolean).join(" ; ");
  const reaction = moment === "impact" ? " La cible a sa réaction habituelle aux coups." : "";
  return `Pas encore réglé : en jeu, le code joue ${parts} (montrés sur le mannequin).${reaction} « Régler ce moment » part de ces effets.`;
}

// Ce que le code joue encore (ou ne joue plus) quand le moment est réglé : ce qui n'est pas fait de particules.
function momentExtrasNote(moment: Moment, abilityId: string): string | null {
  const { extras } = codeOf(moment, abilityId);
  if (!extras.length) return null;
  if (moment === "status") return `S'ajoutent en jeu (pas encore réglables) : ${extras.join(" ; ")}.`;
  return `Remplacés par ce réglage et pas encore réglables : ${extras.join(" ; ")}.`;
}

// Rappel du sens du temps 0 de chaque moment.
function momentHint(moment: Moment, abilityId: string): string {
  if (moment === "impact")
    return `0 s : ${isProjectile(abilityId) ? "arrivée du projectile" : "départ du sort"} · joué sur chaque cible touchée`;
  if (moment === "status") return "0 s : début de l'état (au départ du sort) · remplace les particules d'état du code";
  return `Centre : ${zoneCenterIsTarget(abilityId) ? "la cible" : "le lanceur"} · joué une fois par lancement`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundEffect(effect: AnimationEffect): AnimationEffect {
  return {
    recipe: effect.recipe,
    start: round(effect.start),
    end: round(effect.end),
    anchor: effect.anchor,
    offset: effect.offset.map(round) as [number, number, number],
    ...(effect.keys && {
      keys: effect.keys.map((key) => ({
        time: round(key.time),
        anchor: key.anchor,
        offset: key.offset.map(round) as [number, number, number],
      })),
    }),
    ...(effect.untilEnd && { untilEnd: true }),
    ...(effect.fitZone && { fitZone: true }),
  };
}

function roundEntry(entry: AbilityAnimation): AbilityAnimation {
  const rounded: AbilityAnimation = {
    animation: entry.animation,
    start: round(entry.start),
    rate: round(entry.rate),
    end: round(entry.end),
  };
  if (entry.effects) rounded.effects = entry.effects.map(roundEffect);
  if (entry.impact) {
    const reaction = entry.impact.reaction;
    rounded.impact = {
      ...(reaction && {
        reaction: { animation: reaction.animation, start: round(reaction.start), rate: round(reaction.rate), end: round(reaction.end) },
      }),
      effects: (entry.impact.effects ?? []).map(roundEffect),
    };
  }
  if (entry.status) rounded.status = entry.status.map(roundEffect);
  if (entry.zone) rounded.zone = entry.zone.map(roundEffect);
  return rounded;
}

// Réglages sans classe vide, dans un ordre stable (pour comparer et enregistrer).
function normalized(tuning: AnimationTuning): AnimationTuning {
  const result: AnimationTuning = {};
  for (const classId of Object.keys(tuning).sort()) {
    const entries = tuning[classId];
    const ids = Object.keys(entries).sort();
    if (ids.length) result[classId] = Object.fromEntries(ids.map((id) => [id, roundEntry(entries[id])]));
  }
  return result;
}

function sameEntry(a: AbilityAnimation | undefined, b: AbilityAnimation | undefined): boolean {
  return JSON.stringify(a && roundEntry(a)) === JSON.stringify(b && roundEntry(b));
}

// Brouillon gardé dans le navigateur, avec la version enregistrée sur laquelle il a été fait (base).
interface StoredDraft<T> {
  base: Record<string, T>;
  draft: Record<string, T>;
}

// Reprend un brouillon en y ajoutant ce qui a changé dans le fichier depuis (effet créé par Claude, réglage
// enregistré depuis un autre onglet) : seuls les éléments modifiés dans le brouillon gardent leur version.
function rebaseDraft<T>(stored: StoredDraft<T> | null, file: Record<string, T>): Record<string, T> {
  if (!stored?.base || !stored.draft) return file;
  const result = { ...stored.draft };
  const same = (a: T | undefined, b: T | undefined) => JSON.stringify(a) === JSON.stringify(b);
  for (const id of new Set([...Object.keys(file), ...Object.keys(stored.base)])) {
    if (same(file[id], stored.base[id]) || !same(stored.draft[id], stored.base[id])) continue;
    if (file[id] === undefined) delete result[id];
    else result[id] = file[id];
  }
  return result;
}

// Calage des animations à plat (« classe/compétence ») pour reprendre un brouillon compétence par compétence.
function flatTuning(tuning: AnimationTuning): Record<string, AbilityAnimation> {
  const flat: Record<string, AbilityAnimation> = {};
  for (const [classId, entries] of Object.entries(tuning))
    for (const [id, entry] of Object.entries(entries)) flat[`${classId}/${id}`] = entry;
  return flat;
}

function nestedTuning(flat: Record<string, AbilityAnimation>): AnimationTuning {
  const tuning: AnimationTuning = {};
  for (const [key, entry] of Object.entries(flat)) {
    const [classId, id] = key.split("/");
    (tuning[classId] ??= {})[id] = entry;
  }
  return tuning;
}

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible (navigation privée) : le brouillon n'est simplement pas gardé.
  }
}

const seconds = (value: number) => `${value.toFixed(2).replace(".", ",")} s`;

function AnimationLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const castBarRef = useRef<HTMLDivElement>(null);
  const reactionHeadRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const initial = readStorage<{
    classId: ClassId;
    abilityId: string;
    tab?: "animations" | "effets";
    fxId?: string;
    fxAnchor?: EffectAnchor;
    moment?: Moment;
    targetClass?: ClassId;
    distance?: number;
  }>(SELECTION_KEY);
  const [tab, setTab] = useState<"animations" | "effets">(initial?.tab ?? "animations");
  const [fxSaved, setFxSaved] = useState<ParticleDefs | null>(null);
  const [fxDraft, setFxDraft] = useState<ParticleDefs>({});
  const [fxId, setFxId] = useState(initial?.fxId ?? "fireCharge");
  const [fxAnchor, setFxAnchor] = useState<EffectAnchor>(initial?.fxAnchor ?? "hands");
  const [fxCompare, setFxCompare] = useState(false);
  const [requests, setRequests] = useState<ParticleRequest[]>([]);
  const [classId, setClassId] = useState<ClassId>(initial?.classId ?? "arcaniste");
  const [abilityId, setAbilityId] = useState(initial?.abilityId ?? "firebolt");
  const [instance, setInstance] = useState<CharacterInstance | null>(null);
  const [saved, setSaved] = useState<AnimationTuning | null>(null);
  const [draft, setDraft] = useState<AnimationTuning>({});
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedEffect, setSelectedEffect] = useState(0);
  // Moment réglé (geste du lanceur, impact, état, zone), et instant montré en pose figée pour chacun (secondes) :
  // là où se pose un nouveau point clé.
  const [moment, setMoment] = useState<Moment>(initial?.moment ?? "caster");
  const [cursors, setCursors] = useState<Record<Moment, number>>({ caster: 0, impact: 0, status: 0, zone: 0 });
  const cursor = cursors[moment];
  const [targetClass, setTargetClass] = useState<ClassId>(initial?.targetClass ?? "gardien");
  const [distance, setDistance] = useState(initial?.distance ?? 6);
  const [reactionFilter, setReactionFilter] = useState("Hit");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = instance?.set ?? null;
  const castTime = castTimeOf(abilityId);
  const stage = stageRef.current;
  const clipLength = (name: string) => stage?.clipLength(name) ?? 0;

  useEffect(() => {
    const created = new Stage(canvasRef.current!);
    stageRef.current = created;
    Object.assign(window, { lab: created });
    created.onFrame = ({ playhead, cast, labels, reactionHead }) => {
      const reactionMark = reactionHeadRef.current;
      if (reactionMark) {
        reactionMark.style.display = reactionHead == null ? "none" : "block";
        if (reactionHead != null) reactionMark.style.left = `${(reactionHead / Math.max(1e-3, Number(reactionMark.dataset.length))) * 100}%`;
      }
      const tags = labelsRef.current;
      if (tags) {
        [...tags.children].forEach((tag, i) => {
          const label = labels?.[i];
          (tag as HTMLElement).style.display = label ? "block" : "none";
          if (!label) return;
          tag.textContent = label.text;
          (tag as HTMLElement).style.transform = `translate(${label.x}px, ${label.y}px) translate(-50%, -100%)`;
        });
      }
      const head = playheadRef.current;
      if (head) {
        head.style.display = playhead === null ? "none" : "block";
        if (playhead !== null) head.style.left = `${(playhead / Math.max(1e-3, Number(head.dataset.length))) * 100}%`;
      }
      const bar = castBarRef.current;
      if (bar) {
        bar.style.visibility = cast === null ? "hidden" : "visible";
        (bar.firstElementChild as HTMLElement).style.width = `${(cast ?? 0) * 100}%`;
      }
    };
    return () => created.dispose();
  }, []);

  // Réglages enregistrés, et brouillon du navigateur s'il y en a un.
  useEffect(() => {
    void fetch("/__dev-file/animationTuning")
      .then((response) =>
        response.ok ? (response.json() as Promise<AnimationTuning>) : Promise.reject(new Error(String(response.status))),
      )
      .then((tuning) => {
        setSaved(tuning);
        setDraft(nestedTuning(rebaseDraft(readStorage<StoredDraft<AbilityAnimation>>(DRAFT_KEY), flatTuning(tuning))));
      })
      .catch(() => setError("Impossible de lire les réglages : la page doit être servie par le serveur de développement (npm run dev)."));
    void fetch("/__dev-file/particleEffects")
      .then((response) => response.json() as Promise<ParticleDefs | null>)
      .then((defs) => {
        setFxSaved(defs ?? {});
        setFxDraft(rebaseDraft(readStorage<StoredDraft<ParticleEffectDef>>(FX_DRAFT_KEY), defs ?? {}));
      });
    void fetch("/__dev-file/particleRequests")
      .then((response) => response.json() as Promise<ParticleRequest[] | null>)
      .then((list) => setRequests(list ?? []));
  }, []);

  // Effets en cours de réglage : utilisés aussi par l'onglet des animations.
  useEffect(() => setParticleEffectDefs(fxDraft), [fxDraft]);

  useEffect(() => {
    if (!fxSaved) return;
    writeStorage(FX_DRAFT_KEY, JSON.stringify(fxDraft) !== JSON.stringify(fxSaved) ? { base: fxSaved, draft: fxDraft } : null);
  }, [fxDraft, fxSaved]);

  // Onglet des effets : suit les demandes traitées par Claude et les effets qu'il ajoute (sans écraser un effet en
  // cours de modification ici).
  useEffect(() => {
    if (tab !== "effets") return;
    const timer = setInterval(() => {
      void fetch("/__dev-file/particleRequests")
        .then((response) => response.json() as Promise<ParticleRequest[] | null>)
        .then((list) => setRequests(list ?? []));
      void fetch("/__dev-file/particleEffects")
        .then((response) => response.json() as Promise<ParticleDefs | null>)
        .then((file) => {
          if (!file) return;
          setFxSaved((previous) => {
            if (!previous) return previous;
            const changed = Object.keys(file).filter((id) => JSON.stringify(file[id]) !== JSON.stringify(previous[id]));
            if (!changed.length) return previous;
            setFxDraft((draft) => {
              const next = { ...draft };
              for (const id of changed) if (JSON.stringify(draft[id]) === JSON.stringify(previous[id])) next[id] = file[id];
              return next;
            });
            return { ...previous, ...Object.fromEntries(changed.map((id) => [id, file[id]])) };
          });
        });
    }, 4000);
    return () => clearInterval(timer);
  }, [tab]);

  useEffect(() => {
    if (!saved) return;
    const dirty = JSON.stringify(normalized(draft)) !== JSON.stringify(normalized(saved));
    writeStorage(DRAFT_KEY, dirty ? { base: flatTuning(saved), draft: flatTuning(draft) } : null);
  }, [draft, saved]);

  useEffect(
    () => writeStorage(SELECTION_KEY, { classId, abilityId, tab, fxId, fxAnchor, moment, targetClass, distance }),
    [classId, abilityId, tab, fxId, fxAnchor, moment, targetClass, distance],
  );

  // Effets à particules : ceux du jeu convertis en réglages, puis ceux créés ici.
  const fxIds = useMemo(() => {
    const created = Object.keys({ ...fxSaved, ...fxDraft }).filter((id) => !(id in BUILTIN_DEFS));
    return [...Object.keys(BUILTIN_DEFS), ...created.sort()];
  }, [fxSaved, fxDraft]);
  // Réglages complétés des valeurs par défaut (effets enregistrés avant l'ajout d'un réglage).
  const fxBase = fxDraft[fxId] ?? BUILTIN_DEFS[fxId] ?? null;
  const fxDef = useMemo(() => (fxBase ? { ...DEFAULT_DEF, ...fxBase } : null), [fxBase]);
  const fxStatus = (id: string): EffectStatus => {
    const d = fxDraft[id];
    const s = fxSaved?.[id];
    if (JSON.stringify(d) !== JSON.stringify(s)) return !s && !(id in BUILTIN_DEFS) ? "new" : "draft";
    return s ? "saved" : "code";
  };
  const fxUnsaved = fxSaved !== null && JSON.stringify(fxDraft) !== JSON.stringify(fxSaved);
  useEffect(() => {
    // Attendre la lecture des effets enregistrés : l'effet choisi peut en faire partie.
    if (fxSaved && !fxIds.includes(fxId)) setFxId(fxIds[0]);
  }, [fxSaved, fxIds, fxId]);
  const compareRecipe = fxCompare && fxId in BUILTIN_DEFS ? (CODE_RECIPES[fxId] ?? null) : null;
  useEffect(() => {
    stageRef.current?.previewEffect(tab === "effets" ? fxDef : null, fxAnchor, compareRecipe);
  }, [tab, fxDef, fxAnchor, compareRecipe, instance]);

  const setFx = (id: string, def: ParticleEffectDef | null) =>
    setFxDraft((d) => {
      const next = { ...d };
      if (def) next[id] = def;
      else delete next[id];
      return next;
    });
  const uniqueFxId = (base: string) => {
    let n = 1;
    while (`${base}${n}` in fxDraft || `${base}${n}` in BUILTIN_DEFS || `${base}${n}` in (fxSaved ?? {})) n++;
    return `${base}${n}`;
  };
  const sendRequest = async (prompt: string, variant: boolean) => {
    const request: ParticleRequest = {
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      kind: "particules",
      prompt,
      ...(variant && fxDef && { effect: fxId, def: fxDef, anchor: fxAnchor }),
      status: "en attente",
    };
    const list = [...requests, request];
    const response = await fetch("/__dev-file/particleRequests", { method: "POST", body: JSON.stringify(list) });
    if (response.ok) setRequests(list);
    setMessage(response.ok ? "Demande envoyée : dites à Claude « regarde les demandes de l'atelier »." : "Échec de l'envoi de la demande.");
    setTimeout(() => setMessage(null), 5000);
  };

  useEffect(() => {
    setInstance(null);
    const stage = stageRef.current;
    void stage?.load(classId).then(
      (loaded) => loaded && setInstance(loaded),
      // Un chargement abandonné (scène fermée, classe changée) n'est pas une erreur.
      () =>
        stageRef.current === stage &&
        !stage?.disposed &&
        setError("Bibliothèques complètes introuvables : lancez « node scripts/build-animation-catalog.mjs » à la racine du projet."),
    );
  }, [classId]);

  useEffect(() => {
    const stage = stageRef.current;
    void stage?.loadTarget(targetClass).catch(() => undefined);
  }, [targetClass]);
  useEffect(() => stageRef.current?.setDistance(distance), [distance]);

  const ids = useMemo(() => abilityIds(classId, set), [classId, set]);
  // Une compétence d'une autre classe (classe changée) : on prend la première de la nouvelle.
  useEffect(() => {
    if (!ids.includes(abilityId)) setAbilityId(ids[0]);
  }, [ids, abilityId]);

  const stance = isStance(set, abilityId);
  const tuned = draft[classId]?.[abilityId];
  const savedEntry = saved?.[classId]?.[abilityId];
  const entry = useMemo(() => {
    if (!instance || stance) return null;
    const base = tuned ?? suggestedAbilityAnimation(instance.set, abilityId, (name) => stageRef.current?.clipLength(name) ?? 0);
    if (!base) return null;
    // Effets montrés tels que le jeu les jouera : ceux du réglage, sinon ceux prévus dans le code.
    const withEffects = { ...base, effects: effectsOf(base, abilityId) };
    return clampAbilityAnimation(withEffects, castTime, stageRef.current?.clipLength(base.animation) ?? 0);
  }, [instance, stance, tuned, abilityId, castTime]);
  const length = entry ? clipLength(entry.animation) : 0;

  // Moments réglables de la compétence : l'état seulement si elle en laisse un, la zone si elle en a une.
  const ability = getAbility(abilityId);
  const statusKinds = statusKindsOf(abilityId);
  const statusDuration = statusDurationOf(abilityId);
  const moments: Moment[] = ["caster", "impact", ...(statusKinds.length ? (["status"] as const) : []), ...(ability?.radius ? (["zone"] as const) : [])];
  const shownMoment: Moment = moments.includes(moment) ? moment : "caster";
  const [statusShown, setStatusShown] = useState(4);
  // Durée montrée d'un état : la sienne, au plus 8 s (un buff permanent : 4 s).
  useEffect(() => setStatusShown(Number.isFinite(statusDuration) && statusDuration > 0 ? Math.min(8, statusDuration) : 4), [statusDuration]);
  useEffect(() => stageRef.current?.setStatusShown(statusShown), [statusShown]);
  useEffect(() => {
    stageRef.current?.setMoment(shownMoment);
    setSelectedEffect(0);
  }, [shownMoment]);
  const impactLength = Math.max(3, momentLength(entry?.impact?.effects, entry?.impact?.reaction) + 1);
  const zoneLength = Math.max(3, momentLength(entry?.zone) + 1);
  const statusLength = Math.max(statusShown, momentLength(entry?.status?.filter((effect) => !effect.untilEnd)) + 0.5);
  const momentAxis = shownMoment === "impact" ? impactLength : shownMoment === "status" ? statusLength : shownMoment === "zone" ? zoneLength : length;
  const reaction = entry?.impact?.reaction;
  const reactionLength = reaction ? clipLength(reaction.animation) : 0;
  const reactionAnimations = useMemo(() => {
    if (!instance) return [];
    const text = reactionFilter.trim().toLowerCase();
    return [...instance.animations.keys()]
      .filter((name) => !text || name.toLowerCase().includes(text) || name === reaction?.animation)
      .sort((a, b) => a.localeCompare(b));
  }, [instance, reactionFilter, reaction?.animation]);

  useEffect(() => {
    stageRef.current?.select(abilityId, entry);
  }, [abilityId, entry]);

  const animations = useMemo(() => {
    if (!instance) return [];
    const text = filter.trim().toLowerCase();
    return [...instance.animations.keys()]
      .filter((name) => !text || name.toLowerCase().includes(text) || name === entry?.animation)
      .sort((a, b) => a.localeCompare(b));
  }, [instance, filter, entry?.animation]);

  const update = (next: AbilityAnimation) => {
    const clamped = roundEntry(clampAbilityAnimation(next, castTime, clipLength(next.animation)));
    setDraft((d) => ({ ...d, [classId]: { ...d[classId], [abilityId]: clamped } }));
  };

  const removeEntry = () =>
    setDraft((d) => {
      const entries = { ...d[classId] };
      delete entries[abilityId];
      return { ...d, [classId]: entries };
    });

  // Retour au geste du code : le réglage disparaît, sauf s'il a des moments de la cible, gardés avec le geste
  // calé comme le code le fait.
  const resetGesture = () => {
    const current = draft[classId]?.[abilityId];
    const suggested = instance && suggestedAbilityAnimation(instance.set, abilityId, clipLength);
    if (!current || (!current.impact && !current.status && !current.zone) || !suggested) return removeEntry();
    update({ ...suggested, impact: current.impact, status: current.status, zone: current.zone });
  };

  const revert = () => {
    if (savedEntry) setDraft((d) => ({ ...d, [classId]: { ...d[classId], [abilityId]: savedEntry } }));
    else removeEntry();
  };

  const chooseAnimation = (name: string) => {
    const clip = clipLength(name);
    const rate = castTime > 0 ? Math.min(1, clip / castTime) : 1;
    const end = castTime > 0 ? Math.min(clip, castTime * rate + 0.5) : clip;
    // Les effets gardent leur place par rapport au début du geste.
    const shift = -(entry?.start ?? 0);
    const effects = entry?.effects?.map((effect) => shiftEffect(effect, shift));
    // Les moments de la cible ne dépendent pas du geste.
    update({ animation: name, start: 0, rate, end, effects, impact: entry?.impact, status: entry?.status, zone: entry?.zone });
  };

  const scrub = (time: number) => {
    const at = Math.max(0, Math.min(momentAxis, time));
    setCursors((c) => ({ ...c, [shownMoment]: at }));
    stageRef.current?.scrub(at);
    setPlaying(false);
  };

  // Réglage d'un moment de la cible (impact, état, zone), ou son retrait (le jeu reprend ses visuels du code).
  const updateMoment = (patch: Partial<AbilityAnimation>) => {
    if (!entry) return;
    const next: AbilityAnimation = { ...entry, ...patch };
    for (const key of ["impact", "status", "zone"] as const) if (key in patch && patch[key] === undefined) delete next[key];
    update(next);
  };
  const setMomentEffects = (effects: AnimationEffect[]) => {
    if (!entry) return;
    if (shownMoment === "impact") updateMoment({ impact: { ...entry.impact, effects: clampMomentEffects(effects, impactLength) } });
    else if (shownMoment === "status") updateMoment({ status: clampMomentEffects(effects, 600) });
    else if (shownMoment === "zone") updateMoment({ zone: clampMomentEffects(effects, zoneLength) });
  };
  const setReaction = (next: TargetReaction | undefined) => {
    if (!entry) return;
    const impact = { effects: entry.impact?.effects ?? [], ...(next && { reaction: next }) };
    updateMoment({ impact });
  };
  const chooseReaction = (name: string) => {
    if (!name) return setReaction(undefined);
    setReaction({ animation: name, start: 0, rate: 1, end: clipLength(name) });
  };

  const togglePlay = () => {
    const current = stageRef.current;
    if (!current) return;
    if (current.playing) current.scrub(shownMoment === "caster" ? (entry?.start ?? 0) : cursors[shownMoment]);
    else current.play();
    setPlaying(current.playing);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (tab !== "animations" || event.code !== "Space" || (event.target as HTMLElement).closest("input, select, textarea")) return;
      event.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Enregistre ce qui a changé : le calage des animations et les effets à particules.
  // Le fichier a pu changer depuis la lecture (effet ajouté par Claude, autre onglet) : on n'y écrit que ses propres
  // modifications, par-dessus sa version actuelle.
  const save = async () => {
    if (unsaved) {
      const file = ((await fetch("/__dev-file/animationTuning").then((r) => r.json())) ?? {}) as AnimationTuning;
      const tuning = normalized(nestedTuning(rebaseDraft({ base: flatTuning(saved ?? {}), draft: flatTuning(draft) }, flatTuning(file))));
      const response = await fetch("/__dev-file/animationTuning", { method: "POST", body: JSON.stringify(tuning) });
      if (!response.ok) {
        setMessage(`Échec de l'enregistrement : ${await response.text()}`);
        return;
      }
      setSaved(tuning);
      setDraft(tuning);
    }
    if (fxUnsaved) {
      const file = ((await fetch("/__dev-file/particleEffects").then((r) => r.json())) ?? {}) as ParticleDefs;
      const defs = rebaseDraft({ base: fxSaved ?? {}, draft: fxDraft }, file);
      const response = await fetch("/__dev-file/particleEffects", { method: "POST", body: JSON.stringify(defs) });
      if (!response.ok) {
        setMessage(`Échec de l'enregistrement des effets : ${await response.text()}`);
        return;
      }
      setFxSaved(defs);
      setFxDraft(defs);
    }
    setMessage("Enregistré (src/game/animationTuning.json, src/game/particleEffects.json) : le jeu l'utilise au prochain chargement.");
    setTimeout(() => setMessage(null), 4000);
  };

  const status = (cls: ClassId, id: string): "saved" | "draft" | "" => {
    const d = draft[cls]?.[id];
    const s = saved?.[cls]?.[id];
    if (!sameEntry(d, s)) return "draft";
    return s ? "saved" : "";
  };
  const unsaved = saved !== null && JSON.stringify(normalized(draft)) !== JSON.stringify(normalized(saved));

  const release = entry ? releaseTime(entry, castTime) : 0;
  const screenAfter = entry ? (entry.end - (castTime > 0 ? release : entry.start)) / entry.rate : 0;

  return (
    <div className="anim-viewer">
      <div className="anim-toolbar">
        <strong>Réglage</strong>
        <span className="lab-tabs">
          <button className={tab === "animations" ? "lab-tab-active" : ""} onClick={() => setTab("animations")}>
            Animations des compétences
          </button>
          <button className={tab === "effets" ? "lab-tab-active" : ""} onClick={() => setTab("effets")}>
            Effets à particules
          </button>
        </span>
        <label>
          Classe
          <select value={classId} onChange={(e) => setClassId(e.target.value as ClassId)}>
            {CLASS_LIST.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <span className="lab-hint">Souris : tourner autour · molette : zoom · espace : lecture</span>
        <span className="anim-pages">
          {message && <span className="lab-message">{message}</span>}
          <button disabled={!unsaved && !fxUnsaved} onClick={() => void save()} className={unsaved || fxUnsaved ? "lab-save" : ""}>
            {unsaved || fxUnsaved ? "Enregistrer" : "Tout est enregistré"}
          </button>
        </span>
      </div>
      <div className="lab-body">
        {tab === "effets" && (
          <EffectList
            ids={fxIds}
            defs={fxDraft}
            selected={fxId}
            status={fxStatus}
            onSelect={setFxId}
            onNew={() => {
              const id = uniqueFxId("effet");
              setFx(id, newEffectDef());
              setFxId(id);
            }}
          />
        )}
        {tab === "animations" && (
          <div className="lab-abilities">
            {ids.map((id) => {
              const state = status(classId, id);
              const cast = castTimeOf(id);
              return (
                <button
                  key={id}
                  className={`lab-ability ${id === abilityId ? "lab-ability-selected" : ""} ${isStance(set, id) ? "lab-ability-stance" : ""}`}
                  onClick={() => setAbilityId(id)}
                >
                  <span>{abilityName(id)}</span>
                  <small>
                    {cast > 0 ? `incantation ${seconds(cast)}` : "instantané"}
                    {state === "saved" && " · réglé"}
                    {state === "draft" && " · modifié"}
                  </small>
                </button>
              );
            })}
          </div>
        )}
        <div className="anim-stage">
          <canvas ref={canvasRef} className="anim-canvas" />
          <div ref={labelsRef} className="anim-labels">
            <span className="lab-fx-tag" style={{ display: "none" }} />
            <span className="lab-fx-tag" style={{ display: "none" }} />
          </div>
          <div ref={castBarRef} className="lab-castbar" style={{ visibility: "hidden" }}>
            <div />
            <span>{abilityName(abilityId)}</span>
          </div>
          {!instance && !error && <div className="lab-loading">Chargement des animations…</div>}
          {error && <div className="anim-error">{error}</div>}
        </div>
        {tab === "effets" && fxDef && (
          <div className="fx-side">
            <RequestsPanel requests={requests} selectedLabel={fxDef.label} onSend={(prompt, variant) => void sendRequest(prompt, variant)} />
            <EffectEditor
              id={fxId}
              def={fxDef}
              onChange={(def) => setFx(fxId, def)}
              anchor={fxAnchor}
              onAnchor={setFxAnchor}
              compare={fxCompare}
              onCompare={setFxCompare}
              canCompare={fxId in BUILTIN_DEFS}
              canRevert={fxStatus(fxId) === "draft" || (fxStatus(fxId) === "new" && saved !== null && !effectUses(draft, fxId).length)}
              onRevert={() => setFx(fxId, fxSaved?.[fxId] ?? null)}
              canBackToCode={fxId in BUILTIN_DEFS && fxId in fxDraft}
              onBackToCode={() => setFx(fxId, null)}
              onDuplicate={() => {
                const id = uniqueFxId(fxId.replace(/\d+$/, ""));
                setFx(id, { ...fxDef, label: `${fxDef.label} (copie)` });
                setFxId(id);
              }}
              canDelete={!(fxId in BUILTIN_DEFS)}
              usedBy={saved === null ? ["chargement des réglages…"] : effectUses(draft, fxId)}
              onDelete={() => setFx(fxId, null)}
            />
          </div>
        )}
      </div>
      {tab === "animations" && (
        <div className="lab-panel">
          {stance ? (
            <p className="lab-note">
              {abilityName(abilityId)} est jouée par une posture tenue pendant tout l'effet (voir stances dans characterAssets.ts) : elle ne
              se règle pas ici.
            </p>
          ) : entry ? (
            <>
              <div className="lab-moments">
                <button className="lab-play" onClick={togglePlay}>
                  {playing ? "⏸ Pause" : "▶ Jouer comme en jeu"}
                </button>
                <span className="lab-tabs">
                  {moments.map((m) => (
                    <button key={m} className={m === shownMoment ? "lab-tab-active" : ""} onClick={() => setMoment(m)}>
                      {momentLabel(m, abilityId)}
                      {m !== "caster" && entry[m] !== undefined && " ●"}
                    </button>
                  ))}
                </span>
                {shownMoment !== "caster" && !targetsSelf(abilityId) && (
                  <>
                    <label>
                      Cible
                      <select value={targetClass} onChange={(e) => setTargetClass(e.target.value as ClassId)}>
                        {CLASS_LIST.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="lab-rate">
                      Distance {distance.toFixed(0)} m
                      <input type="range" min={2} max={30} step={1} value={distance} onChange={(e) => setDistance(Number(e.target.value))} />
                    </label>
                  </>
                )}
              </div>
              {shownMoment === "caster" ? (
                <>
                  <div className="lab-controls">
                    <label>
                      Animation
                      <select value={entry.animation} onChange={(e) => chooseAnimation(e.target.value)}>
                        {animations.map((name) => (
                          <option key={name} value={name}>
                            {name}
                            {IN_GAME.has(name) ? " ✓" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <input type="search" placeholder="Filtrer les animations" value={filter} onChange={(e) => setFilter(e.target.value)} />
                    <label className="lab-rate">
                      Vitesse ×{entry.rate.toFixed(2).replace(".", ",")}
                      <input
                        type="range"
                        min={MIN_RATE}
                        max={MAX_RATE}
                        step={0.01}
                        value={entry.rate}
                        onChange={(e) => {
                          const rate = Number(e.target.value);
                          // Sort incanté : le début reste en place, la suite du geste garde sa longueur.
                          const shift = castTime > 0 ? castTime * (rate - entry.rate) : 0;
                          update({ ...entry, rate, end: entry.end + shift });
                        }}
                      />
                    </label>
                    <button disabled={sameEntry(tuned, savedEntry)} onClick={revert} title="Revenir au réglage enregistré">
                      Annuler les modifications
                    </button>
                    <button
                      disabled={!tuned}
                      onClick={resetGesture}
                      title="Le geste reprend le calage prévu dans le code (les moments de la cible sont gardés)"
                    >
                      Revenir au calage du code
                    </button>
                  </div>
                  <Timeline length={length} castTime={castTime} entry={entry} playheadRef={playheadRef} onChange={update} onScrub={scrub} />
                  <EffectsPanel
                    kind="caster"
                    length={length}
                    bounds={[entry.start, entry.end]}
                    addSpan={[entry.start, castTime > 0 ? releaseTime(entry, castTime) : entry.end]}
                    effects={entry.effects ?? []}
                    selected={selectedEffect}
                    onSelect={setSelectedEffect}
                    cursor={cursor}
                    playing={playing}
                    onChange={(effects) => update({ ...entry, effects })}
                    onScrub={scrub}
                  />
                  <div className="lab-summary">
                    {castTime > 0 ? (
                      <>
                        Début {seconds(entry.start)} · départ du sort {seconds(release)} · fin {seconds(entry.end)} — à l'écran : incantation{" "}
                        {seconds(castTime)}, puis {seconds(screenAfter)} après le départ du sort
                      </>
                    ) : (
                      <>
                        Début {seconds(entry.start)} · fin {seconds(entry.end)} — à l'écran : {seconds(screenAfter)}
                      </>
                    )}
                    {!tuned && " · calage actuel du code (pas encore réglé)"}
                  </div>
                </>
              ) : entry[shownMoment] === undefined ? (
                <div className="lab-moment-empty">
                  <p className="lab-note">{momentCodeNote(shownMoment, abilityId)}</p>
                  <button
                    className="lab-save"
                    onClick={() => {
                      // Le moment part des effets du code, convertis.
                      const effects = codeOf(shownMoment, abilityId).effects;
                      updateMoment(shownMoment === "impact" ? { impact: { effects } } : shownMoment === "status" ? { status: effects } : { zone: effects });
                    }}
                  >
                    Régler ce moment
                  </button>
                </div>
              ) : (
                <>
                  <div className="lab-controls">
                    {shownMoment === "impact" && (
                      <>
                        <label>
                          Réaction de la cible
                          <select value={reaction?.animation ?? ""} onChange={(e) => chooseReaction(e.target.value)}>
                            <option value="">Aucune (réaction du jeu aux coups)</option>
                            {reactionAnimations.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <input type="search" placeholder="Filtrer les animations" value={reactionFilter} onChange={(e) => setReactionFilter(e.target.value)} />
                        {reaction && (
                          <label className="lab-rate">
                            Vitesse ×{reaction.rate.toFixed(2).replace(".", ",")}
                            <input
                              type="range"
                              min={MIN_RATE}
                              max={MAX_RATE}
                              step={0.01}
                              value={reaction.rate}
                              onChange={(e) => setReaction({ ...reaction, rate: Number(e.target.value) })}
                            />
                          </label>
                        )}
                      </>
                    )}
                    {shownMoment === "status" && (
                      <label className="lab-rate" title="Durée de l'état dans la lecture comme en jeu (en jeu : celle de l'état)">
                        État montré pendant {seconds(statusShown)}
                        <input type="range" min={1} max={15} step={0.5} value={statusShown} onChange={(e) => setStatusShown(Number(e.target.value))} />
                      </label>
                    )}
                    <button
                      onClick={() => updateMoment({ [shownMoment]: undefined })}
                      title={shownMoment === "status" ? "Retirer les effets réglés de l'état" : "Retirer ce réglage : le jeu reprend les visuels prévus dans le code"}
                    >
                      {shownMoment === "status" ? "Retirer les effets de l'état" : "Revenir aux visuels du code"}
                    </button>
                    <span className="lab-hint">{momentHint(shownMoment, abilityId)}</span>
                  </div>
                  {momentExtrasNote(shownMoment, abilityId) && <p className="lab-note lab-extras">{momentExtrasNote(shownMoment, abilityId)}</p>}
                  {shownMoment === "impact" && reaction && (
                    <div className="lab-reaction">
                      <span className="lab-hint">Portion jouée de « {reaction.animation} »</span>
                      <Timeline
                        length={reactionLength}
                        castTime={0}
                        entry={reaction}
                        playheadRef={reactionHeadRef}
                        onChange={(next) => setReaction({ animation: next.animation, start: next.start, rate: next.rate, end: next.end })}
                        onScrub={(clipTime) => scrub((clipTime - reaction.start) / reaction.rate)}
                      />
                    </div>
                  )}
                  <div className="lab-timeline lab-moment-axis">
                    <MomentAxis
                      length={momentAxis}
                      playheadRef={playheadRef}
                      onScrub={scrub}
                      spans={[
                        ...(shownMoment === "impact" && reaction
                          ? [{ label: "Réaction", start: 0, end: (reaction.end - reaction.start) / reaction.rate }]
                          : []),
                        ...(shownMoment === "zone" ? [{ label: "Disque de portée", start: 0, end: AREA_DURATION }] : []),
                        ...(shownMoment === "status" ? [{ label: `État (montré ${seconds(statusShown)})`, start: 0, end: statusShown }] : []),
                      ]}
                    />
                  </div>
                  <EffectsPanel
                    kind={shownMoment}
                    length={momentAxis}
                    bounds={[0, shownMoment === "status" ? momentAxis : momentAxis]}
                    addSpan={[0, shownMoment === "status" ? statusShown : 0.6]}
                    effects={(shownMoment === "impact" ? entry.impact?.effects : entry[shownMoment]) ?? []}
                    selected={selectedEffect}
                    onSelect={setSelectedEffect}
                    cursor={cursor}
                    playing={playing}
                    onChange={setMomentEffects}
                    onScrub={scrub}
                  />
                </>
              )}
            </>
          ) : (
            <p className="lab-note">Chargement…</p>
          )}
        </div>
      )}
    </div>
  );
}

type Drag = "move" | "start" | "release" | "end" | "scrub";

// Timeline de l'animation entière. Sort incanté : la fenêtre d'incantation (début → départ du sort, sa longueur
// suit la vitesse) puis la suite du geste jusqu'à la fin. Compétence instantanée : la portion jouée.
function Timeline(props: {
  length: number;
  castTime: number;
  entry: AbilityAnimation;
  playheadRef: RefObject<HTMLDivElement | null>;
  onChange: (entry: AbilityAnimation) => void;
  onScrub: (time: number) => void;
}) {
  const { length, castTime, entry, playheadRef, onChange, onScrub } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const casting = castTime > 0;
  const release = releaseTime(entry, castTime);
  const percent = (time: number) => `${(time / Math.max(length, 1e-3)) * 100}%`;
  const snap = (time: number) => Math.round(time / SNAP) * SNAP;

  const begin = (kind: Drag, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    const width = track.getBoundingClientRect().width;
    const left = track.getBoundingClientRect().left;
    const x0 = event.clientX;
    const e0 = entry;
    const r0 = release;
    const apply = (clientX: number) => {
      const d = snap(((clientX - x0) / width) * length);
      if (kind === "scrub") {
        onScrub(snap(((clientX - left) / width) * length));
        return;
      }
      let next = e0;
      if (kind === "move") {
        const shift = Math.max(-e0.start, Math.min(d, length - Math.max(r0, e0.end)));
        next = {
          ...e0,
          start: e0.start + shift,
          end: e0.end + shift,
          effects: e0.effects?.map((effect) => shiftEffect(effect, shift)),
        };
      } else if (kind === "start" && casting) {
        // Le départ du sort reste en place : la fenêtre s'étire, la vitesse change.
        const start = Math.min(r0 - castTime * MIN_RATE, Math.max(r0 - castTime * MAX_RATE, 0, e0.start + d));
        next = { ...e0, start, rate: (r0 - start) / castTime };
      } else if (kind === "start") {
        next = { ...e0, start: Math.max(0, Math.min(e0.end - SNAP, e0.start + d)) };
      } else if (kind === "release") {
        const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, (r0 + d - e0.start) / castTime));
        next = { ...e0, rate, end: e0.end + (e0.start + castTime * rate - r0) };
      } else {
        next = { ...e0, end: Math.max(casting ? r0 : e0.start + SNAP, Math.min(length, e0.end + d)) };
      }
      onChange(next);
      // La pose montrée suit le bord déplacé, ou le pointeur quand on glisse toute la fenêtre.
      const pointer = snap(((clientX - left) / width) * length);
      const shown = kind === "end" ? next.end : kind === "release" ? releaseTime(next, castTime) : kind === "move" ? pointer : next.start;
      onScrub(Math.min(length, shown));
    };
    if (kind === "scrub") apply(event.clientX);
    // Un clic sur la fenêtre montre la pose à cet endroit.
    if (kind === "move") onScrub(snap(((event.clientX - left) / width) * length));
    const move = (e: PointerEvent) => apply(e.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ticks = [];
  for (let t = 0; t <= length + 1e-6; t += 0.25) {
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    ticks.push(
      <div key={t} className={`lab-tick ${whole ? "lab-tick-major" : ""}`} style={{ left: percent(t) }}>
        {whole && <span>{t} s</span>}
      </div>,
    );
  }

  return (
    <div className="lab-timeline">
      <div ref={trackRef} className="lab-track" onPointerDown={(e) => begin("scrub", e)}>
        {ticks}
        {casting ? (
          <>
            <div
              className="lab-range lab-range-cast"
              style={{ left: percent(entry.start), width: percent(release - entry.start) }}
              onPointerDown={(e) => begin("move", e)}
              title="Incantation : glisser pour déplacer la portion jouée"
            >
              <span>Incantation {seconds(castTime)}</span>
              <div
                className="lab-handle lab-handle-left"
                onPointerDown={(e) => begin("start", e)}
                title="Début (étire la fenêtre : change la vitesse)"
              />
              <div
                className="lab-handle lab-handle-right"
                onPointerDown={(e) => begin("release", e)}
                title="Départ du sort (change la vitesse)"
              />
            </div>
            <div className="lab-range lab-range-after" style={{ left: percent(release), width: percent(entry.end - release) }}>
              <div className="lab-handle lab-handle-right" onPointerDown={(e) => begin("end", e)} title="Fin du geste" />
            </div>
          </>
        ) : (
          <div
            className="lab-range lab-range-cast"
            style={{ left: percent(entry.start), width: percent(entry.end - entry.start) }}
            onPointerDown={(e) => begin("move", e)}
            title="Portion jouée : glisser pour la déplacer"
          >
            <span>Geste</span>
            <div className="lab-handle lab-handle-left" onPointerDown={(e) => begin("start", e)} title="Début" />
            <div className="lab-handle lab-handle-right" onPointerDown={(e) => begin("end", e)} title="Fin" />
          </div>
        )}
        <div ref={playheadRef} className="lab-playhead" data-length={length} />
      </div>
    </div>
  );
}

// Axe du temps d'un moment de la cible (secondes depuis son début) : un clic ou un glissement montre la pose et
// les effets à cet instant ; repères (réaction, disque de portée, état) en bandes grisées.
function MomentAxis(props: {
  length: number;
  playheadRef: RefObject<HTMLDivElement | null>;
  onScrub: (time: number) => void;
  spans: { label: string; start: number; end: number }[];
}) {
  const { length, playheadRef, onScrub, spans } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const percent = (time: number) => `${(Math.min(time, length) / Math.max(length, 1e-3)) * 100}%`;
  const ticks = [];
  for (let t = 0; t <= length + 1e-6; t += 0.25) {
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    ticks.push(
      <div key={t} className={`lab-tick ${whole ? "lab-tick-major" : ""}`} style={{ left: percent(t) }}>
        {whole && <span>{t} s</span>}
      </div>,
    );
  }
  return (
    <div ref={trackRef} className="lab-track" onPointerDown={(e) => dragOnTrack(e, trackRef.current, length, (_d, at) => onScrub(at))}>
      {ticks}
      {spans.map((span) => (
        <div key={span.label} className="lab-range lab-range-after" style={{ left: percent(span.start), width: percent(span.end - span.start) }}>
          <span>{span.label}</span>
        </div>
      ))}
      <div ref={playheadRef} className="lab-playhead" data-length={length} />
    </div>
  );
}

// Déplacement à la souris sur une piste : delta et position du pointeur, en secondes d'animation.
function dragOnTrack(event: ReactPointerEvent, track: HTMLElement | null, length: number, onMove: (delta: number, at: number) => void) {
  event.preventDefault();
  event.stopPropagation();
  if (!track) return;
  const { left, width } = track.getBoundingClientRect();
  const x0 = event.clientX;
  const snap = (time: number) => Math.round(time / SNAP) * SNAP;
  const move = (e: PointerEvent) => onMove(snap(((e.clientX - x0) / width) * length), snap(((e.clientX - left) / width) * length));
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  // Un simple clic agit déjà (pose montrée à l'endroit cliqué ou au début de l'effet).
  onMove(0, snap(((event.clientX - left) / width) * length));
}

// Effet proposé à l'ajout, selon le moment.
const DEFAULT_RECIPES: Record<Moment, string> = { caster: "fireCharge", impact: "fireBurst", status: "mezHalo", zone: "frostField" };

// Réglage du décalage d'un effet (mètres) : un double-clic remet à zéro.
const OFFSETS: { label: string; min: number; max: number }[] = [
  { label: "Gauche ← → droite", min: -1.5, max: 1.5 },
  { label: "Bas ↓ ↑ haut", min: -1.5, max: 2.5 },
  { label: "Arrière ← → avant", min: -1.5, max: 1.5 },
];

// Piste des effets à particules (une ligne par effet, à glisser comme la fenêtre d'incantation) et réglages de
// l'effet sélectionné.
function EffectsPanel(props: {
  // Moment réglé : le geste du lanceur, ou un moment de la cible (l'état ajoute « jusqu'à la fin de l'état », la
  // zone « à la taille de la zone » et n'a pas d'accroche).
  kind: Moment;
  length: number;
  // Portion où les effets peuvent se placer, et place d'un effet ajouté.
  bounds: [number, number];
  addSpan: [number, number];
  effects: AnimationEffect[];
  selected: number;
  onSelect: (index: number) => void;
  cursor: number;
  playing: boolean;
  onChange: (effects: AnimationEffect[]) => void;
  onScrub: (time: number) => void;
}) {
  const { kind, length, bounds, addSpan, effects, selected, onSelect, cursor, playing, onChange, onScrub } = props;
  const tracks = useRef<(HTMLDivElement | null)[]>([]);
  const [selectedKey, setSelectedKey] = useState(0);
  const percent = (time: number) => `${(time / Math.max(length, 1e-3)) * 100}%`;
  const current = effects[Math.min(selected, effects.length - 1)];
  const index = effects.indexOf(current);
  const keys = current?.keys ?? [];
  const keyIndex = Math.min(selectedKey, keys.length - 1);
  const key = keys[keyIndex];
  // Ce que règlent l'accroche et les curseurs : le point clé sélectionné, ou l'effet entier s'il n'en a pas.
  const place: { anchor: EffectAnchor; offset: [number, number, number] } | undefined = key ?? current;

  const replace = (i: number, effect: AnimationEffect) => onChange(effects.map((e, j) => (j === i ? effect : e)));

  const setPlace = (anchor: EffectAnchor, offset: [number, number, number]) => {
    if (!current) return;
    if (key) replace(index, { ...current, keys: keys.map((k, j) => (j === keyIndex ? { ...k, anchor, offset } : k)) });
    else replace(index, { ...current, anchor, offset });
  };

  const begin = (i: number, part: "move" | "start" | "end", event: ReactPointerEvent) => {
    onSelect(i);
    const e0 = effects[i];
    dragOnTrack(event, tracks.current[i], length, (d, at) => {
      let next = e0;
      if (part === "move") next = shiftEffect(e0, Math.max(bounds[0] - e0.start, Math.min(d, bounds[1] - e0.end)));
      else if (part === "start")
        next = { ...e0, start: Math.max(bounds[0], Math.min(e0.keys?.[0]?.time ?? e0.end - SNAP, e0.end - SNAP, e0.start + d)) };
      else next = { ...e0, end: Math.min(bounds[1], Math.max(e0.keys?.at(-1)?.time ?? e0.start + SNAP, e0.start + SNAP, e0.end + d)) };
      if (next !== e0 || part !== "move") replace(i, next);
      // Un clic (ou un glissement) sur la barre montre la pose sous le pointeur.
      onScrub(part === "end" ? next.end : part === "start" ? next.start : at);
    });
  };

  // Point clé déplacé dans le temps, sans dépasser ses voisins ni sortir de l'effet.
  const beginKey = (i: number, k: number, event: ReactPointerEvent) => {
    onSelect(i);
    setSelectedKey(k);
    const e0 = effects[i];
    const list = e0.keys ?? [];
    const k0 = list[k];
    const min = k > 0 ? list[k - 1].time + SNAP : e0.start;
    const max = k < list.length - 1 ? list[k + 1].time - SNAP : e0.end;
    dragOnTrack(event, tracks.current[i], length, (d) => {
      const time = Math.min(max, Math.max(min, k0.time + d));
      replace(i, { ...e0, keys: list.map((kk, j) => (j === k ? { ...kk, time } : kk)) });
      onScrub(time);
    });
  };

  const add = () => {
    const created: AnimationEffect = {
      recipe: DEFAULT_RECIPES[kind],
      start: addSpan[0],
      end: addSpan[1],
      anchor: kind === "zone" ? "feet" : kind === "caster" ? "hands" : "chest",
      offset: [0, 0, 0],
      ...(kind === "status" && { untilEnd: true }),
      ...(kind === "zone" && { fitZone: true }),
    };
    onChange([...effects, created]);
    onSelect(effects.length);
    setSelectedKey(0);
  };

  // Nouveau point clé à l'instant montré, avec l'accroche et le décalage du point clé le plus proche (ou de l'effet).
  const addKey = () => {
    if (!current) return;
    const time = Math.min(current.end, Math.max(current.start, cursor));
    const existing = keys.findIndex((k) => Math.abs(k.time - time) < SNAP / 2);
    if (existing >= 0) {
      setSelectedKey(existing);
      return;
    }
    const nearest = keys.reduce<EffectKey | null>(
      (best, k) => (!best || Math.abs(k.time - time) < Math.abs(best.time - time) ? k : best),
      null,
    );
    const source = nearest ?? current;
    const created: EffectKey = { time, anchor: source.anchor, offset: [...source.offset] };
    const list = [...keys, created].sort((a, b) => a.time - b.time);
    replace(index, { ...current, keys: list });
    setSelectedKey(list.indexOf(created));
  };

  // Sans son dernier point clé, l'effet garde la position de celui-ci.
  const removeKey = () => {
    if (!current || !key) return;
    const list = keys.filter((_, j) => j !== keyIndex);
    if (list.length) replace(index, { ...current, keys: list });
    else {
      const rest = { ...current, anchor: key.anchor, offset: key.offset };
      delete rest.keys;
      replace(index, rest);
    }
    setSelectedKey(Math.max(0, keyIndex - 1));
  };

  return (
    <div className="lab-effects">
      <div className="lab-effects-head">
        <strong>Effets</strong>
        <button onClick={add}>+ Ajouter un effet</button>
      </div>
      {effects.map((effect, i) => (
        <div
          key={i}
          ref={(el) => {
            tracks.current[i] = el;
          }}
          className="lab-effect-track"
          onPointerDown={(e) => dragOnTrack(e, tracks.current[i], length, (_d, at) => onScrub(at))}
        >
          <div className="lab-effect-portion" style={{ left: percent(bounds[0]), width: percent(bounds[1] - bounds[0]) }} />
          <div
            className={`lab-range lab-range-effect ${i === index ? "lab-range-effect-selected" : ""} ${effect.untilEnd ? "lab-range-open" : ""}`}
            style={{ left: percent(effect.start), width: percent((effect.untilEnd ? length : effect.end) - effect.start) }}
            onPointerDown={(e) => begin(i, "move", e)}
          >
            <span>
              {particleEffectLabel(effect.recipe)}
              {effect.untilEnd && " → fin de l'état"}
            </span>
            <div className="lab-handle lab-handle-left" onPointerDown={(e) => begin(i, "start", e)} title="Début de l'effet" />
            <div className="lab-handle lab-handle-right" onPointerDown={(e) => begin(i, "end", e)} title="Fin de l'effet" />
          </div>
          {(effect.keys ?? []).map((k, j) => (
            <div
              key={j}
              className={`lab-key ${i === index && j === keyIndex ? "lab-key-selected" : ""}`}
              style={{ left: percent(k.time) }}
              onPointerDown={(e) => beginKey(i, j, e)}
              title={`Point clé à ${seconds(k.time)} : ${EFFECT_ANCHORS[k.anchor]}`}
            />
          ))}
        </div>
      ))}
      {current && place && (
        <div className="lab-controls lab-effect-controls">
          <label>
            Effet
            <select value={current.recipe} onChange={(e) => replace(index, { ...current, recipe: e.target.value })}>
              {particleEffectChoices().map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={addKey} disabled={playing} title="Ajoute un point clé à l'instant montré (mettre la lecture en pause)">
            + Point clé ici
          </button>
          <span className="lab-key-label">
            {key ? `Point clé ${keyIndex + 1}/${keys.length} à ${seconds(key.time)}` : "Position de tout l'effet"}
          </span>
          {kind === "zone" ? (
            <span className="lab-hint">Centre de la zone</span>
          ) : (
            <label>
              Accroché
              <select value={place.anchor} onChange={(e) => setPlace(e.target.value as EffectAnchor, place.offset)}>
                {Object.entries(EFFECT_ANCHORS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "status" && (
            <label className="lab-check" title="L'effet dure tant que l'état dure, quelle que soit la fin de sa barre">
              <input
                type="checkbox"
                checked={!!current.untilEnd}
                onChange={(e) => {
                  const next: AnimationEffect = { ...current, untilEnd: e.target.checked };
                  if (!e.target.checked) delete next.untilEnd;
                  replace(index, next);
                }}
              />
              Jusqu'à la fin de l'état
            </label>
          )}
          {kind === "zone" && (
            <label className="lab-check" title="L'effet prend le rayon de la zone (et plus de particules, pour la même densité)">
              <input
                type="checkbox"
                checked={!!current.fitZone}
                onChange={(e) => {
                  const next: AnimationEffect = { ...current, fitZone: e.target.checked };
                  if (!e.target.checked) delete next.fitZone;
                  replace(index, next);
                }}
              />
              À la taille de la zone
            </label>
          )}
          {OFFSETS.map(({ label, min, max }, axis) => (
            <label key={axis} className="lab-offset" title="Double-clic : remettre à zéro">
              {label} {place.offset[axis].toFixed(2).replace(".", ",")} m
              <input
                type="range"
                min={min}
                max={max}
                step={0.01}
                value={place.offset[axis]}
                onChange={(e) => {
                  const offset = [...place.offset] as [number, number, number];
                  offset[axis] = Number(e.target.value);
                  setPlace(place.anchor, offset);
                }}
                onDoubleClick={() => {
                  const offset = [...place.offset] as [number, number, number];
                  offset[axis] = 0;
                  setPlace(place.anchor, offset);
                }}
              />
            </label>
          ))}
          <span className="lab-hint">
            {seconds(current.start)} → {current.untilEnd ? "fin de l'état" : seconds(current.end)}
          </span>
          {key && <button onClick={removeKey}>Supprimer le point clé</button>}
          <button onClick={() => onChange(effects.filter((_, j) => j !== index))}>Supprimer l'effet</button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AnimationLab />
  </StrictMode>,
);
