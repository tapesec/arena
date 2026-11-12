import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { normalizeAngle } from "@arena/shared";
import { casterLength, castTimeOf, clipAt, legacyCastGesture, type AbilityAnimation, type ClassAnimationTuning, type TargetReaction } from "./abilityAnimations";
import type { PlayingAbility } from "./abilityEffects";
import type { CharacterAnimationSet } from "./characterAssets";

// Déplacement dans 8 directions (0 devant, puis par pas de 45° vers la droite ; 4 derrière ; -1 à -3 vers la gauche) :
// pour chacune, une course et une marche (personnage lent : reprise après un root, ralentissement).
// speed : vitesse (m/s) à laquelle l'animation a été enregistrée ; on accélère ou ralentit la lecture pour que les pieds
// suivent la vitesse réelle du personnage. La course avant a été mesurée sur sa version root motion ; les autres sont
// sur place : leur vitesse est déduite de l'amplitude des pas et de la durée du cycle, comparées à celles de la course.
interface Gait {
  name: string;
  speed: number;
}
const RUN: Record<number, Gait> = {
  0: { name: "Jog_Fwd_Loop", speed: 5.36 },
  1: { name: "Jog_Fwd_R_Loop", speed: 5.3 },
  2: { name: "Jog_Right_Loop", speed: 2.5 },
  3: { name: "Jog_Bwd_R_Loop", speed: 4.4 },
  4: { name: "Jog_Bwd_Loop", speed: 4.3 },
  [-1]: { name: "Jog_Fwd_L_Loop", speed: 5.3 },
  [-2]: { name: "Jog_Left_Loop", speed: 2.5 },
  [-3]: { name: "Jog_Bwd_L_Loop", speed: 4.4 },
};
const WALK: Record<number, Gait> = {
  0: { name: "Walk_Loop", speed: 1.5 },
  1: { name: "Walk_Fwd_R_Loop", speed: 1.5 },
  2: { name: "Walk_R_Loop", speed: 0.65 },
  3: { name: "Walk_Bwd_R_Loop", speed: 1.5 },
  4: { name: "Walk_Bwd_Loop", speed: 1.5 },
  [-1]: { name: "Walk_Fwd_L_Loop", speed: 1.5 },
  [-2]: { name: "Walk_L_Loop", speed: 0.65 },
  [-3]: { name: "Walk_Bwd_L_Loop", speed: 1.5 },
};
// En dessous de cette part de la vitesse de course, le personnage marche plutôt que de courir au ralenti.
const RUN_THRESHOLD = 0.47;
// Au-delà, une animation accélérée devient ridicule (bonus de vitesse en pas de côté) : on accepte que les pieds
// glissent un peu.
const MAX_GAIT_RATE = 2.5;
// Marge (radians) avant de changer de direction, et part de la vitesse avant de passer de la marche à la course.
const SECTOR_MARGIN = 0.15;
const GAIT_MARGIN = 0.1;
// En dessous de cette vitesse, le personnage est considéré immobile.
const MOVING_SPEED = 0.6;
// Durée des fondus entre deux animations (vitesse de mélange Babylon, par image).
const BLENDING_SPEED = 0.12;

// Incantation par défaut ; une classe peut en donner une autre pour certains sorts (CharacterAnimationSet.casts).
const CAST_LOOP = "Spell_Simple_Idle_Loop";
// Vitesse de lecture de la course de Charge (le personnage va six fois plus vite qu'en courant).
const CHARGE_RUN_RATE = 1.6;
const DEATH = "Death01";
// Geste d'incantation (voir AbilityAnimation) : délai au-delà duquel une incantation finie sans départ du sort est
// tenue pour interrompue.
const GESTURE_RELEASE_GRACE = 0.35;
// Écart toléré (secondes) entre le geste et la progression de l'incantation reçue du serveur.
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
  // Direction (secteur de 45°, voir RUN) et allure (marche ou course) en cours.
  private sector = 0;
  private walking = false;
  private readonly gaitKeys = new Set([...Object.values(RUN), ...Object.values(WALK)].map((gait) => gait.name));
  private action: AnimationGroup | null = null;
  // Nature de l'action en cours : une réaction (coup reçu) cède la place aux actions du personnage ;
  // une auto-attaque ne coupe pas une compétence (la transformation de la Rage dure plus de 2 s).
  private actionKind: "attack" | "ability" | "reaction" = "attack";
  private lastReaction = -Infinity;
  // Étape du stun en cours : rien, « non » de la tête joué, ou titubation.
  private stunStage: "none" | "getup" | "dazed" = "none";
  private stunned = false;
  private attackIndex = 0;
  // Geste réglé en cours (voir AbilityAnimation) : ses animations s'enchaînent sur une horloge en secondes réelles
  // depuis le début du geste (origin : instant, en secondes de performance.now, du temps 0). Pendant l'incantation,
  // l'horloge suit la progression reçue du serveur ; après le départ du sort (released), elle avance seule. clip :
  // rang de l'animation en cours (-1 : aucune encore, ou finies) ; endedAt : fin de l'incantation vue sans départ du
  // sort.
  private sequence: {
    abilityId: string;
    entry: AbilityAnimation;
    origin: number;
    released: boolean;
    clip: number;
    group: AnimationGroup | null;
    endedAt: number | null;
    // Numéro du geste : un sort relancé aussitôt a ses propres effets (ses sons repartent).
    run: number;
  } | null = null;
  private runs = 0;
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
    if (this.performingAbility) return;
    const name = this.set.attacks[this.attackIndex % this.set.attacks.length];
    this.attackIndex++;
    this.playAction(name, "attack");
  }

  // Compétence réglée dont le geste est en cours, et où il en est (secondes depuis le début du geste, pour ses
  // effets) : jusqu'à la fin de sa dernière animation ou de son dernier effet.
  playingAbility(): PlayingAbility | null {
    const sequence = this.sequence;
    if (!sequence) return null;
    const time = performance.now() / 1000 - sequence.origin;
    if (time >= casterLength(sequence.entry)) return null;
    return { abilityId: sequence.abilityId, entry: sequence.entry, time, run: sequence.run };
  }

  // Le geste d'une compétence est en cours (le lanceur range alors son bâton dans le dos), y compris quand une de
  // ses animations tient sa dernière pose en attendant la suivante.
  get performingAbility(): boolean {
    if (this.actionKind !== "ability" || !this.action) return false;
    return this.action.isPlaying || (this.sequence !== null && this.sequence.group === this.action);
  }

  // Animation en cours de lecture ("" si aucune).
  get currentAnimation(): string {
    return this.current?.name ?? "";
  }

  ability(abilityId: string) {
    const now = performance.now() / 1000;
    const castTime = castTimeOf(abilityId);
    const gesture = this.castGesture(abilityId);
    if (gesture) {
      // Le sort part : l'horloge continue seule. Sans geste en cours (incantation commencée avant que le personnage
      // soit visible), il reprend à l'instant du départ du sort.
      const sequence = this.sequence;
      if (sequence && sequence.abilityId === abilityId && !sequence.released) sequence.released = true;
      else this.startSequence(abilityId, gesture, now - castTime, true);
      return;
    }
    const tuned = castTime > 0 ? undefined : this.tuning[abilityId];
    if (tuned) {
      this.startSequence(abilityId, tuned, now, true);
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
      if (this.performingAbility) return;
      if (now - this.lastReaction < REACTION_INTERVAL) return;
    }
    this.lastReaction = now;
    // Le « non » de la tête suit la projection, quel que soit l'ordre d'arrivée du stun et de son coup.
    if (reaction === "stun") this.stunStage = "none";
    this.playAction(REACTIONS[reaction], "reaction");
  }

  // Réaction réglée sur la page de réglage pour l'impact d'une compétence : mêmes règles qu'un coup reçu, sauf
  // qu'un personnage stun garde sa posture.
  reactTuned(reaction: TargetReaction) {
    const now = performance.now() / 1000;
    if (this.stunned) return;
    if (this.action?.isPlaying && this.actionKind !== "reaction") return;
    if (this.performingAbility) return;
    if (now - this.lastReaction < REACTION_INTERVAL) return;
    this.lastReaction = now;
    this.playAction(reaction.animation, "reaction", reaction.rate, reaction.start, reaction.end);
  }

  // Incantation interrompue (déplacement, Silence, dégâts…) : le geste s'arrête aussitôt.
  interruptCast() {
    if (this.sequence && !this.sequence.released) this.stopSequence();
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
      // Animation du geste finie un peu avant l'horloge : sa dernière pose tient jusqu'à l'animation suivante.
      if (this.sequence && this.sequence.group === this.action) return;
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
    // Angle du déplacement par rapport au regard : 0 devant, ±π derrière, positif vers la droite ; secteur de 45°.
    // On garde la direction en cours tant que l'écart ne dépasse pas d'une marge la moitié du secteur : sinon, autour de
    // la frontière, le personnage alternerait entre deux animations.
    const angle = Math.atan2(input.right, input.forward);
    const offset = Math.abs(normalizeAngle(angle - (this.sector * Math.PI) / 4));
    if (offset > Math.PI / 8 + SECTOR_MARGIN) {
      this.sector = Math.round(angle / (Math.PI / 4));
      if (this.sector === -4) this.sector = 4;
    }
    const sector = this.sector;
    const run = RUN[sector];
    // Même marge entre marche et course.
    const threshold = run.speed * RUN_THRESHOLD * (this.walking ? 1 + GAIT_MARGIN : 1 - GAIT_MARGIN);
    const walking = (this.walking = speed < threshold);
    // Rooté et encore lent, en avançant ou en reculant : marche entravée (jouée à l'envers pour reculer).
    if (walking && input.rooted && Math.abs(sector) !== 2) {
      const backward = Math.abs(sector) >= 3;
      const rate = Math.min(speed / ROOT_WALK_SPEED, MAX_GAIT_RATE);
      if (backward) this.play(ROOT_WALK, true, -rate, `${ROOT_WALK}:backward`);
      else this.play(ROOT_WALK, true, rate);
      return;
    }
    const gait = walking ? WALK[sector] : run;
    this.play(gait.name, true, Math.min(speed / gait.speed, MAX_GAIT_RATE), gait.name, true);
  }

  dispose() {}

  // Geste réglé : démarre avec l'incantation et suit sa progression ; s'arrête si l'incantation se termine sans que
  // le sort parte ; après le départ du sort, ses animations vont jusqu'au bout.
  private updateGesture(input: AnimationInput) {
    const now = performance.now() / 1000;
    const casting = input.alive ? input.castAbility : "";
    const entry = casting ? this.castGesture(casting) : null;
    // Nouvelle incantation : un autre sort, ou le même relancé (son temps écoulé repart de zéro).
    const fresh = casting !== this.lastCast.abilityId || input.castElapsed + 0.05 < this.lastCast.elapsed;
    this.lastCast = { abilityId: casting, elapsed: input.castElapsed };
    // Le temps d'incantation reçu peut différer du temps normal : l'horloge suit la progression de l'incantation.
    const castClock = input.castElapsed * (castTimeOf(casting) / Math.max(input.castDuration, 0.1));
    if (entry && fresh) this.startSequence(casting, entry, now - castClock, false);

    const sequence = this.sequence;
    if (!sequence) return;
    if (!input.alive) return this.stopSequence();
    if (!sequence.released) {
      if (casting === sequence.abilityId) {
        // Recalée sur l'incantation si elle s'en écarte.
        const origin = now - castClock;
        if (Math.abs(origin - sequence.origin) > GESTURE_MAX_DRIFT) sequence.origin = origin;
      } else {
        // Incantation finie : le départ du sort (message à part) peut arriver juste après.
        sequence.endedAt ??= now;
        if (now - sequence.endedAt > GESTURE_RELEASE_GRACE) return this.stopSequence();
      }
    }
    this.advanceSequence(sequence, now);
  }

  // Joue l'animation du geste qui correspond à l'horloge, et la recale si elle s'en écarte.
  private advanceSequence(sequence: NonNullable<CharacterAnimator["sequence"]>, now: number) {
    // Geste coupé par une autre action (stun, réaction, mort…) : il s'arrête, ses effets aussi.
    if (sequence.group && this.action !== sequence.group) return this.stopSequence();
    const time = now - sequence.origin;
    const at = clipAt(sequence.entry, time);
    if (!at) {
      // Après la dernière animation (les animations s'enchaînent sans trou) : le personnage reprend sa pose normale ;
      // les effets continuent.
      if (sequence.group && this.action === sequence.group) this.action = null;
      sequence.group = null;
      sequence.clip = -1;
      if (time >= casterLength(sequence.entry)) this.sequence = null;
      return;
    }
    const group = this.animations.get(at.clip.animation);
    if (!group) return;
    const targetFrame = this.frame(group, at.clipTime);
    if (sequence.clip !== at.index || sequence.group !== group) {
      sequence.clip = at.index;
      sequence.group = group;
      this.switchTo(group, `gesture:${sequence.abilityId}:${at.index}`, false, at.clip.rate, targetFrame, this.frame(group, at.clip.end));
      this.action = group;
      this.actionKind = "ability";
      return;
    }
    // Recalage seulement une fois l'animation partie (juste après son départ, l'image lue vaut encore 0 : la recaler
    // à ce moment-là la termine aussitôt).
    const frame = group.animatables[0]?.masterFrame;
    const startFrame = this.frame(group, at.clip.start);
    if (!group.isPlaying || frame === undefined || frame < startFrame - 0.5) return;
    if (Math.abs(frame - targetFrame) > GESTURE_MAX_DRIFT * framesPerSecond(group) * at.clip.rate) group.goToFrame(targetFrame);
  }

  private startSequence(abilityId: string, entry: AbilityAnimation, origin: number, released: boolean) {
    this.stopSequence();
    this.sequence = { abilityId, entry, origin, released, clip: -1, group: null, endedAt: null, run: ++this.runs };
    this.advanceSequence(this.sequence, performance.now() / 1000);
  }

  // Image d'une animation à un temps donné (secondes depuis son début).
  private frame(group: AnimationGroup, time: number): number {
    return group.from + time * framesPerSecond(group);
  }

  // Rend la main aux animations courantes (fondu vers l'attente ou le déplacement).
  private stopSequence() {
    const sequence = this.sequence;
    if (!sequence) return;
    this.sequence = null;
    if (sequence.group && this.action === sequence.group) this.action = null;
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
  // keepPhase : d'une allure à l'autre (changement de direction), la nouvelle animation reprend au même point du cycle
  // de pas que la précédente au lieu de repartir du début.
  private play(name: string, loop: boolean, speedRatio: number, key = name, keepPhase = false) {
    const group = this.animations.get(name);
    if (!group) return;
    if (this.currentKey === key) {
      group.speedRatio = speedRatio;
      return;
    }
    const previous = this.current;
    const phase = keepPhase && previous && this.gaitKeys.has(this.currentKey) ? cyclePhase(previous) : null;
    const start = phase === null ? undefined : group.from + phase * (group.to - group.from);
    this.switchTo(group, key, loop, speedRatio, start);
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

// Avancement (0 à 1) d'une animation en boucle dans son cycle.
function cyclePhase(group: AnimationGroup): number | null {
  const animatable = group.animatables[0];
  const length = group.to - group.from;
  if (!animatable || length <= 0) return null;
  const frame = animatable.masterFrame;
  return (((frame - group.from) % length) + length) % length / length;
}

export function framesPerSecond(group: AnimationGroup): number {
  return group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
}
