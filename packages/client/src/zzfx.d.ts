// Types minimaux pour la bibliothèque ZzFX (synthèse de sons rétro), livrée sans définitions TypeScript.
declare module "zzfx" {
  export const ZZFX: {
    volume: number;
    sampleRate: number;
    audioContext: AudioContext;
    buildSamples(...parameters: (number | undefined)[]): number[];
  };
}
