import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { castTimeOf, legacyCastGesture, releaseTime, type AbilityAnimation, type ClassAnimationTuning } from "./abilityAnimations";
import type { PlayingAbility } from "./abilityEffects";
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
// Geste d'incantation (voir AbilityAnimation) : délai au-delà duquel une incantation finie sans départ du sort est
// tenue pour interrompue.
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
  // Geste d'incantation en cours : sort, animation et calage, vitesse pendant l'incantation (le calage est fait pour
  // le temps d'incantation normal, celui reçu du serveur peut différer) ; released une fois le sort parti ;
  // endedAt : fin de l'incantation vue sans départ du sort.
  private gesture: {
    abilityId: string;
    group: AnimationGroup;
    entry: AbilityAnimation;
    release: number;
    castRate: number;
    started: boolean;
    released: boolean;
    endedAt: number | null;
  } | null = null;
  // Geste de compétence en cours (incantation ou compétence réglée), pour ses effets.
  private abilityClip: { abilityId: string; entry: AbilityAnimation; group: AnimationGroup } | null = null;
  // Incantation vue à la mise à jour précédente, pour reconnaître une nouvelle incantation du même sort.
  private lastCast = { abilityId: "", elapsed: 0 };

  // tuning : calage des animations de compétence de la classe (animationTuning.json), prioritaire sur le code.
  constructor(
    private animations: Map<string, AnimationGroup>,
    private set: CharacterAnimationSet,
    private tuning: ClassAnimationTuning = {},
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

  // Compétence réglée dont le geste est en cours, et où il en est dans l'animation (pour ses effets).
  playingAbility(): PlayingAbility | null {
    const clip = this.abilityClip;
    if (!clip || this.action !== clip.group || !clip.group.isPlaying) return null;
    const frame = clip.group.animatables[0]?.masterFrame;
    if (frame === undefined) return null;
    return { abilityId: clip.abilityId, entry: clip.entry, time: (frame - clip.group.from) / framesPerSecond(clip.group) };
  }

  // Le geste d'une compétence est en cours (le lanceur range alors son bâton dans le dos).
  get performingAbility(): boolean {
    return this.actionKind === "ability" && this.action?.isPlaying === true;
  }

  ability(abilityId: string) {
    const gesture = this.castGesture(abilityId);
    if (gesture) {
      this.releaseGesture(abilityId, gesture);
      return;
    }
    const tuned = this.tuning[abilityId];
    if (tuned) {
      this.playAction(tuned.animation, "ability", tuned.rate, tuned.start, tuned.end);
      const group = this.animations.get(tuned.animation);
      if (group) this.abilityClip = { abilityId, entry: tuned, group };
      return;
    }
    this.playAction(this.set.abilities[abilityId] ?? this.set.abilities.default, "ability", this.set.abilityRates?.[abilityId] ?? 1);
  }

  // Geste qui couvre l'incantation et le lancement d'un sort : réglé sur la page de réglage, sinon déclaré dans le
  // code (castGestures). Les sorts sans geste gardent l'incantation commune puis le geste du lancement.
  private castGesture(abilityId: string): AbilityAnimation | null {
    if (!abilityId || castTimeOf(abilityId) <= 0) return null;
    return this.tuning[abilityId] ?? legacyCastGesture(this.set, abilityId);
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
      const gestured = !!this.castGesture(input.castAbility);
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

  // Geste d'incantation : démarre avec l'incantation, suit sa progression, puis va jusqu'à sa fin après le départ
  // du sort, ou s'arrête aussitôt si l'incantation se termine sans que le sort parte.
  private updateGesture(input: AnimationInput) {
    const now = performance.now() / 1000;
    const casting = input.alive ? input.castAbility : "";
    const entry = casting ? this.castGesture(casting) : null;
    // Nouvelle incantation : un autre sort, ou le même relancé (son temps écoulé repart de zéro).
    const fresh = casting !== this.lastCast.abilityId || input.castElapsed + 0.05 < this.lastCast.elapsed;
    this.lastCast = { abilityId: casting, elapsed: input.castElapsed };
    if (entry && fresh) this.startGesture(casting, entry, input.castDuration);

    const gesture = this.gesture;
    if (!gesture) return;
    if (!input.alive) return this.stopGesture();
    if (gesture.released) {
      if (!gesture.group.isPlaying) this.stopGesture();
      return;
    }
    if (casting !== gesture.abilityId) {
      // Incantation finie : le départ du sort (message à part) peut arriver juste après.
      gesture.endedAt ??= now;
      if (now - gesture.endedAt > GESTURE_RELEASE_GRACE) this.stopGesture();
      return;
    }
    // Position voulue dans l'animation d'après la progression de l'incantation.
    const target = Math.min(gesture.release, gesture.entry.start + input.castElapsed * gesture.castRate);
    const fps = framesPerSecond(gesture.group);
    const targetFrame = gesture.group.from + target * fps;
    if (!gesture.started) {
      gesture.started = true;
      this.switchTo(gesture.group, `gesture:${gesture.abilityId}`, false, gesture.castRate, targetFrame, this.frame(gesture.group, gesture.entry.end));
      this.action = gesture.group;
      this.actionKind = "ability";
      this.abilityClip = { abilityId: gesture.abilityId, entry: gesture.entry, group: gesture.group };
      return;
    }
    // Recalé sur l'incantation ; arrivé au départ du sort, le geste y attend le message de départ.
    const frame = gesture.group.animatables[0]?.masterFrame ?? targetFrame;
    const drift = frame - targetFrame;
    if (Math.abs(drift) > GESTURE_MAX_DRIFT * fps) gesture.group.goToFrame(targetFrame);
    gesture.group.speedRatio = target >= gesture.release ? 0 : gesture.castRate;
  }

  private startGesture(abilityId: string, entry: AbilityAnimation, castDuration: number) {
    const group = this.animations.get(entry.animation);
    if (!group) return;
    this.stopGesture();
    const release = releaseTime(entry, castTimeOf(abilityId));
    this.gesture = {
      abilityId,
      group,
      entry,
      release,
      castRate: (release - entry.start) / Math.max(castDuration, 0.1),
      started: false,
      released: false,
      endedAt: null,
    };
  }

  // Le sort part : le geste reprend sa vitesse réglée à partir du départ du sort, jusqu'à sa fin. Sans geste en
  // cours (incantation commencée avant que le personnage soit visible), on n'en joue que la fin.
  private releaseGesture(abilityId: string, entry: AbilityAnimation) {
    let gesture = this.gesture;
    if (!gesture || gesture.abilityId !== abilityId || gesture.released) {
      this.startGesture(abilityId, entry, castTimeOf(abilityId));
      gesture = this.gesture;
      if (!gesture) return;
    }
    gesture.released = true;
    const releaseFrame = this.frame(gesture.group, gesture.release);
    if (!gesture.started) {
      gesture.started = true;
      this.switchTo(gesture.group, `gesture:${abilityId}`, false, entry.rate, releaseFrame, this.frame(gesture.group, entry.end));
      this.action = gesture.group;
      this.actionKind = "ability";
      this.abilityClip = { abilityId, entry: gesture.entry, group: gesture.group };
    } else {
      gesture.group.speedRatio = gesture.entry.rate;
      const fps = framesPerSecond(gesture.group);
      const frame = gesture.group.animatables[0]?.masterFrame ?? releaseFrame;
      if (frame < releaseFrame - GESTURE_MAX_DRIFT * fps) gesture.group.goToFrame(releaseFrame);
    }
  }

  // Image d'une animation à un temps donné (secondes depuis son début).
  private frame(group: AnimationGroup, time: number): number {
    return group.from + time * framesPerSecond(group);
  }

  // Rend la main aux animations courantes (fondu vers l'attente ou le déplacement).
  private stopGesture() {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    if (this.action === gesture.group) this.action = null;
  }

  // start, end : portion jouée (secondes dans l'animation), par défaut l'animation entière.
  private playAction(name: string | undefined, kind: "attack" | "ability" | "reaction", speedRatio = 1, start?: number, end?: number) {
    const group = name ? this.animations.get(name) : undefined;
    if (!group) return;
    const from = start === undefined ? undefined : this.frame(group, start);
    const to = end === undefined ? undefined : this.frame(group, end);
    this.switchTo(group, `action:${name}`, false, speedRatio, from, to);
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

  // startFrame : image de départ (par défaut, la première) ; endFrame : image où s'arrêter (par défaut, la dernière).
  private switchTo(group: AnimationGroup, key: string, loop: boolean, speedRatio: number, startFrame?: number, endFrame?: number) {
    if (this.current && this.current !== group) this.current.stop();
    this.current = group;
    this.currentKey = key;
    group.stop();
    // Lue à l'envers, l'animation part de sa dernière image.
    if (speedRatio < 0) group.start(loop, speedRatio, group.to, group.from);
    else group.start(loop, speedRatio, startFrame ?? group.from, endFrame ?? group.to);
  }
}

export function framesPerSecond(group: AnimationGroup): number {
  return group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
}
