import { GameCanvas } from "./GameCanvas";
import { useHudStore } from "./store";

export function App() {
  return (
    <>
      <GameCanvas />
      <Hud />
    </>
  );
}

function Hud() {
  const status = useHudStore((s) => s.status);
  const error = useHudStore((s) => s.error);
  const playerCount = useHudStore((s) => s.playerCount);

  return (
    <div className="hud">
      {status === "connecting" && <div>Connexion au serveur…</div>}
      {status === "error" && <div className="hud-error">Connexion impossible : {error}</div>}
      {status === "connected" && (
        <>
          <div>Joueurs connectés : {playerCount}</div>
          <div>Déplacement : ZQSD ou flèches</div>
        </>
      )}
    </div>
  );
}
