import { ZZFX } from "zzfx";
import commonSoundsFile from "./commonSounds.json";
import samples from "./samples.json";
import { SOUNDS, type SoundId } from "./sounds";
import { assetUrl } from "../assets";
import { parseSoundKey, scramble } from "./scramble";
import { GAME_SOUND } from "./soundEdits";

// Groupe de sons enregistrés (voir samples.json).
export type SampleId = keyof typeof samples.groups;
// Un son du jeu : généré (sounds.ts) ou enregistré (samples.json).
export type SoundName = SoundId | SampleId;

// Son commun remplacé dans l'onglet « Sons communs » de animation-lab.html (commonSounds.json) : un son du catalogue
// (son nom) ou du jeu (« jeu:<id> »), avec son volume, sa vitesse et l'instant où il commence (multipliés par ceux de
// l'appel, sauf skip).
export interface CommonSoundChoice {
  recipe: string;
  volume?: number;
  rate?: number;
  skip?: number;
}
export type CommonSoundChoices = Record<string, CommonSoundChoice>;
// Son commun retiré : plus rien n'est joué à sa place.
export const NO_SOUND = "";
export const COMMON_SOUND_CHOICES = commonSoundsFile as CommonSoundChoices;

// Au-delà de ce nombre de sons en cours, les sons ordinaires sont ignorés (les alertes passent toujours).
export const MAX_CONCURRENT_SOUNDS = 20;
// Un même son n'est pas rejoué plus souvent que ça (en secondes) : évite l'effet "mitraillette" en 8v8.
export const MIN_REPEAT_INTERVAL = 0.06;

const VOLUME_KEY = "arena.volume";
const MUTED_KEY = "arena.muted";

// Clé du conteneur des sons protégés (voir scramble.ts) ; sans elle, ces sons restent muets.
const SOUND_KEY = parseSoundKey(import.meta.env.VITE_SOUND_KEY);

// Sons enregistrés (voir samples.json et scripts/build-sounds.mjs) : un groupe = plusieurs variantes.
const SOUNDS_URL = "sounds/";
// Écart de vitesse de lecture tiré au hasard, pour qu'une même variante ne sonne jamais deux fois pareil.
export const RATE_JITTER = 0.06;
// En dessous de ce niveau, le début d'un son est du silence (ajouté par l'encodeur AAC) : il est sauté.
const SILENCE = 0.002;

// Musiques (voir scripts/build-sounds.mjs) : boucles jouées sur leur durée d'origine.
const MUSIC_URL = "music/";
// Volume de la musique : doux pendant la préparation, normal en combat et dans les menus (sous les bruitages).
export type MusicLevel = "soft" | "normal";
export const MUSIC_LEVELS: Record<MusicLevel, number> = { soft: 0.18, normal: 0.5 };
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
  // Le son lui-même, sans le remplacement choisi dans « Sons communs » (page des sons).
  original?: boolean;
}

// Joue les sons du catalogue dans un circuit audio commun : volume général, sourdine,
// limite de sons simultanés et anti-répétition.
export class AudioManager {
  private context: AudioContext = ZZFX.audioContext;
  private master: GainNode;
  private activeSounds = 0;
  // Clé : identifiant d'un son généré ou d'un groupe de sons enregistrés.
  private lastPlayed = new Map<string, number>();
  // Sons générés sans hasard, mixés une fois (voir fixedBuffer).
  private fixedBuffers = new Map<SoundId, AudioBuffer | null>();
  private volume: number;
  private muted: boolean;
  private mutedKey = MUTED_KEY;
  private variantCounts: Promise<Record<string, number>> | null = null;
  private samples = new Map<string, Promise<Variant[]>>();
  private catalogSounds = new Map<string, Promise<AudioBuffer | null>>();
  private protectedSounds: Promise<Map<string, ArrayBuffer>> | null = null;
  private lastVariant = new Map<string, number>();
  // Morceau en cours : chacun a son propre volume, pour les fondus enchaînés. Sous le volume général.
  private music: MusicTrack | null = null;
  private musicLevel: MusicLevel = "normal";
  private musicIndex: Promise<Record<string, { duration: number }>> | null = null;
  private commonSounds: CommonSoundChoices = COMMON_SOUND_CHOICES;

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
    write(this.mutedKey, muted ? "1" : "0");
    this.applyVolume();
  }

  // Sourdine mémorisée sous une autre clé : l'éditeur (même adresse que le jeu, donc même stockage) a la sienne,
  // indépendante de celle du jeu.
  useMutedKey(key: string) {
    this.mutedKey = key;
    this.muted = readNumber(key, 0) === 1;
    this.applyVolume();
  }

  // Choix des sons communs : ceux du fichier, ou le brouillon de l'éditeur (écoute avant d'enregistrer).
  setCommonSounds(choices: CommonSoundChoices) {
    this.commonSounds = choices;
  }

  play(id: SoundName, options: PlayOptions = {}) {
    const choice = options.original ? undefined : this.commonSounds[id];
    if (choice?.recipe === NO_SOUND) return;
    if (choice) {
      const tuned = { ...options, volume: (options.volume ?? 1) * (choice.volume ?? 1), rate: (options.rate ?? 1) * (choice.rate ?? 1) };
      // Même son, seulement réglé : il garde ses variantes et son écart de vitesse au hasard.
      if (choice.recipe === `${GAME_SOUND}${id}` && !choice.skip) this.playOwn(id, tuned);
      else void this.playTrack(choice.recipe, { ...tuned, offset: choice.skip ?? 0 });
      return;
    }
    this.playOwn(id, options);
  }

  private playOwn(id: SoundName, options: PlayOptions) {
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

    const fixed = this.fixedBuffer(id);
    if (fixed) {
      this.startSynth(fixed, now, volume, pan);
      return;
    }
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

  // Son généré sans hasard (toutes ses notes à 0 de hasard, comme les cloches) : ses notes sont mixées une fois pour
  // toutes dans un seul tampon. Un seul son occupe alors une place de la limite de sons simultanés, et rien n'est
  // recalculé à chaque lecture. null si une note a du hasard (ZzFX en met par défaut quand il n'est pas précisé).
  private fixedBuffer(id: SoundId): AudioBuffer | null {
    const cached = this.fixedBuffers.get(id);
    if (cached !== undefined) return cached;
    const steps = SOUNDS[id].steps;
    let buffer: AudioBuffer | null = null;
    if (steps.length > 1 && steps.every((step) => step.params[1] === 0)) {
      const parts = steps.map((step) => ({ offset: Math.round(step.at * ZZFX.sampleRate), samples: ZZFX.buildSamples(...step.params) }));
      const length = Math.max(...parts.map((part) => part.offset + part.samples.length));
      buffer = this.context.createBuffer(1, length, ZZFX.sampleRate);
      const data = buffer.getChannelData(0);
      for (const { offset, samples } of parts) for (let i = 0; i < samples.length; i++) data[offset + i] += samples[i];
    }
    this.fixedBuffers.set(id, buffer);
    return buffer;
  }

  private startSynth(buffer: AudioBuffer, at: number, volume: number, pan: number) {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = volume * ZZFX.volume;
    const panner = new StereoPannerNode(this.context, { pan: Math.max(-1, Math.min(1, pan)) });
    source.connect(panner).connect(gain).connect(this.master);
    this.activeSounds++;
    source.onended = () => this.activeSounds--;
    source.start(at);
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
  // offset : instant du son où commencer (secondes ; une boucle reprend aussi à cet instant).
  async playTrack(recipe: string, options: PlayOptions & { loop?: boolean; offset?: number } = {}): Promise<{ stop(): void } | null> {
    const { volume = 1, pan = 0, rate = 1, loop = false, offset = 0 } = options;
    if (this.muted || volume <= 0.01) return null;
    if (recipe.startsWith(GAME_SOUND)) {
      const id = recipe.slice(GAME_SOUND.length);
      if (id in SOUNDS) {
        this.playSynth(id as SoundId, options);
        return null;
      }
      const variants = await this.loadSample(id).catch(() => [] as Variant[]);
      const variant = variants[Math.floor(Math.random() * variants.length)];
      return variant ? this.startBuffer(recipe, variant.buffer, variant.start + offset, volume, pan, rate, loop, options.priority) : null;
    }
    const buffer = await this.loadCatalogSound(recipe);
    return buffer ? this.startBuffer(recipe, buffer, soundStart(buffer) + offset, volume, pan, rate, loop, options.priority) : null;
  }

  // Mêmes limites que les autres sons : nombre de sons simultanés, et pas deux fois le même son au même instant (un
  // sort de zone qui touche huit joueurs ne joue son impact qu'une fois).
  // Une alerte (priority) passe toujours, comme les autres sons.
  private startBuffer(id: string, buffer: AudioBuffer, start: number, volume: number, pan: number, rate: number, loop: boolean, priority = false) {
    const now = this.context.currentTime;
    if (!priority) {
      if (this.activeSounds >= MAX_CONCURRENT_SOUNDS) return null;
      if (now - (this.lastPlayed.get(id) ?? -Infinity) < MIN_REPEAT_INTERVAL) return null;
    }
    this.lastPlayed.set(id, now);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    // Une boucle reprend à l'instant choisi, pas au début du fichier.
    if (loop) {
      source.loopStart = Math.min(start, Math.max(0, buffer.duration - 0.05));
      source.loopEnd = buffer.duration;
    }
    source.playbackRate.value = rate;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    const panner = new StereoPannerNode(this.context, { pan: Math.max(-1, Math.min(1, pan)) });
    source.connect(panner).connect(gain).connect(this.master);
    this.activeSounds++;
    source.onended = () => this.activeSounds--;
    source.start(this.context.currentTime, Math.min(start, Math.max(0, buffer.duration - 0.05)));
    return {
      stop: () => {
        // Fondu très bref plutôt qu'une coupure sèche (qui ferait un « clic »).
        gain.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
        source.stop(this.context.currentTime + 0.1);
      },
    };
  }

  // Son du catalogue : en développement, le fichier d'écoute de la page des sons ; sinon, celui converti pour le
  // jeu par scripts/build-sounds.mjs (sons utilisés par les compétences réglées).
  private loadCatalogSound(name: string): Promise<AudioBuffer | null> {
    let loading = this.catalogSounds.get(name);
    if (!loading) {
      const url = import.meta.env.DEV ? `/dev-sounds/${encodeURIComponent(name)}.m4a` : assetUrl(`${SOUNDS_URL}tuned/${name}.m4a`);
      // Jeu publié : un son protégé vient du conteneur brouillé, les autres de leur fichier.
      const fromContainer = import.meta.env.DEV ? Promise.resolve(undefined) : this.loadProtected().then((sounds) => sounds.get(name));
      loading = fromContainer
        .then((data) =>
          data
            ? data.slice(0)
            : fetch(url).then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))),
        )
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

  // Conteneur des sons dont la licence demande d'empêcher l'extraction (scripts/build-sounds.mjs) : chargé une fois,
  // débrouillé en mémoire. Appelé tôt (écran d'accueil) pour qu'il soit prêt au premier sort.
  preloadProtected() {
    if (!import.meta.env.DEV) void this.loadProtected();
  }

  private loadProtected(): Promise<Map<string, ArrayBuffer>> {
    this.protectedSounds ??= fetch(assetUrl(`${SOUNDS_URL}tuned/protected.bin`))
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => {
        const sounds = new Map<string, ArrayBuffer>();
        if (!buffer || buffer.byteLength < 8 || !SOUND_KEY) return sounds;
        const head = new DataView(buffer);
        if (String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3)) !== "ARSP") return sounds;
        const indexLength = head.getUint32(4, true);
        const body = new Uint8Array(buffer.slice(8));
        scramble(body, SOUND_KEY);
        const index = JSON.parse(new TextDecoder().decode(body.subarray(0, indexLength))) as Record<string, [number, number]>;
        for (const [name, [start, length]] of Object.entries(index)) {
          sounds.set(name, body.slice(indexLength + start, indexLength + start + length).buffer);
        }
        return sounds;
      })
      .catch(() => new Map());
    return this.protectedSounds;
  }

  // Écran de chargement : télécharge à l'avance tous les sons du jeu ; track suit chaque téléchargement. Seuls ceux des
  // pistes de compétence (recipes) sont décodés ; les autres sons enregistrés et la musique sont seulement téléchargés
  // (tout décoder garderait des dizaines de Mo en mémoire), le navigateur les reprend de son cache au premier usage.
  preloadGame(recipes: Iterable<string>, music: string[], track: <T>(task: Promise<T>, weight?: number) => Promise<T>) {
    void track(
      this.loadVariantCounts().then((counts) => {
        for (const [id, count] of Object.entries(counts)) {
          for (let i = 0; i < count; i++) void track(fetch(assetUrl(`${SOUNDS_URL}${id}_${i}.m4a`)).then((r) => r.arrayBuffer()));
        }
      }),
    );
    for (const recipe of recipes) {
      if (!recipe.startsWith(GAME_SOUND)) void track(this.loadCatalogSound(recipe));
      else if (!(recipe.slice(GAME_SOUND.length) in SOUNDS)) void track(this.loadSample(recipe.slice(GAME_SOUND.length)));
    }
    for (const id of music) void track(fetch(assetUrl(`${MUSIC_URL}${id}.m4a`)).then((r) => r.arrayBuffer()), 10);
  }

  // Nombre de variantes de chaque groupe de sons. Un échec n'est pas gardé : on réessaiera.
  private loadVariantCounts(): Promise<Record<string, number>> {
    this.variantCounts ??= fetch(assetUrl(`${SOUNDS_URL}index.json`))
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : Promise.reject(new Error(String(r.status)))))
      .catch((error: unknown) => {
        this.variantCounts = null;
        throw error;
      });
    return this.variantCounts;
  }

  // Charge toutes les variantes d'un groupe (une seule fois).
  loadSample(id: string): Promise<Variant[]> {
    let loading = this.samples.get(id);
    if (!loading) {
      // Un échec n'est pas gardé : on réessaiera au prochain usage.
      loading = this.loadVariants(id).catch((error: unknown) => {
        this.samples.delete(id);
        throw error;
      });
      this.samples.set(id, loading);
    }
    return loading;
  }

  private async loadVariants(id: string): Promise<Variant[]> {
    const count = (await this.loadVariantCounts())[id] ?? 0;
    const variants = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const response = await fetch(assetUrl(`${SOUNDS_URL}${id}_${i}.m4a`));
        if (!response.ok) throw new Error(String(response.status));
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

    this.musicIndex ??= fetch(assetUrl(`${MUSIC_URL}index.json`)).then((r) => r.json() as Promise<Record<string, { duration: number }>>);
    const [index, buffer] = await Promise.all([
      this.musicIndex,
      fetch(assetUrl(`${MUSIC_URL}${id}.m4a`))
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
