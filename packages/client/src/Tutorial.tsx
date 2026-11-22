import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAbility, getClass, ORDERS, ROLL_COOLDOWN, type ClassId } from "@arena/shared";
import { abilityColor, abilityIcon } from "./abilityBar";
import { abilityName, className, moveKeys, t, type TextKey } from "./i18n";
import { OrderWheelGraphic } from "./OrderWheelGraphic";
import { useHudStore } from "./store";

// Didacticiel « Comment jouer ? » (décidé le 2026-11-19) : 3 slides illustrées, ouvertes d'office pendant le choix de
// classe de la première partie (le joueur a alors une minute), puis par le bouton « Comment jouer ? » ; en partie, par
// le bouton « i » (même contenu, décidé le 2026-11-22, sans le temps restant). Le but du jeu,
// les commandes (clavier et souris dessinés, avec les vraies touches) et sa classe avec la roue des ordres aux bots.

const SEEN_KEY = "arena.tutorialSeen";
const SLIDES = 3;

// Déjà vu dans ce navigateur (stockage indisponible : comme déjà vu, pour ne pas l'imposer à chaque partie).
export function tutorialSeen(): boolean {
  try {
    return !!localStorage.getItem(SEEN_KEY);
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Stockage indisponible : rien à retenir.
  }
}

export function Tutorial({ classId, onClose, inMatch = false }: { classId: ClassId | ""; onClose: () => void; inMatch?: boolean }) {
  const [slide, setSlide] = useState(inMatch ? 1 : 0);
  const timeLeft = useHudStore((s) => s.match?.timeLeft ?? 0);
  const setTutorialOpen = useHudStore((s) => s.setTutorialOpen);
  useEffect(() => {
    setTutorialOpen(true);
    return () => setTutorialOpen(false);
  }, [setTutorialOpen]);
  // « Déjà vu » seulement quand le joueur le ferme lui-même : s'il n'a pas eu le temps (partie lancée), il reviendra
  // d'office à la partie suivante.
  const close = useCallback(() => {
    markSeen();
    onClose();
  }, [onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") setSlide((s) => Math.min(SLIDES - 1, s + 1));
      else if (event.key === "ArrowLeft") setSlide((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const last = slide === SLIDES - 1;
  // Rendu directement dans la page : l'écran de choix forme son propre empilement (fond flouté), qui plafonnerait le
  // voile du didacticiel sous les boutons du son et de la langue.
  return createPortal(
    // Fermé par un clic à côté, seulement s'il commence à côté (pas un glisser parti du dialogue).
    <div className="tutorial-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="tutorial" role="dialog" aria-modal="true" aria-label={t("tutorial.title")}>
        <button type="button" className="tutorial-close" aria-label={t("tutorial.close")} onClick={close}>
          ✕
        </button>
        <div className="tutorial-slide">
          {slide === 0 && <GoalSlide />}
          {slide === 1 && <ControlsSlide />}
          {slide === 2 && <ClassSlide classId={classId} />}
        </div>
        <div className="tutorial-nav">
          <button type="button" className="secondary-button" disabled={slide === 0} onClick={() => setSlide(slide - 1)}>
            {t("tutorial.previous")}
          </button>
          <div className="tutorial-dots" role="group" aria-label={t("tutorial.title")}>
            {Array.from({ length: SLIDES }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`tutorial-dot${i === slide ? " active" : ""}`}
                aria-label={t("tutorial.step", { n: i + 1, total: SLIDES })}
                aria-current={i === slide ? "step" : undefined}
                onClick={() => setSlide(i)}
              />
            ))}
          </div>
          {inMatch ? <span className="tutorial-timer" /> : <span className="tutorial-timer">{t("tutorial.timeLeft", { s: timeLeft })}</span>}
          {/* Focus d'office : Entrée avance (Tab est retenu par le jeu et ne déplace pas le focus). */}
          <button type="button" className="primary-button" autoFocus onClick={() => (last ? close() : setSlide(slide + 1))}>
            {t(last ? "tutorial.done" : "tutorial.next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 1. Le but du jeu : deux équipes de 8, la sienne en bleu et celle d'en face en rouge (comme les pseudos), et trois
// règles.
function GoalSlide() {
  const ours = "#6fa3ff";
  const theirs = "#ff6f6f";
  // Deux groupes de 8 pions face à face.
  const pawns = (x: number, color: string) =>
    Array.from({ length: 8 }, (_, i) => (
      <circle key={i} cx={x + (i % 2) * 26} cy={22 + Math.floor(i / 2) * 26} r={10} fill={color} stroke="#000" strokeOpacity={0.4} />
    ));
  return (
    <>
      <h2>{t("tutorial.goal.title")}</h2>
      <svg className="tutorial-art" viewBox="0 0 320 120" role="img" aria-label={t("tutorial.goal.title")}>
        {pawns(40, ours)}
        {pawns(254, theirs)}
        <text x="160" y="72" textAnchor="middle" fontSize="34" fill="#ffd76a" fontWeight="700">
          ⚔
        </text>
      </svg>
      <ul className="tutorial-points">
        <li>{t("tutorial.goal.wipe")}</li>
        <li>{t("tutorial.goal.noRespawn")}</li>
        <li>{t("tutorial.goal.group")}</li>
      </ul>
    </>
  );
}

function Key({ label, wide, accent }: { label: string; wide?: boolean; accent?: boolean }) {
  return <kbd className={`tutorial-key${wide ? " wide" : ""}${accent ? " accent" : ""}`}>{label}</kbd>;
}

// 2. Les commandes : touches de déplacement (celles du clavier du joueur), Tab, 1 à 8, R, et la souris.
function ControlsSlide() {
  const keys = moveKeys();
  const mode = useHudStore((s) => s.movementMode);
  const setMode = useHudStore((s) => s.setMovementMode);
  const modern = mode === "modern";
  return (
    <>
      <h2>{t("tutorial.controls.title")}</h2>
      {/* Le réglage du déplacement (avant dans l'aide du combat) : ici, avant comme pendant la partie. */}
      <div className="tutorial-mode" role="group" aria-label={t("help.movementMode")}>
        {t("help.movementMode")}
        {(["modern", "classic"] as const).map((m) => (
          <button key={m} type="button" className={`help-mode-button${mode === m ? " active" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {t(m === "modern" ? "help.modeModern" : "help.modeClassic")}
          </button>
        ))}
      </div>
      <div className="tutorial-controls">
        <div className="tutorial-keyboard">
          <div className="tutorial-keygroup">
            <div className="tutorial-keys">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <Key key={n} label={String(n)} accent />
              ))}
            </div>
            <span>{t("tutorial.controls.abilities")}</span>
          </div>
          <div className="tutorial-keyrow">
            <div className="tutorial-keygroup">
              <div className="tutorial-move">
                <Key label={keys.up} accent />
                <div className="tutorial-keys">
                  <Key label={keys.left} accent />
                  <Key label={keys.down} accent />
                  <Key label={keys.right} accent />
                </div>
              </div>
              <span>{t(modern ? "tutorial.controls.moveModern" : "tutorial.controls.moveClassic")}</span>
            </div>
            <div className="tutorial-keygroup">
              <Key label="Tab" wide />
              <span>{t("tutorial.controls.tab")}</span>
            </div>
            <div className="tutorial-keygroup">
              <Key label="R" />
              <span>{t("tutorial.controls.attack")}</span>
            </div>
          </div>
          <div className="tutorial-keyrow">
            <div className="tutorial-keygroup">
              <Key label={t("roll.key")} wide />
              <span>{t("tutorial.controls.roll", { s: ROLL_COOLDOWN })}</span>
            </div>
            <div className="tutorial-keygroup">
              <div className="tutorial-keys">
                <Key label="F" />
                <Key label="C" />
              </div>
              <span>{t("tutorial.controls.lock")}</span>
            </div>
            <div className="tutorial-keygroup">
              <Key label="F1" wide />
              <span>{t("tutorial.controls.self")}</span>
            </div>
            <div className="tutorial-keygroup">
              <Key label={t("tutorial.controls.escapeKey")} wide />
              <span>{t("tutorial.controls.escape")}</span>
            </div>
            <div className="tutorial-keygroup">
              <Key label="V" />
              <span>{t("tutorial.controls.recenter")}</span>
            </div>
          </div>
        </div>
        <div className="tutorial-mouse-block">
          <MouseArt highlight={null} />
          <ul className="tutorial-points small">
            <li>{t("tutorial.controls.leftClick")}</li>
            <li>{t(modern ? "tutorial.controls.rightClick" : "tutorial.controls.rightClickClassic", keys)}</li>
            <li>{t("tutorial.controls.zoom")}</li>
            <li>{t("tutorial.controls.wheel")}</li>
          </ul>
        </div>
      </div>
      <p className="tutorial-note">{t("tutorial.controls.auto")}</p>
    </>
  );
}

// Souris dessinée : boutons gauche et droit, molette ; highlight : la partie mise en avant.
function MouseArt({ highlight }: { highlight: "wheel" | null }) {
  return (
    <svg className="tutorial-mouse" viewBox="0 0 80 120" aria-hidden="true">
      <rect x="6" y="6" width="68" height="108" rx="34" fill="#2a2f3a" stroke="#9aa3b5" strokeWidth="2" />
      <line x1="40" y1="6" x2="40" y2="52" stroke="#9aa3b5" strokeWidth="2" />
      <line x1="6" y1="52" x2="74" y2="52" stroke="#9aa3b5" strokeWidth="2" />
      <rect
        x="34"
        y="16"
        width="12"
        height="24"
        rx="6"
        fill={highlight === "wheel" ? "#ffd76a" : "#4a5162"}
        stroke={highlight === "wheel" ? "#fff6d8" : "#9aa3b5"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

// 3. Sa classe (sa barre de compétences, l'ultime en 8) et la roue des ordres aux bots.
function ClassSlide({ classId }: { classId: ClassId | "" }) {
  const classDef = classId ? getClass(classId) : undefined;
  const resource = classDef?.resource === "endurance" ? "order.resourceEndurance" : "order.resourceMana";
  // « Protège-moi » ne sert pas à un Gardien (grisé, comme en jeu).
  const items = ORDERS.map((id) => ({
    id,
    label: t((id === "resource" ? resource : `order.${id}`) as TextKey),
    enabled: !(id === "protect" && classId === "gardien"),
  }));
  return (
    <>
      <h2>{t("tutorial.class.title")}</h2>
      {classDef && (
        <div className="tutorial-class">
          <div className="tutorial-class-name">{className(classDef.id)}</div>
          <div className="tutorial-bar">
            {classDef.abilities.map((abilityId, i) => (
              <div key={abilityId} className={`tutorial-ability${getAbility(abilityId)?.ultimate ? " ultimate" : ""}`} title={abilityName(abilityId)}>
                <span className="tutorial-icon" style={{ color: abilityColor(abilityId) }} dangerouslySetInnerHTML={{ __html: abilityIcon(abilityId) ?? "" }} />
                <Key label={String(i + 1)} accent />
              </div>
            ))}
          </div>
          <p className="tutorial-note">{t("tutorial.class.bar")}</p>
        </div>
      )}
      <div className="tutorial-orders">
        <div className="tutorial-wheel" aria-hidden="true">
          <div className="order-wheel tutorial-wheel-inner">
            <OrderWheelGraphic items={items} selected={ORDERS.indexOf("heal")} />
          </div>
        </div>
        <div className="tutorial-mouse-block">
          <MouseArt highlight="wheel" />
          <ul className="tutorial-points small">
            <li>{t("tutorial.class.wheel1")}</li>
            <li>{t("tutorial.class.wheel2")}</li>
            <li>{t("tutorial.class.wheel3")}</li>
          </ul>
        </div>
      </div>
    </>
  );
}
