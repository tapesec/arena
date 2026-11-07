import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { CombatEvent, InterruptEvent, MatchPhase } from "@arena/shared";
import { audio } from "../audio/AudioManager";
import type { SoundId } from "../audio/sounds";
import type { CameraController } from "./CameraController";
import type { PlayerVisual } from "./PlayerVisual";
import { PROJECTILE_TRAVEL_TIME } from "./spellFx";

// Sons d'une compétence : au lancement (sur le lanceur) et à l'arrivée (sur la cible).
const ABILITY_SOUNDS: Record<string, { cast?: SoundId; impact?: SoundId }> = {
  firebolt: { cast: "fireLaunch", impact: "fireImpact" },
  blast: { cast: "fireLaunch", impact: "fireImpact" },
  freeze: { impact: "frost" },
  aoeRoot: { impact: "frost" },
  mez: { impact: "arcane" },
  aoeMez: { impact: "arcane" },
  concentration: { cast: "arcane" },
  silence: { impact: "silence" },
  heal: { impact: "heal" },
  groupHeal: { cast: "heal" },
  instantHeal: { impact: "heal" },
  buffHp: { impact: "buff" },
  buffStrength: { impact: "buff" },
  purify: { impact: "purify" },
  resurrect: { impact: "resurrect" },
  speedSong: { cast: "song" },
  guard: { impact: "block" },
  intercept: { impact: "block" },
  shieldBash: { impact: "shieldBash" },
  backstab: { impact: "backstab" },
  flankStrike: { impact: "swordHit" },
  evasion: { cast: "evade" },
  rage: { cast: "crit" },
};

// Contrôles subis par le joueur local : alerte prioritaire.
const CONTROL_ALERTS: Record<string, SoundId> = { mez: "mezzed", root: "rooted", stun: "shieldBash" };

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

// Traduit les événements de la partie en sons, spatialisés par rapport à la caméra.
export class GameAudio {
  private castingByPlayer = new Map<string, string>();
  private heartbeatTimer = 0;
  private lastPhase: MatchPhase | null = null;
  private lastCountdown = -1;
  private readyTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private camera: CameraController,
    private selfId: string,
  ) {}

  dispose() {
    for (const timer of this.readyTimers) clearTimeout(timer);
  }

  onAbility(abilityId: string, caster: PlayerVisual | undefined, target: PlayerVisual | undefined) {
    const sounds = ABILITY_SOUNDS[abilityId];
    if (!sounds) return;
    if (sounds.cast && caster) this.playAt(sounds.cast, caster.root.position);
    if (sounds.impact && target) {
      // Un sort à projectile résonne à son arrivée.
      const delay = sounds.cast === "fireLaunch" ? PROJECTILE_TRAVEL_TIME * 1000 : 0;
      const position = target.root.position;
      if (delay) setTimeout(() => this.playAt(sounds.impact!, position), delay);
      else this.playAt(sounds.impact, position);
    }
  }

  onCombat(event: CombatEvent, target: PlayerVisual | undefined) {
    if (!target) return;
    const position = target.root.position;
    const isSelf = event.targetId === this.selfId;
    switch (event.kind) {
      case "damage":
        if (event.abilityId === "auto") this.playAt(event.crit ? "crit" : "swordHit", position);
        if (event.killed) {
          if (isSelf) audio.play("death", { priority: true });
          else this.playAt("death", position, 0.6);
        }
        break;
      case "blocked":
        this.playAt("block", position);
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
    this.readyTimers.push(setTimeout(() => audio.play("abilityReady", { priority: true }), duration * 1000));
  }

  update(dt: number, players: Iterable<PlayerVisual>, self: PlayerVisual | undefined, phase: MatchPhase, timeLeft: number, winner: number) {
    // Début d'une incantation : la sienne, et celles des autres joueurs proches, plus discrètes
    // (c'est le son le plus fréquent d'un combat de groupe).
    for (const player of players) {
      const casting = player.isAlive ? player.state.castAbility : "";
      const previous = this.castingByPlayer.get(player.sessionId) ?? "";
      if (casting && casting !== previous) {
        if (player === self) this.playAt("castStart", player.root.position, 0.6);
        else if (this.distanceToListener(player.root.position) < CAST_SOUND_RANGE) this.playAt("castStart", player.root.position, 0.25);
      }
      this.castingByPlayer.set(player.sessionId, casting);
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

  // Compte à rebours des 3 dernières secondes de préparation, début du combat, victoire ou défaite.
  private updatePhase(self: PlayerVisual | undefined, phase: MatchPhase, timeLeft: number, winner: number) {
    if (phase === "preparation") {
      const second = Math.ceil(timeLeft);
      if (second <= 3 && second > 0 && second !== this.lastCountdown) audio.play("countdown", { priority: true });
      this.lastCountdown = second;
    }
    if (phase !== this.lastPhase) {
      if (phase === "fighting" && this.lastPhase === "preparation") audio.play("fightStart", { priority: true });
      if (phase === "ended" && self) audio.play(winner === self.state.team ? "victory" : "defeat", { priority: true });
      this.lastPhase = phase;
    }
  }

  private distanceToListener(position: Vector3): number {
    const listener = this.camera.camera.target;
    return Math.hypot(position.x - listener.x, position.z - listener.z);
  }

  // Son placé dans l'espace : à gauche ou à droite selon l'écran, plus faible au loin.
  private playAt(id: SoundId, position: Vector3, volume = 1) {
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
    audio.play(id, { volume: volume * attenuation, pan: screenX / PAN_WIDTH });
  }
}
