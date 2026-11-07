import { ZZFX } from "zzfx";
import { SOUNDS, type SoundId } from "./sounds";

// Joue les sons du catalogue dans un circuit audio commun (volume général),
// sur lequel viendront s'ajouter les priorités et la spatialisation.
export class AudioManager {
  private context: AudioContext = ZZFX.audioContext;
  private master: GainNode;

  constructor() {
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
  }

  // Les navigateurs bloquent le son tant que l'utilisateur n'a pas interagi avec la page :
  // à appeler lors d'un clic.
  unlock() {
    if (this.context.state === "suspended") void this.context.resume();
  }

  setVolume(volume: number) {
    this.master.gain.value = volume;
  }

  // pan : -1 (gauche) à 1 (droite).
  play(id: SoundId, volume = 1, pan = 0) {
    this.unlock();
    const now = this.context.currentTime;
    for (const step of SOUNDS[id].steps) {
      // ZzFX calcule les échantillons du son ; on les joue nous-mêmes pour garder la main sur le circuit.
      const samples = ZZFX.buildSamples(...step.params);
      const buffer = this.context.createBuffer(1, samples.length, ZZFX.sampleRate);
      buffer.getChannelData(0).set(samples);

      const source = this.context.createBufferSource();
      source.buffer = buffer;
      const gain = this.context.createGain();
      gain.gain.value = volume * ZZFX.volume;
      const panner = new StereoPannerNode(this.context, { pan });
      source.connect(panner).connect(gain).connect(this.master);
      source.start(now + step.at);
    }
  }
}

export const audio = new AudioManager();
