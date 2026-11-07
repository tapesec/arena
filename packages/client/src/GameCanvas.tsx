import { useEffect, useRef } from "react";
import { Game } from "./game/Game";
import { joinArena } from "./network";
import { useHudStore } from "./store";

// Monte le canvas et démarre le jeu. React ne touche plus à la scène ensuite :
// toute la boucle de rendu vit dans la classe Game.
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let game: Game | null = null;
    const { setStatus } = useHudStore.getState();

    setStatus("connecting");
    joinArena()
      .then((room) => {
        // Le composant a pu être démonté pendant la connexion.
        if (disposed) {
          room.leave();
          return;
        }
        game = new Game(canvasRef.current!, room);
        setStatus("connected");
      })
      .catch((error: unknown) => {
        if (!disposed) setStatus("error", error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      game?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="game-canvas" />;
}
