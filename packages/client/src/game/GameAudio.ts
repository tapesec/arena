import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PLAZA, type CombatEvent, type InterruptEvent, type MatchPhase } from "@arena/shared";
import { audio, type SoundName } from "../audio/AudioManager";
import type { CameraController } from "./CameraController";
import { isGrass } from "./environment";
import type { PlayerVisual } from "./PlayerVisual";
import { PROJECTILE_TRAVEL_TIME } from "./spellFx";

// Un son à jouer, avec son réglage : volume, vitesse de lecture (plus lente = plus grave) et délai en secondes.
interface Cue {
  sound: SoundName;
  volume?: number;
  rate?: number;
  delay?: number;
}

// Sons d'une compétence : au lancement (sur le lanceur) et à l'arrivée (sur la cible).
const ABILITY_SOUNDS: Record<string, { cast?: Cue[]; impact?: Cue[] }> = {
  firebolt: { cast: [{ sound: "spellFire" }], impact: [{ sound: "spellFire", rate: 0.8, volume: 0.9 }] },
  blast: { cast: [{ sound: "spellFire", rate: 0.7 }] },
  freeze: { impact: [{ sound: "spellIce" }] },
  aoeRoot: { impact: [{ sound: "spellIceSnap" }] },
  mez: { impact: [{ sound: "spellFantasy2" }] },
  aoeMez: { impact: [{ sound: "spellFantasy2" }] },
  concentration: { cast: [{ sound: "spellGeneric" }] },
  bubble: { cast: [{ sound: "spellFantasy1", rate: 1.3 }] },
  silence: { impact: [{ sound: "spellFantasy1" }] },
  heal: { impact: [{ sound: "spellHeal" }] },
  groupHeal: { cast: [{ sound: "spellHeal" }] },
  instantHeal: { impact: [{ sound: "spellHeal" }] },
  buffHp: { impact: [{ sound: "spellFantasy0" }] },
  buffStrength: { impact: [{ sound: "spellFantasy0" }] },
  purify: { impact: [{ sound: "spellFantasy4" }] },
  resurrect: { impact: [{ sound: "spellFantasy3" }] },
  speedSong: { cast: [{ sound: "song" }] },
  guard: { impact: [{ sound: "hitWood" }] },
  intercept: { impact: [{ sound: "hitWood" }] },
  shieldBash: { impact: [{ sound: "hitWoodHeavy" }, { sound: "hitSoftHeavy", volume: 0.8 }] },
  evasion: { cast: [{ sound: "evade" }] },
  rage: { cast: [{ sound: "crit" }] },
};
// Attaques au corps à corps : le geste de l'arme chez l'attaquant, puis le coup qui porte chez la cible.
const MELEE_ABILITIES = new Set(["backstab", "flankStrike"]);
// Le coup porte juste après le geste.
const HIT_DELAY = 0.15;
// Un critique (et une attaque dans le dos) sonne plus grave et plus fort.
const HEAVY_HIT: Cue = { sound: "hit", rate: 0.8, volume: 1.3 };
const HIT: Cue = { sound: "hit" };

// Geste de l'arme, selon la classe : épée du Gardien, dagues et bâtons plus légers.
const SWINGS: Record<string, SoundName> = {
  gardien: "swingSword",
  lame: "swingMelee",
  arcaniste: "swingHeavy",
  pretre: "swingHeavy",
  barde: "swingMelee",
};

// Voix des personnages : trois hommes, et une voix de femme différente pour l'Arcaniste et la Prêtre.
// Pas de cri de mort de femme dans les packs : leur cri de douleur, plus grave et plus fort.
interface Voice {
  pain: SoundName;
  death: Cue;
  healed?: SoundName;
}
const MALE: Voice = { pain: "malePain", death: { sound: "maleDeath" } };
const VOICES: Record<string, Voice> = {
  gardien: MALE,
  lame: MALE,
  barde: MALE,
  arcaniste: { pain: "female1Pain", death: { sound: "female1Pain", rate: 0.85, volume: 1.3 }, healed: "female1Healed" },
  pretre: { pain: "female2Pain", death: { sound: "female2Pain", rate: 0.85, volume: 1.3 }, healed: "female2Healed" },
};
const VOICE_VOLUME = 0.7;
// En 8v8, un personnage touché ne crie pas à chaque coup : au plus une fois par intervalle, et pas toujours.
const PAIN_INTERVAL = 1.5;
const PAIN_CHANCE = 0.5;
const HEALED_INTERVAL = 4;

// Pas : longueur d'une foulée en course et en marche (une foulée = un bruit de pas), seuil entre les deux.
const RUN_STRIDE = 2.5;
const WALK_STRIDE = 1;
const RUN_SPEED = 2.5;
const STEP_VOLUME_SELF = 0.35;
const STEP_VOLUME_OTHERS = 0.22;
// Les pas des autres ne s'entendent qu'à proximité.
const STEP_RANGE = 18;

// Contrôles subis par le joueur local : alerte prioritaire.
const CONTROL_ALERTS: Record<string, SoundName> = { mez: "mezzed", root: "rooted", stun: "hitSoftHeavy" };

// Atténuation avec la distance à la caméra : plein volume jusqu'à FULL_VOLUME_DISTANCE, puis décroissance.
const FULL_VOLUME_DISTANCE = 12;
const FADE_DISTANCE = 45;
const MIN_DISTANT_VOLUME = 0.15;
// Écart horizontal (en mètres, vu de la caméra) qui donne un son entièrement à gauche ou à droite.
const PAN_WIDTH = 25;

// Les débuts d'incantation des autres joueurs ne s'entendent qu'à proximité.
const CAST_SOUND_RANGE = 20;

const LOW_HEALTH_RATIO = 0.3;
const HEARTBEAT_INTERVAL = 1.4;
// Seules les compétences à longue recharge signalent leur retour.
const READY_SOUND_MIN_COOLDOWN = 20;

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
  private castingByPlayer = new Map<string, string>();
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
    if (MELEE_ABILITIES.has(abilityId) && caster) this.swing(caster);
    const sounds = ABILITY_SOUNDS[abilityId];
    if (!sounds) return;
    if (sounds.cast && caster) this.playCues(sounds.cast, caster.root.position);
    if (sounds.impact && target) {
      // Un sort à projectile résonne à son arrivée.
      const delay = abilityId === "firebolt" ? PROJECTILE_TRAVEL_TIME : 0;
      this.playCues(sounds.impact, target.root.position, delay);
    }
  }

  onCombat(event: CombatEvent, source: PlayerVisual | undefined, target: PlayerVisual | undefined) {
    if (!target) return;
    const position = target.root.position;
    const isSelf = event.targetId === this.selfId;
    const melee = event.abilityId === "auto" || MELEE_ABILITIES.has(event.abilityId);
    // Auto-attaque : le geste de l'arme, quel que soit le résultat (les compétences le jouent à leur lancement).
    if (event.abilityId === "auto" && source && event.kind !== "heal") this.swing(source);
    switch (event.kind) {
      case "damage": {
        if (melee) {
          const heavy = event.crit || event.abilityId === "backstab";
          this.playCues([heavy ? HEAVY_HIT : HIT], position, HIT_DELAY);
        }
        if (event.killed) {
          const voice = VOICES[target.state.classId];
          if (voice) this.playCues([{ ...voice.death, volume: (voice.death.volume ?? 1) * VOICE_VOLUME }], position, 0, isSelf);
          if (isSelf) audio.play("death", { priority: true });
        } else this.pain(target, isSelf);
        break;
      }
      case "heal":
        this.healed(target);
        break;
      case "blocked":
        this.playCues([{ sound: "hitWood" }], position, melee ? HIT_DELAY : 0);
        break;
      case "evaded":
        this.playAt("evade", position);
        break;
      case "absorbed":
        this.playAt("absorb", position);
        break;
      case "cc":
        if (isSelf && CONTROL_ALERTS[event.detail ?? ""]) audio.play(CONTROL_ALERTS[event.detail!], { priority: true });
        break;
    }
  }

  onInterrupt(event: InterruptEvent) {
    if (event.casterId === this.selfId) audio.play("interrupted", { priority: true });
  }

  // Signale le retour d'une compétence à longue recharge.
  onCooldown(duration: number) {
    if (duration < READY_SOUND_MIN_COOLDOWN) return;
    this.later(() => audio.play("abilityReady", { priority: true }), duration);
  }

  update(dt: number, players: Iterable<PlayerVisual>, self: PlayerVisual | undefined, phase: MatchPhase, timeLeft: number, winner: number) {
    for (const player of players) {
      // Début d'une incantation : la sienne, et celles des autres joueurs proches, plus discrètes
      // (c'est le son le plus fréquent d'un combat de groupe).
      const casting = player.isAlive ? player.state.castAbility : "";
      const previous = this.castingByPlayer.get(player.sessionId) ?? "";
      if (casting && casting !== previous) {
        if (player === self) this.playAt("castStart", player.root.position, 0.6);
        else if (this.distanceToListener(player.root.position) < CAST_SOUND_RANGE) this.playAt("castStart", player.root.position, 0.25);
      }
      this.castingByPlayer.set(player.sessionId, casting);
      this.footsteps(player, player === self, dt);
    }

    // Battement de cœur quand la vie est basse.
    this.heartbeatTimer -= dt;
    const lowHealth = self?.isAlive && self.state.hp / self.state.maxHp < LOW_HEALTH_RATIO;
    if (lowHealth && this.heartbeatTimer <= 0) {
      audio.play("lowHealth", { priority: true });
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
    const sound: SoundName = onPlaza ? "stepStone" : isGrass(x, z, 0) ? "stepGrass" : "stepDirt";
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
    if (sound) this.playAt(sound, attacker.root.position, 0.8);
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
    this.playAt(voice.healed, target.root.position, VOICE_VOLUME * 0.7);
  }

  // Compte à rebours des 3 dernières secondes de préparation, début du combat, victoire ou défaite.
  private updatePhase(self: PlayerVisual | undefined, phase: MatchPhase, timeLeft: number, winner: number) {
    if (phase === "preparation") {
      const second = Math.ceil(timeLeft);
      if (second <= 3 && second > 0 && second !== this.lastCountdown) audio.play("countdown", { priority: true });
      this.lastCountdown = second;
    }
    if (phase !== this.lastPhase) {
      if (phase === "fighting" && this.lastPhase === "preparation") audio.play("fightStart", { priority: true });
      if (phase === "ended" && self) audio.play(winner === self.state.team ? "jingleWin" : "jingleLose", { priority: true });
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
