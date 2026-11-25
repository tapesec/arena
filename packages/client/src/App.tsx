import { useEffect, useState } from "react";
import { audio } from "./audio/AudioManager";
import { EndScreen } from "./EndScreen";
import { GameCanvas } from "./GameCanvas";
import { KillBoard, KillFeed } from "./KillBoard";
import { MUSIC } from "./game/commonSounds";
import { t } from "./i18n";
import { useHudStore } from "./store";
import { HomeScreen } from "./hud/HomeScreen";
import { FlashMessage, HelpPanel, HintMessage, OrderWheelView, PhaseBanner, SoundControl, SpectatorBanner } from "./hud/HudWidgets";
import { ErrorScreen, LoadingScreen, ReplacedScreen } from "./hud/StatusScreens";
import { ClassSelectScreen } from "./hud/ClassSelectScreen";
import { CombatFrames, GroupPanel } from "./hud/UnitFrames";
import { Hotbar } from "./hud/Hotbar";

export function App() {
  const inGame = useHudStore((s) => s.inGame);
  const gameKey = useHudStore((s) => s.gameKey);
  const phase = useHudStore((s) => s.match?.phase);
  // Abonné à la langue : changer de langue sur l'accueil redessine tous les textes.
  const language = useHudStore((s) => s.language);
  // Titre de l'onglet dans la langue choisie (index.html le donne en anglais, pour les liens partagés).
  useEffect(() => {
    document.title = `Win or Wipe — ${t("home.tagline")}`;
  }, [language]);
  useMusic(inGame ? phase : undefined);
  // Le bouton du son reste en bas à droite sur tous les écrans : accueil, attente, choix de classe et partie.
  if (!inGame) {
    return (
      <>
        <HomeScreen />
        <SoundControl />
      </>
    );
  }
  return (
    <>
      {/* La clé change à chaque nouvelle partie : le canvas est recréé et le jeu se reconnecte. */}
      <GameCanvas key={gameKey} />
      <Hud />
      <SoundControl />
    </>
  );
}

// Musique selon le moment : Woodland Fantasy dans les menus (accueil, file d'attente, choix de classe),
// The Last Encounter à partir de la préparation, doucement, puis à volume normal en combat.
// Le navigateur interdit le son avant la première interaction : la musique attend le premier clic ou la première touche.
function useMusic(phase: string | undefined) {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (unlocked) return;
    const unlock = () => {
      audio.unlock();
      // Sons protégés des compétences : prêts avant le premier sort.
      audio.preloadProtected();
      setUnlocked(true);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [unlocked]);
  useEffect(() => {
    if (!unlocked) return;
    if (phase === "preparation" || phase === "ended") void audio.playMusic(MUSIC.match, "soft");
    else if (phase === "fighting") void audio.playMusic(MUSIC.match, "normal");
    else void audio.playMusic(MUSIC.menu, "normal");
  }, [phase, unlocked]);
}

function Hud() {
  const status = useHudStore((s) => s.status);
  const error = useHudStore((s) => s.error);
  const phase = useHudStore((s) => s.match?.phase);
  const loaded = useHudStore((s) => s.loaded);

  if (status === "connecting") return <div className="screen">{t("connect.server")}</div>;
  if (status === "error") return <ErrorScreen message={error} />;
  if (status === "replaced") return <ReplacedScreen />;
  if (!phase) return <div className="screen">{t("connect.match")}</div>;
  if (phase === "classSelect") return <ClassSelectScreen />;
  // Un joueur qui n'a pas fini de charger reste sur l'écran de chargement pendant la préparation.
  if (phase === "loading" || (phase === "preparation" && !loaded)) return <LoadingScreen />;

  return (
    <>
      <div className="hud-frames">
        <GroupPanel />
      </div>
      <PhaseBanner />
      <KillBoard />
      <SpectatorBanner />
      <FlashMessage />
      <HintMessage />
      <div className="hud-bottom">
        <CombatFrames />
        <Hotbar />
      </div>
      {/* En haut à droite : le fil des éliminations, puis l'aide dessous (l'un ne cache pas l'autre). */}
      <div className="hud-right">
        <KillFeed />
        <HelpPanel />
      </div>
      <OrderWheelView />
      {phase === "ended" && <EndScreen />}
    </>
  );
}
