// Petits éléments du HUD : bandeaux de phase et de spectateur, messages, ping, son, aide, roue des ordres.
import { useCallback, useState } from "react";
import { audio } from "../audio/AudioManager";
import { OrderWheelGraphic } from "../OrderWheelGraphic";
import { Tutorial } from "../Tutorial";
import { moveKeys, t } from "../i18n";
import { useHudStore } from "../store";

// Roue des ordres aux bots, ouverte tant que la molette est enfoncée (voir game/OrderWheel.ts), centrée sur la souris.
export function OrderWheelView() {
  const wheel = useHudStore((s) => s.orderWheel);
  if (!wheel) return null;
  return (
    <div className="order-wheel" style={{ left: wheel.x, top: wheel.y }}>
      <OrderWheelGraphic items={wheel.items} selected={wheel.selected} />
    </div>
  );
}

export function PhaseBanner() {
  const match = useHudStore((s) => s.match);
  if (match?.phase !== "preparation") return null;
  return (
    <div className="phase-banner">
      {t("match.preparation")} <strong>{match.timeLeft} s</strong>
    </div>
  );
}

// Mort pendant le combat : on regarde la suite librement, sans brouillard de guerre.
export function SpectatorBanner() {
  const phase = useHudStore((s) => s.match?.phase);
  const dead = useHudStore((s) => (s.self ? s.self.hp <= 0 : false));
  if (phase !== "fighting" || !dead) return null;
  return (
    <div className="phase-banner spectator-banner">
      {t("match.dead")} · <strong>{t("match.spectator")}</strong>
      {t("punct.colon")}
      {t("match.spectatorHint", moveKeys())}
    </div>
  );
}

export function FlashMessage() {
  const message = useHudStore((s) => s.flashMessage);
  if (!message) return null;
  return <div className="flash-message">{message}</div>;
}

export function HintMessage() {
  const hint = useHudStore((s) => s.hint);
  const phase = useHudStore((s) => s.match?.phase);
  if (!hint || phase !== "fighting") return null;
  return <div className="hint-message">{hint}</div>;
}

// Latence, affichée tant qu'on est connecté à une partie : vert jusqu'à 80 ms, orange jusqu'à 150 ms, rouge au-delà.
function PingDisplay() {
  const connected = useHudStore((s) => s.inGame && s.status === "connected");
  const ping = useHudStore((s) => s.ping);
  if (!connected || ping === null) return null;
  const level = ping <= 80 ? "good" : ping <= 150 ? "medium" : "bad";
  return (
    <span className={`ping ping-${level}`} title={t("ping.title")}>
      {t("ping.value", { value: ping })}
    </span>
  );
}

// Volume général et sourdine, mémorisés dans le navigateur.
export function SoundControl() {
  const [settings, setSettings] = useState(audio.settings);
  return (
    <div className="sound-control">
      <PingDisplay />
      <button
        className="sound-toggle"
        title={t(settings.muted ? "sound.unmute" : "sound.mute")}
        onClick={() => {
          audio.setMuted(!settings.muted);
          setSettings(audio.settings);
        }}
      >
        {settings.muted ? "🔇" : "🔊"}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={settings.volume}
        disabled={settings.muted}
        aria-label={t("sound.volume")}
        onChange={(e) => {
          audio.setVolume(Number(e.target.value));
          setSettings(audio.settings);
        }}
      />
    </div>
  );
}

// Aide en partie : le bouton « i » ouvre le didacticiel « Comment jouer ? » du choix de classe (même contenu, décidé le
// 2026-11-22), sur la slide des commandes. Le bouton ne prend pas le focus : le clavier reste au jeu.
export function HelpPanel() {
  const [open, setOpen] = useState(false);
  const classId = useHudStore((s) => s.self?.classId ?? "");
  // Fermée à la fin de la partie : l'écran de fin prend la main (et le focus).
  const ended = useHudStore((s) => s.match?.phase === "ended");
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        className={`help-toggle${open ? " active" : ""}`}
        title={t("help.show")}
        aria-label={t("help.label")}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && !ended && <Tutorial classId={classId} onClose={close} inMatch />}
    </>
  );
}
