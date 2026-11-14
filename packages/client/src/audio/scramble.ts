// Brouille (ou débrouille : même opération) le conteneur des sons protégés (licence : empêcher l'extraction), par une
// suite pseudo-aléatoire tirée de la clé. Même suite que scramble() de scripts/build-sounds.mjs.
//
// La clé n'est pas dans le dépôt (public) : VITE_SOUND_KEY, dans packages/client/.env.local sur le poste et en
// secret de la CI pour le build de production.
export function scramble(bytes: Uint8Array, key: number) {
  let state = key >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[i] ^= state & 0xff;
  }
}

// Clé valide : un entier de 32 bits non nul (« 0x1234abcd » ou décimal), éventuellement entre guillemets (.env).
export function parseSoundKey(value: string | undefined): number | null {
  const key = Number(value?.trim().replace(/^(["'])(.*)\1$/, "$2"));
  return Number.isInteger(key) && key > 0 && key <= 0xffffffff ? key : null;
}
