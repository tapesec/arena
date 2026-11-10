import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { CharacterAnimationSet } from "./characterAssets";

// Vitesse (m/s) à laquelle chaque animation de déplacement a été enregistrée : on accélère ou ralentit
// la lecture pour que les pieds suivent la vitesse réelle du personnage (mesuré sur les versions root motion).
const JOG_SPEED = 5.36;
// Estimée d'après l'amplitude du pas et la durée du cycle, comparées à celles de la course.
const WALK_SPEED = 1.5;
// En dessous, le personnage marche plutôt que de courir au ralenti (reprise après un root, ralentissement).
const RUN_THRESHOLD = 2.5;
const STRAFE_SPEED = 0.65;
// Au-delà, une marche latérale accélérée devient ridicule : on accepte que les pieds glissent un peu.
const MAX_STRAFE_RATE = 2.5;
// En dessous de cette vitesse, le personnage est considéré immobile.
const MOVING_SPEED = 0.6;
// Durée des fondus entre deux animations (vitesse de mélange Babylon, par image).
const BLENDING_SPEED = 0.12;

const LOCOMOTION = {
  forward: "Jog_Fwd_Loop",
  walk: "Walk_Loop",
  left: "Walk_L_Loop",
  right: "Walk_R_Loop",
} as const;

// Incantation par défaut ; une classe peut en donner une autre pour certains sorts (CharacterAnimationSet.casts).
const CAST_LOOP = "Spell_Simple_Idle_Loop";
// Vitesse de lecture de la course de Charge (le personnage va six fois plus vite qu'en courant).
const CHARGE_RUN_RATE = 1.6;
const DEATH = "Death01";
// Geste d'incantation (CastGesture) : vitesse de lecture permise pour caler son moment fort sur le départ du sort
// (en dessous, le geste attend au début de l'incantation), durée jouée après ce moment, et délai au-delà duquel une
// incantation finie sans départ du sort est tenue pour interrompue.
const GESTURE_MIN_RATE = 0.6;
const GESTURE_MAX_RATE = 1.6;
const GESTURE_FOLLOW_THROUGH = 0.5;
const GESTURE_RELEASE_GRACE = 0.35;
// Écart toléré (secondes d'animation) entre le geste et la progression de l'incantation reçue du serveur.
const GESTURE_MAX_DRIFT = 0.15;
// Stun : une fois relevé de la projection, un « non » de la tête, puis il titube jusqu'à la fin du stun.
const STUN_GETUP = "Idle_No_Loop";
const STUN_LOOP = "Zombie_Idle_Loop";
// Root : marche entravée tant que la vitesse n'est pas revenue (vitesse d'enregistrement mesurée comme la marche).
const ROOT_WALK = "Zombie_Walk_Fwd_Loop";
const ROOT_WALK_SPEED = 1.6;

// Réactions aux coups reçus.
export type Reaction = "light" | "heavy" | "stun" | "block";
const REACTIONS: Record<Reaction, string> = {
  light: "Hit_Chest",
  heavy: "Hit_Head",
  stun: "Hit_Knockback",
  block: "Sword_Block",
};
// Écart minimal entre deux réactions, pour qu'un personnage pris sous plusieurs coups ne tressaute pas sans arrêt.
const REACTION_INTERVAL = 0.5;

export interface AnimationInput {
  alive: boolean;
  // Sort en cours d'incantation ("" si aucun), temps écoulé et durée totale de l'incantation (secondes).
  castAbility: string;
  castElapsed: number;
  castDuration: number;
  stunned: boolean;
  rooted: boolean;
  // Charge du Gardien : course rapide.
  charging: boolean;
  // Rempart du Gardien : en garde derrière le bouclier pendant tout l'effet.
  rampart: boolean;
  // Vitesse dans le repère du personnage (m/s) : vers l'avant et vers la droite.
  forward: number;
  right: number;
}

// Choisit l'animation à jouer selon l'état du personnage, avec un fondu entre deux animations.
// Les actions ponctuelles (coup, compétence) passent devant tant qu'elles durent, même en mouvement.
export class CharacterAnimator {
  private current: AnimationGroup | null = null;
  private currentKey = "";
  private action: AnimationGroup | null = null;
  // Nature de l'action en cours : une réaction (coup reçu) cède la place aux actions du personnage ;
  // une auto-attaque ne coupe pas une compétence (la transformation de la Rage dure plus de 2 s).
  private actionKind: "attack" | "ability" | "reaction" = "attack";
  private lastReaction = -Infinity;
  // Étape du stun en cours : rien, « non » de la tête joué, ou titubation.
  private stunStage: "none" | "getup" | "dazed" = "none";
  private stunned = false;
  private attackIndex = 0;
  // Geste d'incantation en cours : sort, animation, moment fort, vitesse et attente avant de démarrer ; released
  // une fois le sort parti, avec l'image où s'arrêter ; endedAt : fin de l'incantation vue sans départ du sort.
  private gesture: {
    abilityId: string;
    group: AnimationGroup;
    release: number;
    rate: number;
    delay: number;
    started: boolean;
    released: boolean;
    stopFrame: number;
    endedAt: number | null;
  } | null = null;
  // Incantation vue à la mise à jour précédente, pour reconnaître une nouvelle incantation du même sort.
  private lastCast = { abilityId: "", elapsed: 0 };

  constructor(
    private animations: Map<string, AnimationGroup>,
    private set: CharacterAnimationSet,
  ) {
    for (const group of animations.values()) {
      group.enableBlending = true;
      group.blendingSpeed = BLENDING_SPEED;
    }
  }

  // Coup d'auto-attaque : les animations du set défilent à tour de rôle.
  attack() {
    if (this.set.attacks.length === 0) return;
    if (this.action?.isPlaying && this.actionKind === "ability") return;
    const name = this.set.attacks[this.attackIndex % this.set.attacks.length];
    this.attackIndex++;
    this.playAction(name, "attack");
  }

  // Le geste d'une compétence est en cours (le lanceur range alors son bâton dans le dos).
  get performingAbility(): boolean {
    return this.actionKind === "ability" && this.action?.isPlaying === true;
  }

  ability(abilityId: string) {
    const definition = this.set.castGestures?.[abilityId];
    if (definition) {
      this.releaseGesture(abilityId, definition.animation, definition.release);
      return;
    }
    this.playAction(this.set.abilities[abilityId] ?? this.set.abilities.default, "ability", this.set.abilityRates?.[abilityId] ?? 1);
  }

  // Coup reçu. Le stun passe toujours ; les autres réactions n'interrompent pas un coup ou une compétence
  // du personnage, et sont espacées d'au moins REACTION_INTERVAL.
  react(reaction: Reaction) {
    const now = performance.now() / 1000;
    // Un personnage stun encaisse (il recule) mais ne pare pas.
    if (reaction === "block" && this.stunned) return;
    if (reaction !== "stun") {
      if (this.action?.isPlaying && this.actionKind !== "reaction") return;
      if (now - this.lastReaction < REACTION_INTERVAL) return;
    }
    this.lastReaction = now;
    // Le « non » de la tête suit la projection, quel que soit l'ordre d'arrivée du stun et de son coup.
    if (reaction === "stun") this.stunStage = "none";
    this.playAction(REACTIONS[reaction], "reaction");
  }

  // Incantation interrompue (déplacement, Silence, dégâts…) : le geste s'arrête aussitôt.
  interruptCast() {
    this.stopGesture();
  }

  update(input: AnimationInput) {
    this.stunned = input.alive && input.stunned;
    if (!this.stunned) this.stunStage = "none";
    this.updateGesture(input);
    if (!input.alive) {
      this.action = null;
      this.play(DEATH, false, 1);
      return;
    }
    // Une action en cours va jusqu'au bout, même si le personnage se déplace.
    if (this.action) {
      if (this.action.isPlaying) return;
      this.action = null;
    }
    if (this.stunned) {
      if (this.stunStage === "none") {
        this.stunStage = "getup";
        this.playAction(STUN_GETUP, "reaction");
      } else {
        this.stunStage = "dazed";
        this.play(STUN_LOOP, true, 1);
      }
      return;
    }
    const stances = this.set.stances;
    if (input.rampart && stances?.rampart) {
      this.play(stances.rampart, true, 1);
      return;
    }
    if (input.charging && stances?.charge) {
      this.play(stances.charge, true, CHARGE_RUN_RATE);
      return;
    }
    const speed = Math.hypot(input.forward, input.right);
    if (speed < MOVING_SPEED) {
      // Un sort à geste d'incantation attend son geste dans la pose normale, sans l'incantation commune.
      const gestured = !!this.set.castGestures?.[input.castAbility];
      const cast = input.castAbility && !gestured ? (this.set.casts?.[input.castAbility] ?? CAST_LOOP) : "";
      this.play(cast || this.set.idle, true, 1);
      return;
    }
    // Angle du déplacement par rapport au regard : 0 devant, ±π derrière, positif vers la droite.
    const angle = Math.atan2(input.right, input.forward);
    const forward = Math.abs(angle) <= Math.PI / 3;
    const backward = Math.abs(angle) >= (2 * Math.PI) / 3;
    if (forward || backward) {
      const walking = speed < RUN_THRESHOLD;
      // Rooté et encore lent : marche entravée.
      const entangled = walking && input.rooted;
      const name = entangled ? ROOT_WALK : walking ? LOCOMOTION.walk : LOCOMOTION.forward;
      const rate = speed / (entangled ? ROOT_WALK_SPEED : walking ? WALK_SPEED : JOG_SPEED);
      // Pas d'animation de recul dans les packs : celle d'avancer, jouée à l'envers.
      if (forward) this.play(name, true, rate);
      else this.play(name, true, -rate, `${name}:backward`);
    } else {
      const rate = Math.min(speed / STRAFE_SPEED, MAX_STRAFE_RATE);
      this.play(angle > 0 ? LOCOMOTION.right : LOCOMOTION.left, true, rate);
    }
  }

  dispose() {}

  // Geste d'incantation : démarre avec l'incantation, suit sa progression, puis s'arrête peu après le départ du
  // sort, ou aussitôt si l'incantation se termine sans que le sort parte.
  private updateGesture(input: AnimationInput) {
    const now = performance.now() / 1000;
    const casting = input.alive ? input.castAbility : "";
    const definition = casting ? this.set.castGestures?.[casting] : undefined;
    // Nouvelle incantation : un autre sort, ou le même relancé (son temps écoulé repart de zéro).
    const fresh = casting !== this.lastCast.abilityId || input.castElapsed + 0.05 < this.lastCast.elapsed;
    this.lastCast = { abilityId: casting, elapsed: input.castElapsed };
    if (definition && fresh) this.startGesture(casting, definition.animation, definition.release, input.castDuration);

    const gesture = this.gesture;
    if (!gesture) return;
    if (!input.alive) return this.stopGesture();
    const fps = gesture.group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    if (gesture.released) {
      const frame = gesture.group.animatables[0]?.masterFrame ?? gesture.stopFrame;
      if (!gesture.group.isPlaying || frame >= gesture.stopFrame) this.stopGesture();
      return;
    }
    if (casting !== gesture.abilityId) {
      // Incantation finie : le départ du sort (message à part) peut arriver juste après.
      gesture.endedAt ??= now;
      if (now - gesture.endedAt > GESTURE_RELEASE_GRACE) this.stopGesture();
      return;
    }
    // Position voulue dans l'animation d'après la progression de l'incantation.
    const target = Math.max(0, input.castElapsed - gesture.delay) * gesture.rate;
    if (input.castElapsed < gesture.delay) return;
    const targetFrame = gesture.group.from + target * fps;
    if (!gesture.started) {
      gesture.started = true;
      this.switchTo(gesture.group, `gesture:${gesture.abilityId}`, false, gesture.rate, targetFrame);
      this.action = gesture.group;
      this.actionKind = "ability";
      return;
    }
    // Recalé sur l'incantation ; passé le moment fort, on ne revient plus en arrière (le message de départ du sort
    // peut arriver un peu après la fin de l'incantation).
    const frame = gesture.group.animatables[0]?.masterFrame ?? targetFrame;
    const drift = frame - targetFrame;
    const pastRelease = target >= gesture.release;
    if (drift < -GESTURE_MAX_DRIFT * fps || (!pastRelease && drift > GESTURE_MAX_DRIFT * fps)) gesture.group.goToFrame(targetFrame);
  }

  private startGesture(abilityId: string, animation: string, release: number, castDuration: number) {
    const group = this.animations.get(animation);
    if (!group) return;
    this.stopGesture();
    const duration = Math.max(castDuration, 0.1);
    const rate = Math.min(GESTURE_MAX_RATE, Math.max(GESTURE_MIN_RATE, release / duration));
    this.gesture = {
      abilityId,
      group,
      release,
      rate,
      delay: Math.max(0, duration - release / rate),
      started: false,
      released: false,
      stopFrame: 0,
      endedAt: null,
    };
  }

  // Le sort part : le geste reprend sa vitesse normale à partir de son moment fort, puis s'arrête peu après.
  // Sans geste en cours (incantation commencée avant que le personnage soit visible), on n'en joue que la fin.
  private releaseGesture(abilityId: string, animation: string, release: number) {
    let gesture = this.gesture;
    if (!gesture || gesture.abilityId !== abilityId || gesture.released) {
      this.startGesture(abilityId, animation, release, release);
      gesture = this.gesture;
      if (!gesture) return;
    }
    const fps = gesture.group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    gesture.released = true;
    gesture.stopFrame = gesture.group.from + (release + GESTURE_FOLLOW_THROUGH) * fps;
    const releaseFrame = gesture.group.from + release * fps;
    if (!gesture.started) {
      gesture.started = true;
      this.switchTo(gesture.group, `gesture:${abilityId}`, false, 1, releaseFrame);
      this.action = gesture.group;
      this.actionKind = "ability";
    } else {
      gesture.group.speedRatio = 1;
      const frame = gesture.group.animatables[0]?.masterFrame ?? releaseFrame;
      if (frame < releaseFrame - GESTURE_MAX_DRIFT * fps) gesture.group.goToFrame(releaseFrame);
    }
  }

  // Rend la main aux animations courantes (fondu vers l'attente ou le déplacement).
  private stopGesture() {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    if (this.action === gesture.group) this.action = null;
  }

  private playAction(name: string | undefined, kind: "attack" | "ability" | "reaction", speedRatio = 1) {
    const group = name ? this.animations.get(name) : undefined;
    if (!group) return;
    this.switchTo(group, `action:${name}`, false, speedRatio);
    this.action = group;
    this.actionKind = kind;
  }

  // key distingue deux usages d'une même animation (course avant et course à l'envers).
  private play(name: string, loop: boolean, speedRatio: number, key = name) {
    const group = this.animations.get(name);
    if (!group) return;
    if (this.currentKey === key) {
      group.speedRatio = speedRatio;
      return;
    }
    this.switchTo(group, key, loop, speedRatio);
  }

  // startFrame : image de départ (par défaut, la première).
  private switchTo(group: AnimationGroup, key: string, loop: boolean, speedRatio: number, startFrame?: number) {
    if (this.current && this.current !== group) this.current.stop();
    this.current = group;
    this.currentKey = key;
    group.stop();
    // Lue à l'envers, l'animation part de sa dernière image.
    if (speedRatio < 0) group.start(loop, speedRatio, group.to, group.from);
    else {
      group.start(loop, speedRatio, group.from, group.to);
      if (startFrame !== undefined && startFrame > group.from) group.goToFrame(startFrame);
    }
  }
}
