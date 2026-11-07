import { ZZFX } from "zzfx";
import { SOUNDS, type SoundId } from "./sounds";

// Au-delà de ce nombre de sons en cours, les sons ordinaires sont ignorés (les alertes passent toujours).
const MAX_CONCURRENT_SOUNDS = 12;
// Un même son n'est pas rejoué plus souvent que ça (en secondes) : évite l'effet "mitraillette" en 8v8.
const MIN_REPEAT_INTERVAL = 0.06;

const VOLUME_KEY = "arena.volume";
const MUTED_KEY = "arena.muted";

export interface PlayOptions {
  volume?: number;
  // -1 (gauche) à 1 (droite).
  pan?: number;
  // Alerte qui concerne le joueur : jouée même quand beaucoup de sons sont en cours.
  priority?: boolean;
}

// Joue les sons du catalogue dans un circuit audio commun : volume général, sourdine,
// limite de sons simultanés et anti-répétition.
export class AudioManager {
  private context: AudioContext = ZZFX.audioContext;
  private master: GainNode;
  private activeSounds = 0;
  private lastPlayed = new Map<SoundId, number>();
  private volume: number;
  private muted: boolean;

  constructor() {
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    this.volume = readNumber(VOLUME_KEY, 0.8);
    this.muted = readNumber(MUTED_KEY, 0) === 1;
    this.applyVolume();
  }

  // Les navigateurs bloquent le son tant que l'utilisateur n'a pas interagi avec la page :
  // à appeler lors d'un clic.
  unlock() {
    if (this.context.state === "suspended") void this.context.resume();
  }

  get settings(): { volume: number; muted: boolean } {
    return { volume: this.volume, muted: this.muted };
  }

  setVolume(volume: number) {
    this.volume = volume;
    write(VOLUME_KEY, String(volume));
    this.applyVolume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    write(MUTED_KEY, muted ? "1" : "0");
    this.applyVolume();
  }

  play(id: SoundId, { volume = 1, pan = 0, priority = false }: PlayOptions = {}) {
    if (this.muted || volume <= 0.01) return;
    const now = this.context.currentTime;
    if (!priority) {
      if (this.activeSounds >= MAX_CONCURRENT_SOUNDS) return;
      if (now - (this.lastPlayed.get(id) ?? -Infinity) < MIN_REPEAT_INTERVAL) return;
    }
    this.lastPlayed.set(id, now);

    for (const step of SOUNDS[id].steps) {
      // ZzFX calcule les échantillons du son ; on les joue nous-mêmes pour garder la main sur le circuit.
      const samples = ZZFX.buildSamples(...step.params);
      const buffer = this.context.createBuffer(1, samples.length, ZZFX.sampleRate);
      buffer.getChannelData(0).set(samples);

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      const gain = this.context.createGain();
      gain.gain.value = volume * ZZFX.volume;
      const panner = new StereoPannerNode(this.context, { pan: Math.max(-1, Math.min(1, pan)) });
      source.connect(panner).connect(gain).connect(this.master);

      this.activeSounds++;
      source.onended = () => this.activeSounds--;
      source.start(now + step.at);
    }
  }

  private applyVolume() {
    this.master.gain.value = this.muted ? 0 : this.volume;
  }
}

// Le stockage du navigateur peut être indisponible (navigation privée…) : on s'en passe alors.
function readNumber(key: string, fallback: number): number {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : Number(value);
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Réglage simplement non mémorisé.
  }
}

export const audio = new AudioManager();
