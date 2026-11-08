import type { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterAnimationSet } from "./characterAssets";

// Vitesse (m/s) à laquelle chaque animation de déplacement a été enregistrée : on accélère ou ralentit
// la lecture pour que les pieds suivent la vitesse réelle du personnage (mesuré sur les versions root motion).
const JOG_SPEED = 5.36;
const STRAFE_SPEED = 0.65;
// Au-delà, une marche latérale accélérée devient ridicule : on accepte que les pieds glissent un peu.
const MAX_STRAFE_RATE = 2.5;
// En dessous de cette vitesse, le personnage est considéré immobile.
const MOVING_SPEED = 0.6;
// Durée des fondus entre deux animations (vitesse de mélange Babylon, par image).
const BLENDING_SPEED = 0.12;

const LOCOMOTION = {
  forward: "Jog_Fwd_Loop",
  // Pas de course arrière dans les packs : la course avant jouée à l'envers.
  backward: "Jog_Fwd_Loop",
  left: "Walk_L_Loop",
  right: "Walk_R_Loop",
} as const;

const CAST_LOOP = "Spell_Simple_Idle_Loop";
const DEATH = "Death01";

// Os du bas du corps : ils gardent l'animation de déplacement pendant qu'un coup est porté en courant.
// Tous les autres (colonne, bras, tête) jouent le coup.
const LOWER_BODY = new Set([
  "root",
  "pelvis",
  "thigh_l",
  "calf_l",
  "foot_l",
  "ball_l",
  "ball_leaf_l",
  "thigh_r",
  "calf_r",
  "foot_r",
  "ball_r",
  "ball_leaf_r",
]);

// Matrices de travail, réutilisées à chaque image.
const TMP = { spine: new Matrix(), attacking: new Matrix(), running: new Matrix(), result: new Matrix() };

// Corps entier, ou seulement le haut ou le bas.
type BodyPart = "full" | "upper" | "lower";

interface Clip {
  name: string;
  loop: boolean;
  speedRatio: number;
  // Distingue deux usages d'une même animation (course avant et course à l'envers).
  key: string;
}

// Animation en cours sur une couche : le fond (repos, déplacement, incantation, mort) ou l'action (coup, compétence).
interface Playing {
  group: AnimationGroup;
  key: string;
  part: BodyPart;
}

export interface AnimationInput {
  alive: boolean;
  casting: boolean;
  // Vitesse dans le repère du personnage (m/s) : vers l'avant et vers la droite.
  forward: number;
  right: number;
}

// Choisit l'animation à jouer selon l'état du personnage, avec un fondu entre deux animations.
// Les actions ponctuelles (coup, compétence) passent devant : sur tout le corps à l'arrêt,
// sur le haut du corps seulement en mouvement, les jambes continuant de courir.
export class CharacterAnimator {
  private base: Playing | null = null;
  private action: Playing | null = null;
  // Animations restreintes au haut ou au bas du corps, créées à la demande.
  private parts = new Map<string, AnimationGroup>();
  private attackIndex = 0;
  private scene: Scene | null = null;
  private afterAnimations: Observer<Scene> | null = null;
  // Os où le haut du corps est rattaché au bassin, pour la correction d'orientation (voir alignUpperBody).
  private pelvis: TransformNode | null = null;
  private spine: TransformNode | null = null;

  constructor(
    private animations: Map<string, AnimationGroup>,
    private set: CharacterAnimationSet,
  ) {
    for (const group of animations.values()) setupBlending(group);
    const any = animations.values().next().value;
    if (!any) return;
    for (const { target } of any.targetedAnimations) {
      if (target.name === "pelvis") this.pelvis = target;
      if (target.name === "spine_01") this.spine = target;
    }
    this.scene = any.getScene();
    // Après l'application des animations de l'image, avant l'affichage.
    this.afterAnimations = this.scene.onAfterAnimationsObservable.add(() => this.alignUpperBody());
  }

  // Coup d'auto-attaque : les animations du set défilent à tour de rôle.
  attack() {
    if (this.set.attacks.length === 0) return;
    const name = this.set.attacks[this.attackIndex % this.set.attacks.length];
    this.attackIndex++;
    this.startAction(name);
  }

  ability(abilityId: string) {
    this.startAction(this.set.abilities[abilityId] ?? this.set.abilities.default);
  }

  update(input: AnimationInput) {
    if (!input.alive) {
      this.stopAction();
      this.playBase({ name: DEATH, loop: false, speedRatio: 1, key: DEATH }, "full");
      return;
    }
    const speed = Math.hypot(input.forward, input.right);
    const moving = speed >= MOVING_SPEED;
    const clip = moving ? locomotion(input.forward, input.right, speed) : this.idleClip(input.casting);

    if (this.action && !this.action.group.isPlaying) this.stopAction();
    if (!this.action) {
      this.playBase(clip, "full");
      return;
    }
    if (moving) {
      // En mouvement : les jambes courent, le haut du corps porte le coup.
      this.playBase(clip, "lower");
      this.setActionPart("upper");
    } else {
      // À l'arrêt : le coup prend tout le corps.
      this.stopBase();
      this.setActionPart("full");
    }
  }

  private idleClip(casting: boolean): Clip {
    const name = casting ? CAST_LOOP : this.set.idle;
    return { name, loop: true, speedRatio: 1, key: name };
  }

  private startAction(name: string | undefined) {
    if (!name || !this.animations.has(name)) return;
    const part = this.partFor();
    const group = this.group(name, part);
    if (!group) return;
    this.action?.group.stop();
    this.action = { group, key: name, part };
    start(group, false, 1);
  }

  // Partie du corps d'une nouvelle action : le haut si un déplacement est en cours, tout le corps sinon.
  private partFor(): BodyPart {
    return this.base && isLocomotion(this.base.key) ? "upper" : "full";
  }

  // Passe l'action en cours sur une autre partie du corps, sans la reprendre au début.
  private setActionPart(part: BodyPart) {
    const action = this.action;
    if (!action || action.part === part) return;
    const group = this.group(action.key, part);
    if (!group) return;
    const frame = currentFrame(action.group);
    action.group.stop();
    start(group, false, 1, frame);
    this.action = { group, key: action.key, part };
  }

  private stopAction() {
    this.action?.group.stop();
    this.action = null;
  }

  private playBase(clip: Clip, part: BodyPart) {
    const group = this.group(clip.name, part);
    if (!group) return;
    const base = this.base;
    if (base && base.key === clip.key && base.part === part) {
      group.speedRatio = clip.speedRatio;
      return;
    }
    // Même animation sur une autre partie du corps : on reprend au même instant pour ne pas casser la foulée.
    const frame = base && base.key === clip.key ? currentFrame(base.group) : undefined;
    base?.group.stop();
    start(group, clip.loop, clip.speedRatio, frame);
    this.base = { group, key: clip.key, part };
  }

  private stopBase() {
    this.base?.group.stop();
    this.base = null;
  }

  // Animation entière, ou restreinte aux os du haut ou du bas du corps.
  private group(name: string, part: BodyPart): AnimationGroup | undefined {
    const source = this.animations.get(name);
    if (!source || part === "full") return source;
    const id = `${name}:${part}`;
    let group = this.parts.get(id);
    if (!group) {
      group = new AnimationGroup(id, source.getScene());
      for (const targeted of source.targetedAnimations) {
        const lower = LOWER_BODY.has((targeted.target as { name: string }).name);
        if (lower === (part === "lower")) group.addTargetedAnimation(targeted.animation, targeted.target);
      }
      group.normalize(source.from, source.to);
      setupBlending(group);
      this.parts.set(id, group);
    }
    return group;
  }

  // Les coups d'épée tournent le bassin (posture de côté) et animent le buste par rapport à lui.
  // En courant, le bassin suit la course : sans correction, le buste partirait de travers.
  // On fait donc tourner le bas du dos de l'écart entre le bassin de l'attaque et celui de la course.
  private alignUpperBody() {
    const action = this.action;
    if (!action || action.part !== "upper" || !this.pelvis || !this.spine) return;
    const frame = currentFrame(action.group);
    const pelvisAnimation = this.pelvisRotation(action.key);
    const running = this.pelvis.rotationQuaternion;
    const spine = this.spine.rotationQuaternion;
    if (frame === undefined || !pelvisAnimation || !running || !spine) return;
    const attacking = pelvisAnimation.evaluate(frame) as Quaternion;
    // Babylon compose de l'enfant vers le parent : buste = bas du dos × bassin. Pour garder le buste
    // de l'attaque sur le bassin de la course : bas du dos' = bas du dos × bassin attaque × bassin course⁻¹.
    Matrix.FromQuaternionToRef(spine, TMP.spine);
    Matrix.FromQuaternionToRef(attacking, TMP.attacking);
    Matrix.FromQuaternionToRef(running, TMP.running);
    TMP.running.invert();
    TMP.spine.multiplyToRef(TMP.attacking, TMP.result);
    TMP.result.multiplyToRef(TMP.running, TMP.spine);
    Quaternion.FromRotationMatrixToRef(TMP.spine, spine);
  }

  private pelvisRotations = new Map<string, Animation | null>();

  private pelvisRotation(name: string): Animation | null {
    if (!this.pelvisRotations.has(name)) {
      const targeted = this.animations
        .get(name)
        ?.targetedAnimations.find((t) => t.target.name === "pelvis" && t.animation.targetProperty === "rotationQuaternion");
      this.pelvisRotations.set(name, targeted?.animation ?? null);
    }
    return this.pelvisRotations.get(name) ?? null;
  }

  dispose() {
    this.afterAnimations?.remove();
    for (const group of this.parts.values()) group.dispose();
    this.parts.clear();
  }
}

function setupBlending(group: AnimationGroup) {
  group.enableBlending = true;
  group.blendingSpeed = BLENDING_SPEED;
}

function locomotion(forward: number, right: number, speed: number): Clip {
  // Angle du déplacement par rapport au regard : 0 devant, ±π derrière, positif vers la droite.
  const angle = Math.atan2(right, forward);
  if (Math.abs(angle) <= Math.PI / 3) {
    return { name: LOCOMOTION.forward, loop: true, speedRatio: speed / JOG_SPEED, key: "forward" };
  }
  if (Math.abs(angle) >= (2 * Math.PI) / 3) {
    return { name: LOCOMOTION.backward, loop: true, speedRatio: -speed / JOG_SPEED, key: "backward" };
  }
  const rate = Math.min(speed / STRAFE_SPEED, MAX_STRAFE_RATE);
  return angle > 0
    ? { name: LOCOMOTION.right, loop: true, speedRatio: rate, key: "right" }
    : { name: LOCOMOTION.left, loop: true, speedRatio: rate, key: "left" };
}

function isLocomotion(key: string): boolean {
  return key === "forward" || key === "backward" || key === "left" || key === "right";
}

function currentFrame(group: AnimationGroup): number | undefined {
  return group.animatables[0]?.masterFrame;
}

// Démarre une animation, éventuellement à un instant donné ; lue à l'envers, elle part de sa dernière image.
function start(group: AnimationGroup, loop: boolean, speedRatio: number, frame?: number) {
  group.stop();
  if (speedRatio < 0) group.start(loop, speedRatio, group.to, group.from);
  else group.start(loop, speedRatio, group.from, group.to);
  if (frame !== undefined) group.goToFrame(frame);
}
