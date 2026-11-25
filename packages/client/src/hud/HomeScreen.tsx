// Écran d'accueil : pseudo, langue, bouton Jouer, crédits (et liens des outils en développement).
import { useState } from "react";
import { NAME_MAX_LENGTH, cleanName } from "@arena/shared";
import { audio } from "../audio/AudioManager";
import { LanguageMenu } from "../LanguageMenu";
import { UI_SOUNDS } from "../game/commonSounds";
import { quote, t } from "../i18n";
import { useHudStore } from "../store";

export function HomeScreen() {
  const joinGame = useHudStore((s) => s.joinGame);
  const playerName = useHudStore((s) => s.playerName);
  const setPlayerName = useHudStore((s) => s.setPlayerName);
  const play = () => {
    if (!playerName) return;
    // Retenu par le navigateur, même s'il s'agit du pseudo proposé par défaut.
    setPlayerName(playerName);
    // Premier clic : le navigateur autorise alors le son.
    audio.unlock();
    audio.play(UI_SOUNDS.click);
    joinGame();
  };
  // Crédits repliés derrière un lien, pour laisser la place à l'illustration.
  const [credits, setCredits] = useState(false);
  return (
    <div className="screen home-screen">
      <LanguageMenu />
      {/* Outils de réglage, en développement seulement (pages absentes de la version de production). */}
      {import.meta.env.DEV && (
        <nav className="home-dev-tools" aria-label="Outils de développement">
          <a href="/animation-lab.html">Éditeur</a>
          <a href="/animations.html">Animations</a>
          <a href="/soundboard.html">Sons</a>
        </nav>
      )}
      <header className="home-title">
        <h1 className="home-logo">Win or Wipe</h1>
        <p className="home-tagline">{t("home.tagline")}</p>
        <p className="home-punchline">{t("home.punchline")}</p>
      </header>
      <form
        className="name-form home-card"
        onSubmit={(event) => {
          event.preventDefault();
          play();
        }}
      >
        <label className="name-label" htmlFor="player-name">
          {t("home.name")}
        </label>
        {/* Seuls les lettres sans accent, les chiffres et le @ passent, 15 au plus (cleanName) ; le reste est ignoré. */}
        <input
          id="player-name"
          className="name-input"
          value={playerName}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setPlayerName(cleanName(event.target.value))}
        />
        <p className="name-hint">{t("home.nameHint", { max: NAME_MAX_LENGTH })}</p>
        <button type="submit" className="primary-button" disabled={!playerName}>
          {t("home.play")}
        </button>
      </form>
      <button
        type="button"
        className="home-credits-toggle"
        aria-expanded={credits}
        aria-controls="home-credits"
        onClick={() => setCredits(!credits)}
        onKeyDown={(event) => event.key === "Escape" && setCredits(false)}
      >
        {t("home.credits")}
      </button>
      {credits && (
        <p id="home-credits" className="credits home-credits">
          {t("home.creditsMusic")} {quote("Woodland Fantasy")}, Matthew Pablo,{" "}
          <a href="https://www.matthewpablo.com" target="_blank" rel="noreferrer">
            matthewpablo.com
          </a>{" "}
          · {quote("The Last Encounter")}, Eric Matyas,{" "}
          <a href="https://soundimage.org" target="_blank" rel="noreferrer">
            soundimage.org
          </a>
          <br />
          {t("home.creditsIcons")} Lorc, Delapouite, Zeromancer, Sbed, Felbrigg, Skoll {t("home.and")} DarkZaitzev,{" "}
          <a href="https://game-icons.net" target="_blank" rel="noreferrer">
            game-icons.net
          </a>{" "}
          (CC BY 3.0)
          <br />
          {t("home.creditsSounds")} {quote("Elemental Magic: Fire Attacks")}, Last Day Dreaming,{" "}
          <a href="https://lastdaydreaming.uwu.ai" target="_blank" rel="noreferrer">
            lastdaydreaming.uwu.ai
          </a>{" "}
          (
          <a href="https://creativecommons.org/licenses/by-nd/4.0/" target="_blank" rel="noreferrer">
            CC BY-ND 4.0
          </a>
          ) · {t("home.creditsVoices")}, Marti Topmade
        </p>
      )}
    </div>
  );
}
