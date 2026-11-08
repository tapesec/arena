import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
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

export interface AnimationInput {
  alive: boolean;
  casting: boolean;
  // Vitesse dans le repère du personnage (m/s) : vers l'avant et vers la droite.
  forward: number;
  right: number;
}

// Choisit l'animation à jouer selon l'état du personnage, avec un fondu entre deux animations.
// Les actions ponctuelles (coup, compétence) passent devant tant qu'elles durent.
export class CharacterAnimator {
  private current: AnimationGroup | null = null;
  private currentKey = "";
  private action: AnimationGroup | null = null;
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
    const name = this.set.attacks[this.attackIndex % this.set.attacks.length];
    this.attackIndex++;
    this.playAction(name);
  }

  ability(abilityId: string) {
    this.playAction(this.set.abilities[abilityId] ?? this.set.abilities.default);
  }

  update(input: AnimationInput) {
    if (!input.alive) {
      this.action = null;
      this.play(DEATH, false, 1);
      return;
    }
    const speed = Math.hypot(input.forward, input.right);
    const moving = speed >= MOVING_SPEED;
    // Une action en cours n'est interrompue que si le personnage se met à bouger.
    if (this.action) {
      if (!moving && this.action.isPlaying) return;
      this.action = null;
    }
    if (!moving) {
      this.play(input.casting ? CAST_LOOP : this.set.idle, true, 1);
      return;
    }
    // Angle du déplacement par rapport au regard : 0 devant, ±π derrière, positif vers la droite.
    const angle = Math.atan2(input.right, input.forward);
    if (Math.abs(angle) <= Math.PI / 3) this.play(LOCOMOTION.forward, true, speed / JOG_SPEED);
    else if (Math.abs(angle) >= (2 * Math.PI) / 3) this.play(LOCOMOTION.backward, true, -speed / JOG_SPEED, "backward");
    else {
      const rate = Math.min(speed / STRAFE_SPEED, MAX_STRAFE_RATE);
      this.play(angle > 0 ? LOCOMOTION.right : LOCOMOTION.left, true, rate);
    }
  }

  private playAction(name: string | undefined) {
    const group = name ? this.animations.get(name) : undefined;
    if (!group) return;
    this.switchTo(group, `action:${name}`, false, 1);
    this.action = group;
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
