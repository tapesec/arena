// Rend la main au navigateur le temps d'afficher une image, puis reprend : un long travail découpé ainsi ne fige plus
// l'écran (les personnages du lobby continuent de s'animer pendant que l'arène se prépare). Par message plutôt que par
// minuterie : dans un onglet en arrière-plan, les minuteries ne tournent qu'une fois par seconde, et le chargement
// doit continuer.
export function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}
