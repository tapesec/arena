// Suivi du chargement du jeu (modèles, décor, sons) pour l'écran de chargement : la part des téléchargements
// terminés, envoyée au serveur. Une tâche peut en ajouter d'autres avant de finir (les sons, connus après lecture de
// leur index) : le chargement n'est complet que lorsqu'il ne reste plus rien en cours.
export class LoadingTracker {
  // Somme des poids des tâches (un modèle pèse plus lourd qu'un son).
  private total = 0;
  private done = 0;

  constructor(private onChange: (progress: number) => void) {}

  // Un échec compte comme terminé : un fichier manquant ne doit pas bloquer la partie.
  track<T>(task: Promise<T>, weight = 1): Promise<T> {
    this.total += weight;
    const finish = () => {
      this.done += weight;
      this.onChange(this.progress);
    };
    task.then(finish, finish);
    return task;
  }

  // Entre 0 et 1 (1 : tout est chargé).
  get progress(): number {
    return this.total === 0 ? 1 : this.done / this.total;
  }
}
