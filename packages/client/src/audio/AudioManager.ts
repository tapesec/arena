import { ZZFX } from "zzfx";
import samples from "./samples.json";
import { SOUNDS, type SoundId } from "./sounds";
import { GAME_SOUND } from "./soundEdits";

// Groupe de sons enregistrés (voir samples.json).
export type SampleId = keyof typeof samples.groups;
// Un son du jeu : généré (sounds.ts) ou enregistré (samples.json).
export type SoundName = SoundId | SampleId;

// Au-delà de ce nombre de sons en cours, les sons ordinaires sont ignorés (les alertes passent toujours).
const MAX_CONCURRENT_SOUNDS = 20;
// Un même son n'est pas rejoué plus souvent que ça (en secondes) : évite l'effet "mitraillette" en 8v8.
const MIN_REPEAT_INTERVAL = 0.06;

const VOLUME_KEY = "arena.volume";
const MUTED_KEY = "arena.muted";

// Sons enregistrés (voir samples.json et scripts/build-sounds.mjs) : un groupe = plusieurs variantes.
const SOUNDS_URL = "/sounds/";
// Écart de vitesse de lecture tiré au hasard, pour qu'une même variante ne sonne jamais deux fois pareil.
const RATE_JITTER = 0.06;
// En dessous de ce niveau, le début d'un son est du silence (ajouté par l'encodeur AAC) : il est sauté.
const SILENCE = 0.002;

// Musiques (voir scripts/build-sounds.mjs) : boucles jouées sur leur durée d'origine.
const MUSIC_URL = "/music/";
// Volume de la musique : doux pendant la préparation, normal en combat et dans les menus (sous les bruitages).
export type MusicLevel = "soft" | "normal";
const MUSIC_LEVELS: Record<MusicLevel, number> = { soft: 0.18, normal: 0.5 };
// Durée des fondus (changement de volume, ou d'un morceau à l'autre).
const MUSIC_FADE = 2;

interface MusicTrack {
  id: string;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
}

interface Variant {
  buffer: AudioBuffer;
  // Début du son, après le silence ajouté par l'encodeur (en secondes).
  start: number;
}

export interface PlayOptions {
  volume?: number;
  // Vitesse de lecture (1 = normale ; plus rapide = plus aigu).
  rate?: number;
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
  // Clé : identifiant d'un son généré ou d'un groupe de sons enregistrés.
  private lastPlayed = new Map<string, number>();
  private volume: number;
  private muted: boolean;
  private variantCounts: Promise<Record<string, number>> | null = null;
  private samples = new Map<string, Promise<Variant[]>>();
  private catalogSounds = new Map<string, Promise<AudioBuffer | null>>();
  private lastVariant = new Map<string, number>();
  // Morceau en cours : chacun a son propre volume, pour les fondus enchaînés. Sous le volume général.
  private music: MusicTrack | null = null;
  private musicLevel: MusicLevel = "normal";
  private musicIndex: Promise<Record<string, { duration: number }>> | null = null;

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

  play(id: SoundName, options: PlayOptions = {}) {
    if (id in SOUNDS) this.playSynth(id as SoundId, options);
    else void this.playSample(id, options);
  }

  private playSynth(id: SoundId, { volume = 1, pan = 0, priority = false }: PlayOptions = {}) {
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

  // Joue une variante, tirée au hasard, d'un groupe de sons enregistrés (chargé au premier usage).
  async playSample(id: string, { volume = 1, pan = 0, priority = false, rate = 1 }: PlayOptions = {}) {
    if (this.muted || volume <= 0.01) return;
    const variants = await this.loadSample(id);
    if (!variants.length) return;
    const now = this.context.currentTime;
    if (!priority) {
      if (this.activeSounds >= MAX_CONCURRENT_SOUNDS) return;
      if (now - (this.lastPlayed.get(id) ?? -Infinity) < MIN_REPEAT_INTERVAL) return;
    }
    this.lastPlayed.set(id, now);

    // Jamais deux fois de suite la même variante.
    let index = Math.floor(Math.random() * variants.length);
    if (variants.length > 1 && index === this.lastVariant.get(id)) index = (index + 1) % variants.length;
    this.lastVariant.set(id, index);
    const variant = variants[index];

    const source = this.context.createBufferSource();
    source.buffer = variant.buffer;
    source.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * RATE_JITTER);
    const gain = this.context.createGain();
    gain.gain.value = volume;
    const panner = new StereoPannerNode(this.context, { pan: Math.max(-1, Math.min(1, pan)) });
    source.connect(panner).connect(gain).connect(this.master);
    this.activeSounds++;
    source.onended = () => this.activeSounds--;
    source.start(now, variant.start);
  }

  // Son d'une piste de compétence (page de réglage) : un groupe du jeu (« jeu:<id> », son généré ou enregistré) ou un
  // son du catalogue (son nom). Rend de quoi l'arrêter (son en boucle), ou null s'il n'est pas joué.
  async playTrack(recipe: string, options: PlayOptions & { loop?: boolean } = {}): Promise<{ stop(): void } | null> {
    const { volume = 1, pan = 0, rate = 1, loop = false } = options;
    if (this.muted || volume <= 0.01) return null;
    if (recipe.startsWith(GAME_SOUND)) {
      const id = recipe.slice(GAME_SOUND.length);
      if (id in SOUNDS) {
        this.playSynth(id as SoundId, options);
        return null;
      }
      const variants = await this.loadSample(id).catch(() => [] as Variant[]);
      const variant = variants[Math.floor(Math.random() * variants.length)];
      return variant ? this.startBuffer(recipe, variant.buffer, variant.start, volume, pan, rate, loop) : null;
    }
    const buffer = await this.loadCatalogSound(recipe);
    return buffer ? this.startBuffer(recipe, buffer, soundStart(buffer), volume, pan, rate, loop) : null;
  }

  // Mêmes limites que les autres sons : nombre de sons simultanés, et pas deux fois le même son au même instant (un
  // sort de zone qui touche huit joueurs ne joue son impact qu'une fois).
  private startBuffer(id: string, buffer: AudioBuffer, start: number, volume: number, pan: number, rate: number, loop: boolean) {
    if (this.activeSounds >= MAX_CONCURRENT_SOUNDS) return null;
    const now = this.context.currentTime;
    if (now - (this.lastPlayed.get(id) ?? -Infinity) < MIN_REPEAT_INTERVAL) return null;
    this.lastPlayed.set(id, now);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    const panner = new StereoPannerNode(this.context, { pan: Math.max(-1, Math.min(1, pan)) });
    source.connect(panner).connect(gain).connect(this.master);
    this.activeSounds++;
    source.onended = () => this.activeSounds--;
    source.start(this.context.currentTime, start);
    return {
      stop: () => {
        // Fondu bref plutôt qu'une coupure sèche.
        gain.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
        source.stop(this.context.currentTime + 0.25);
      },
    };
  }

  // Son du catalogue : en développement, le fichier d'écoute de la page des sons ; sinon, celui converti pour le
  // jeu par scripts/build-sounds.mjs (sons utilisés par les compétences réglées).
  private loadCatalogSound(name: string): Promise<AudioBuffer | null> {
    let loading = this.catalogSounds.get(name);
    if (!loading) {
      const url = import.meta.env.DEV ? `/dev-sounds/${encodeURIComponent(name)}.m4a` : `${SOUNDS_URL}tuned/${encodeURIComponent(name)}.m4a`;
      loading = fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
        .then((data) => this.context.decodeAudioData(data))
        .catch(() => {
          // Un échec n'est pas gardé : on réessaiera.
          this.catalogSounds.delete(name);
          return null;
        });
      this.catalogSounds.set(name, loading);
    }
    return loading;
  }

  // Charge toutes les variantes d'un groupe (une seule fois).
  loadSample(id: string): Promise<Variant[]> {
    let loading = this.samples.get(id);
    if (!loading) {
      loading = this.loadVariants(id);
      this.samples.set(id, loading);
    }
    return loading;
  }

  private async loadVariants(id: string): Promise<Variant[]> {
    this.variantCounts ??= fetch(`${SOUNDS_URL}index.json`).then((r) => r.json() as Promise<Record<string, number>>);
    const count = (await this.variantCounts)[id] ?? 0;
    const variants = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const response = await fetch(`${SOUNDS_URL}${id}_${i}.m4a`);
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        return { buffer, start: soundStart(buffer) };
      }),
    );
    return variants;
  }

  // Joue un morceau en boucle, au niveau demandé, en fondu enchaîné avec le précédent (sans effet s'il joue déjà).
  async playMusic(id: string, level: MusicLevel = this.musicLevel) {
    if (this.music?.id === id) {
      this.setMusicLevel(level);
      return;
    }
    this.musicLevel = level;
    if (this.music) this.fadeOut(this.music);
    const track: MusicTrack = { id, source: null, gain: this.context.createGain() };
    track.gain.gain.value = 0;
    track.gain.connect(this.master);
    this.music = track;

    this.musicIndex ??= fetch(`${MUSIC_URL}index.json`).then((r) => r.json() as Promise<Record<string, { duration: number }>>);
    const [index, buffer] = await Promise.all([
      this.musicIndex,
      fetch(`${MUSIC_URL}${id}.m4a`)
        .then((r) => r.arrayBuffer())
        .then((data) => this.context.decodeAudioData(data)),
    ]);
    // Un autre morceau a été demandé pendant le chargement.
    if (this.music !== track) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    // Boucle sur la durée utile : l'encodeur peut ajouter quelques millisecondes de silence, et un morceau
    // complet se termine par un silence qu'on ne veut pas entendre.
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = Math.min(index[id]?.duration ?? buffer.duration, buffer.duration);
    source.connect(track.gain);
    source.start();
    track.source = source;
    this.setMusicLevel(this.musicLevel);
  }

  // Monte ou baisse la musique en cours, en fondu.
  setMusicLevel(level: MusicLevel) {
    this.musicLevel = level;
    if (this.music) this.ramp(this.music.gain, MUSIC_LEVELS[level]);
  }

  private fadeOut(track: MusicTrack) {
    this.ramp(track.gain, 0);
    setTimeout(() => {
      track.source?.stop();
      track.gain.disconnect();
    }, MUSIC_FADE * 1000);
  }

  private ramp(gain: GainNode, value: number) {
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(value, now + MUSIC_FADE);
  }

  private applyVolume() {
    this.master.gain.value = this.muted ? 0 : this.volume;
  }
}

// Instant où le son commence vraiment, après le silence de tête (un peu avant, pour garder l'attaque).
function soundStart(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  let i = 0;
  while (i < data.length && Math.abs(data[i]) < SILENCE) i++;
  return Math.max(0, i / buffer.sampleRate - 0.003);
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
