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
  // Sort en cours d'incantation ("" si aucun).
  castAbility: string;
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
    this.playAction(this.set.abilities[abilityId] ?? this.set.abilities.default, "ability");
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

  update(input: AnimationInput) {
    this.stunned = input.alive && input.stunned;
    if (!this.stunned) this.stunStage = "none";
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
      const cast = input.castAbility ? (this.set.casts?.[input.castAbility] ?? CAST_LOOP) : "";
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

  private playAction(name: string | undefined, kind: "attack" | "ability" | "reaction") {
    const group = name ? this.animations.get(name) : undefined;
    if (!group) return;
    this.switchTo(group, `action:${name}`, false, 1);
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

  private switchTo(group: AnimationGroup, key: string, loop: boolean, speedRatio: number) {
    if (this.current && this.current !== group) this.current.stop();
    this.current = group;
    this.currentKey = key;
    group.stop();
    // Lue à l'envers, l'animation part de sa dernière image.
    if (speedRatio < 0) group.start(loop, speedRatio, group.to, group.from);
    else group.start(loop, speedRatio, group.from, group.to);
  }
}
