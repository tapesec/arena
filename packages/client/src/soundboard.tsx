import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { audio } from "./audio/AudioManager";
import { SOUNDS, type SoundCategory, type SoundId } from "./audio/sounds";
import "./styles.css";

// Page de test des sons (http://localhost:5173/soundboard.html), pour les écouter et les régler
// avant de les brancher dans le jeu.
const CATEGORIES: SoundCategory[] = ["Magie", "Mêlée", "Soutien", "Alertes", "Interface et partie"];

function Soundboard() {
  const [volume, setVolume] = useState(audio.settings.volume);
  const [lastPlayed, setLastPlayed] = useState<SoundId | null>(null);

  const play = (id: SoundId) => {
    audio.play(id, { priority: true });
    setLastPlayed(id);
  };

  return (
    <div className="soundboard">
      <h1>Sons du jeu</h1>
      <p className="screen-hint">
        Sons générés par ZzFX, définis dans <code>src/audio/sounds.ts</code>. Chaque lecture varie légèrement.
      </p>
      <label className="soundboard-volume">
        Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            audio.setVolume(Number(e.target.value));
          }}
        />
      </label>
      {CATEGORIES.map((category) => (
        <section key={category}>
          <h2>{category}</h2>
          <div className="soundboard-grid">
            {(Object.keys(SOUNDS) as SoundId[])
              .filter((id) => SOUNDS[id].category === category)
              .map((id) => (
                <button
                  key={id}
                  className={`sound-button ${lastPlayed === id ? "sound-button-last" : ""}`}
                  onClick={() => play(id)}
                >
                  {SOUNDS[id].label}
                  <span className="sound-id">{id}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Soundboard />
  </StrictMode>,
);
