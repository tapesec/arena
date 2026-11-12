import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PLAZA, getAbility, revivesInArea, type CombatEvent, type MatchPhase } from "@arena/shared";
import { audio, type SoundName } from "../audio/AudioManager";
import type { CameraController } from "./CameraController";
import { isGrass } from "./environment";
import type { PlayerVisual } from "./PlayerVisual";
import { PROJECTILE_TRAVEL_TIME, isProjectile } from "./spellFx";
import { ABILITY_SOUNDS, type Cue } from "./codeSounds";
import { tuningOf } from "./abilityAnimations";
import { TUNING } from "./tuning";
import type { SoundSink } from "./abilityEffects";
import {
  ABSORB_SOUND,
  ALERTS,
  BLOCK_SOUND,
  CONTROL_ALERTS,
  EVADE_SOUND,
  FADE_DISTANCE,
  FULL_VOLUME_DISTANCE,
  HEALED_INTERVAL,
  HEALED_VOLUME,
  HEARTBEAT_INTERVAL,
  HEAVY_HIT,
  HIT,
  HIT_DELAY,
  LOW_HEALTH_RATIO,
  MELEE_ABILITIES,
  MIN_DISTANT_VOLUME,
  PAIN_CHANCE,
  PAIN_INTERVAL,
  PAN_WIDTH,
  READY_SOUND_MIN_COOLDOWN,
  RUN_SPEED,
  RUN_STRIDE,
  STEP_RANGE,
  STEP_SOUNDS,
  STEP_VOLUME_OTHERS,
  STEP_VOLUME_SELF,
  SWINGS,
  SWING_VOLUME,
  VOICES,
  VOICE_VOLUME,
  WALK_STRIDE,
} from "./commonSounds";

// Les sons du code d'un moment ne sont plus joués quand ce moment est réglé sur la page de réglage : un impact réglé
// (comme ses visuels), ou un geste du lanceur qui a au moins une piste de son.
const tunedSounds = (abilityId: string, moment: "caster" | "impact") => {
  const entry = tuningOf(TUNING, abilityId);
  if (moment === "impact") return entry?.impact !== undefined;
  return !!entry?.effects?.some((effect) => effect.type === "sound");
};

// Une technique de mêlée (ou le Coup de pied) qui a une piste de son réglée au geste du lanceur ne joue plus le geste
// de l'arme commun ; une piste de son réglée à l'impact remplace le bruit du coup commun.
const hasSoundTrack = (abilityId: string, moment: "caster" | "impact") => {
  const entry = tuningOf(TUNING, abilityId);
  const effects = moment === "impact" ? entry?.impact?.effects : entry?.effects;
  return !!effects?.some((effect) => effect.type === "sound");
};

// Suivi d'un joueur pour ses pas et sa voix.
interface Tracked {
  x: number;
  z: number;
  stride: number;
  lastPain: number;
  lastHealed: number;
}

// Traduit les événements de la partie en sons, spatialisés par rapport à la caméra.
export class GameAudio {
  private tracked = new Map<string, Tracked>();
  private heartbeatTimer = 0;
  private lastPhase: MatchPhase | null = null;
  private lastCountdown = -1;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private camera: CameraController,
    private selfId: string,
  ) {}

  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
  }

  onAbility(abilityId: string, caster: PlayerVisual | undefined, target: PlayerVisual | undefined) {
    if (MELEE_ABILITIES.has(abilityId) && caster && !hasSoundTrack(abilityId, "caster")) this.swing(caster);
    const sounds = ABILITY_SOUNDS[abilityId];
    if (!sounds) return;
    if (sounds.cast && caster && !tunedSounds(abilityId, "caster")) this.playCues(sounds.cast, caster.root.position);
    // Une résurrection de zone (Intervention divine) résonne sur chaque allié relevé (voir onCombat), pas sur son
    // lanceur.
    const ability = getAbility(abilityId);
    if (sounds.impact && target && !tunedSounds(abilityId, "impact") && !(ability && revivesInArea(ability))) {
      // Un sort à projectile résonne à son arrivée.
      const delay = isProjectile(abilityId) ? PROJECTILE_TRAVEL_TIME : 0;
      this.playCues(sounds.impact, target.root.position, delay);
    }
  }

  onCombat(event: CombatEvent, source: PlayerVisual | undefined, target: PlayerVisual | undefined) {
    if (!target) return;
    const position = target.root.position;
    const isSelf = event.targetId === this.selfId;
    // Coup qui porte : attaque automatique, technique ou Coup de pied (pas un tic de poison).
    const melee = !event.dot && (event.abilityId === "auto" || event.abilityId === "kick" || MELEE_ABILITIES.has(event.abilityId));
    // Auto-attaque : le geste de l'arme, quel que soit le résultat (les compétences le jouent à leur lancement).
    if (event.abilityId === "auto" && source && event.kind !== "heal") this.swing(source);
    switch (event.kind) {
      case "damage": {
        if (melee && (event.abilityId === "auto" || !hasSoundTrack(event.abilityId, "impact"))) {
          const heavy = event.crit || event.abilityId === "backstab";
          this.playCues([heavy ? HEAVY_HIT : HIT], position, HIT_DELAY);
        }
        if (event.killed) {
          const voice = VOICES[target.state.classId];
          if (voice) this.playCues([{ ...voice.death, volume: (voice.death.volume ?? 1) * VOICE_VOLUME }], position, 0, isSelf);
          if (isSelf) audio.play(ALERTS.death, { priority: true });
        } else this.pain(target, isSelf);
        break;
      }
      case "resurrect": {
        const ability = getAbility(event.abilityId);
        const impact = ABILITY_SOUNDS[event.abilityId]?.impact;
        if (ability && revivesInArea(ability) && impact && !tunedSounds(event.abilityId, "impact")) this.playCues(impact, position);
        break;
      }
      case "heal":
        // Un soin qui ne rend rien (cible pleine, touchée par le Soin de groupe) ne fait pas soupirer.
        if (event.amount !== 0) this.healed(target);
        break;
      case "blocked":
        this.playCues([{ sound: BLOCK_SOUND }], position, melee ? HIT_DELAY : 0);
        break;
      case "evaded":
        this.playAt(EVADE_SOUND, position);
        break;
      case "absorbed":
        this.playAt(ABSORB_SOUND, position);
        break;
      case "cc":
        if (isSelf && CONTROL_ALERTS[event.detail ?? ""]) audio.play(CONTROL_ALERTS[event.detail!], { priority: true });
        break;
    }
  }

  // Signale le retour d'une compétence à longue recharge.
  onCooldown(duration: number) {
    if (duration < READY_SOUND_MIN_COOLDOWN) return;
    this.later(() => audio.play(ALERTS.abilityReady, { priority: true }), duration);
  }

  update(dt: number, players: Iterable<PlayerVisual>, self: PlayerVisual | undefined, phase: MatchPhase, timeLeft: number, winner: number) {
    for (const player of players) {
      this.footsteps(player, player === self, dt);
    }

    // Battement de cœur quand la vie est basse.
    this.heartbeatTimer -= dt;
    const lowHealth = self?.isAlive && self.state.hp / self.state.maxHp < LOW_HEALTH_RATIO;
    if (lowHealth && this.heartbeatTimer <= 0) {
      audio.play(ALERTS.lowHealth, { priority: true });
      this.heartbeatTimer = HEARTBEAT_INTERVAL;
    }

    this.updatePhase(self, phase, timeLeft, winner);
  }

  // Un bruit de pas à chaque foulée parcourue, selon le sol : pavés de la place, herbe, ou terre des chemins.
  private footsteps(player: PlayerVisual, isSelf: boolean, dt: number) {
    const tracked = this.track(player);
    const { x, z } = player.root.position;
    const moved = Math.hypot(x - tracked.x, z - tracked.z);
    tracked.x = x;
    tracked.z = z;
    // Un saut de position (apparition, téléportation) n'est pas un pas.
    if (!player.isAlive || moved > 3) return;
    const speed = moved / Math.max(dt, 1e-3);
    tracked.stride += moved;
    const stride = speed > RUN_SPEED ? RUN_STRIDE : WALK_STRIDE;
    if (tracked.stride < stride) return;
    tracked.stride = 0;
    if (!isSelf && this.distanceToListener(player.root.position) > STEP_RANGE) return;
    const onPlaza = Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.radius;
    const sound: SoundName = onPlaza ? STEP_SOUNDS.stone : isGrass(x, z, 0) ? STEP_SOUNDS.grass : STEP_SOUNDS.dirt;
    this.playAt(sound, player.root.position, isSelf ? STEP_VOLUME_SELF : STEP_VOLUME_OTHERS);
  }

  private track(player: PlayerVisual): Tracked {
    let tracked = this.tracked.get(player.sessionId);
    if (!tracked) {
      const { x, z } = player.root.position;
      tracked = { x, z, stride: 0, lastPain: -Infinity, lastHealed: -Infinity };
      this.tracked.set(player.sessionId, tracked);
    }
    return tracked;
  }

  // Geste de l'arme de l'attaquant.
  private swing(attacker: PlayerVisual) {
    const sound = SWINGS[attacker.state.classId];
    if (sound) this.playAt(sound, attacker.root.position, SWING_VOLUME);
  }

  // Cri de douleur, pas à chaque coup.
  private pain(target: PlayerVisual, isSelf: boolean) {
    const voice = VOICES[target.state.classId];
    const tracked = this.track(target);
    const now = performance.now() / 1000;
    if (!voice || now - tracked.lastPain < PAIN_INTERVAL || Math.random() > PAIN_CHANCE) return;
    tracked.lastPain = now;
    this.playCues([{ sound: voice.pain, volume: VOICE_VOLUME }], target.root.position, HIT_DELAY, isSelf);
  }

  // Soupir de soulagement d'un personnage soigné (seules les voix de femme en ont un).
  private healed(target: PlayerVisual) {
    const voice = VOICES[target.state.classId];
    const tracked = this.track(target);
    const now = performance.now() / 1000;
    if (!voice?.healed || now - tracked.lastHealed < HEALED_INTERVAL) return;
    tracked.lastHealed = now;
    this.playAt(voice.healed, target.root.position, VOICE_VOLUME * HEALED_VOLUME);
  }

  // Compte à rebours des 3 dernières secondes de préparation, début du combat, victoire ou défaite.
  private updatePhase(self: PlayerVisual | undefined, phase: MatchPhase, timeLeft: number, winner: number) {
    if (phase === "preparation") {
      const second = Math.ceil(timeLeft);
      if (second <= 3 && second > 0 && second !== this.lastCountdown) audio.play(ALERTS.countdown, { priority: true });
      this.lastCountdown = second;
    }
    if (phase !== this.lastPhase) {
      if (phase === "fighting" && this.lastPhase === "preparation") audio.play(ALERTS.fightStart, { priority: true });
      if (phase === "ended" && self) audio.play(winner === self.state.team ? ALERTS.win : ALERTS.lose, { priority: true });
      this.lastPhase = phase;
    }
  }

  private distanceToListener(position: Vector3): number {
    const listener = this.camera.camera.target;
    return Math.hypot(position.x - listener.x, position.z - listener.z);
  }

  // Joue une suite de sons à un endroit, après "delay" secondes (la position est relevée au moment de jouer).
  private playCues(cues: Cue[], position: Vector3, delay = 0, priority = false) {
    for (const cue of cues) {
      const wait = delay + (cue.delay ?? 0);
      const play = () => this.playAt(cue.sound, position, cue.volume ?? 1, cue.rate ?? 1, priority);
      if (wait > 0) this.later(play, wait);
      else play();
    }
  }

  // Action différée, oubliée une fois faite (annulée si la partie se termine avant).
  private later(action: () => void, seconds: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      action();
    }, seconds * 1000);
    this.timers.add(timer);
  }

  // Sons des pistes de compétence réglées (voir AbilityEffectPlayer), placés dans l'espace comme les autres.
  readonly sink: SoundSink = {
    play: (recipe, at, { volume, rate, loop, offset }) => {
      const { attenuation, pan } = this.placement(at);
      let stopped = false;
      let handle: { stop(): void } | null = null;
      audio
        .playTrack(recipe, { volume: volume * attenuation, pan, rate, loop, offset })
        .then((h) => {
          handle = h;
          if (stopped) handle?.stop();
        })
        .catch(() => undefined);
      return {
        stop: () => {
          stopped = true;
          handle?.stop();
        },
      };
    },
  };

  // Atténuation avec la distance à la caméra, et position à l'écran (-1 à gauche, 1 à droite).
  private placement(position: Vector3): { attenuation: number; pan: number } {
    const listener = this.camera.camera.target;
    const dx = position.x - listener.x;
    const dz = position.z - listener.z;
    const distance = Math.hypot(dx, dz);
    const attenuation =
      distance <= FULL_VOLUME_DISTANCE
        ? 1
        : Math.max(MIN_DISTANT_VOLUME, 1 - (distance - FULL_VOLUME_DISTANCE) / FADE_DISTANCE);
    // Composante horizontale à l'écran : projection sur l'axe "droite" de la caméra.
    const view = this.camera.camera.getViewMatrix().m;
    const screenX = dx * view[0] + dz * view[8];
    return { attenuation, pan: screenX / PAN_WIDTH };
  }

  // Son placé dans l'espace : à gauche ou à droite selon l'écran, plus faible au loin.
  private playAt(id: SoundName, position: Vector3, volume = 1, rate = 1, priority = false) {
    const listener = this.camera.camera.target;
    const dx = position.x - listener.x;
    const dz = position.z - listener.z;
    const distance = Math.hypot(dx, dz);
    const attenuation =
      distance <= FULL_VOLUME_DISTANCE
        ? 1
        : Math.max(MIN_DISTANT_VOLUME, 1 - (distance - FULL_VOLUME_DISTANCE) / FADE_DISTANCE);
    // Composante horizontale à l'écran : projection sur l'axe "droite" de la caméra.
    const view = this.camera.camera.getViewMatrix().m;
    const screenX = dx * view[0] + dz * view[8];
    audio.play(id, { volume: volume * attenuation, pan: screenX / PAN_WIDTH, rate, priority });
  }
}
