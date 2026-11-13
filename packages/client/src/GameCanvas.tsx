import { useEffect, useRef } from "react";
import { Game } from "./game/Game";
import { joinArena } from "./network";
import { useHudStore } from "./store";

// Monte le canvas et démarre le jeu. React ne touche plus à la scène ensuite :
// toute la boucle de rendu vit dans la classe Game.
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let game: Game | null = null;
    const { setStatus, playerName } = useHudStore.getState();

    setStatus("connecting");
    // Connexion reportée d'un instant : en développement, StrictMode monte le composant, le démonte et le remonte
    // aussitôt. Sans ce délai, le premier montage se connectait quand même puis quittait la salle : un joueur fantôme
    // y prenait la place d'un bot, remplacé à son départ par un autre bot (classe et pseudo différents). Le démontage
    // simulé annule le délai avant que la connexion parte.
    const start = setTimeout(() => {
      joinArena(playerName)
        .then((room) => {
          // Le composant a pu être démonté pendant la connexion.
          if (disposed) {
            room.leave();
            return;
          }
          game = new Game(canvasRef.current!, overlayRef.current!, room);
          setStatus("connected");
        })
        .catch((error: unknown) => {
          if (!disposed) setStatus("error", error instanceof Error ? error.message : String(error));
        });
    }, 0);

    return () => {
      disposed = true;
      clearTimeout(start);
      game?.dispose();
    };
  }, []);

  // La couche "world-overlay" reçoit les textes flottants et indicateurs, gérés par le jeu (pas par React).
  return (
    <div className="game-view">
      <canvas ref={canvasRef} className="game-canvas" />
      <div ref={overlayRef} className="world-overlay" />
    </div>
  );
}
