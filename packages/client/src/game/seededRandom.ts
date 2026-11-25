// Suite pseudo-aléatoire reproductible (générateur congruentiel) : une même graine redonne les mêmes tirages, pour qu'un
// effet réglé (taches d'une marque au sol, exemplaires d'un objet) ait toujours la même allure.
export function seededRandom(seed: number): () => number {
  let state = Math.floor(seed * 9301 + 49297) % 233280 || 1;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}
