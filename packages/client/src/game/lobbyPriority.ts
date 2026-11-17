// Priorité au choix de classe : à l'arrivée dans la salle d'attente, le jeu et l'écran de choix chargent en même temps.
// Le jeu attend donc que les personnages de l'écran de choix soient affichés pour lancer son propre préchargement
// (modèles, décor, sons, musique) : l'écran de choix est prêt bien plus tôt, et le jeu a encore tout le compte à rebours
// et l'écran de chargement pour finir. L'attente est plafonnée, et levée dès que la partie a dépassé le choix de classe.

let release: (() => void) | null = null;

// Promesse tenue quand l'écran de choix a fini d'afficher ses personnages, ou au plus tard après maxMs.
export function waitForLobby(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (release === done) release = null;
      resolve();
    };
    const timer = setTimeout(done, maxMs);
    release = done;
  });
}

// L'écran de choix a fini (personnages affichés, ou impossible à afficher) : le jeu peut charger le reste.
export function lobbyReady() {
  release?.();
}
