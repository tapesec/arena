// Écrans d'état de la connexion et du chargement : erreur, remplacé par un bot, chargement de la partie.
import { t } from "../i18n";
import { useHudStore } from "../store";

export function ErrorScreen({ message }: { message: string | null }) {
  const leaveGame = useHudStore((s) => s.leaveGame);
  return (
    <div className="screen">
      <p className="hud-error">{t("connect.error", { message: message ?? "" })}</p>
      <button className="primary-button" onClick={leaveGame}>
        {t("connect.back")}
      </button>
    </div>
  );
}

// Chargement trop long : un bot a pris la place du joueur au début du combat.
export function ReplacedScreen() {
  const leaveGame = useHudStore((s) => s.leaveGame);
  return (
    <div className="screen">
      <p className="hud-error">{t("loading.replaced")}</p>
      <button className="primary-button" onClick={leaveGame}>
        {t("connect.back")}
      </button>
    </div>
  );
}

// --- Avant le combat ---

// Écran de chargement : les joueurs des deux équipes (son équipe à gauche), chacun avec sa barre. La partie part quand
// tout le monde a fini, ou au bout d'une minute ; un joueur en retard continue de charger pendant la préparation.
export function LoadingScreen() {
  const match = useHudStore((s) => s.match);
  const loading = useHudStore((s) => s.loading);
  const team = loading.find((p) => p.isSelf)?.team ?? match?.team ?? 0;
  const late = match?.phase === "preparation";
  return (
    <div className="screen themed-screen">
      <h1>{t("loading.title")}</h1>
      <p className="screen-text">
        {late ? t("loading.late") : t("loading.startsIn")} <strong className="lobby-countdown">{match?.timeLeft ?? 0} s</strong>
      </p>
      <p className="screen-hint">{late ? t("loading.lateHint") : t("loading.hint")}</p>
      <div className="loading-teams">
        {[team, 1 - team].map((side) => (
          <div key={side} className="loading-team">
            <h2 className={`team-name ${side === team ? "team-ally" : "team-enemy"}`}>{t(side === team ? "loading.allies" : "loading.enemies")}</h2>
            {loading
              .filter((p) => p.team === side)
              .map((p) => (
                <div key={p.id} className={`loading-line ${p.isSelf ? "roster-self" : ""}`}>
                  <span className="roster-name">
                    {p.name}
                    {p.isSelf && <span className="roster-tag">{t("lobby.you")}</span>}
                    {p.isBot && <span className="roster-tag roster-bot">{t("lobby.bot")}</span>}
                  </span>
                  <span className="loading-bar">
                    <span className={`loading-fill ${p.progress >= 100 ? "loading-done" : ""}`} style={{ width: `${p.progress}%` }} />
                  </span>
                  <span className="loading-percent">{t("loading.percent", { value: p.progress })}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Pendant le combat ---
