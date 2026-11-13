import { useEffect, useId, useRef, useState } from "react";
import { audio } from "./audio/AudioManager";
import { UI_SOUNDS } from "./game/commonSounds";
import { LANGUAGES, t, type Language } from "./i18n";
import { useHudStore } from "./store";

// Choix de la langue, en haut à droite de l'accueil : la langue courante avec son drapeau, et un menu déroulant.
// Se ferme au clic en dehors ou avec Échap.
export function LanguageMenu() {
  const language = useHudStore((s) => s.language);
  const setLanguage = useHudStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // La liste disparaît : le focus revient au bouton plutôt que de partir sur la page.
      buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (id: Language) => {
    setOpen(false);
    if (id === language) return;
    audio.play(UI_SOUNDS.click);
    setLanguage(id);
  };

  return (
    // Pas de fermeture à la perte du focus : sous Safari, un bouton cliqué ne prend pas le focus, et le menu se
    // refermerait avant que le clic sur une langue n'arrive.
    <div className="language-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="language-current"
        aria-label={`${t("home.language")}${t("punct.colon")}${current.label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Flag language={current.id} />
        <span lang={current.id}>{current.label}</span>
        <span className="language-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="language-list" aria-label={t("home.language")}>
          {LANGUAGES.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                className={`language-option${l.id === language ? " selected" : ""}`}
                aria-pressed={l.id === language}
                onClick={() => choose(l.id)}
              >
                <Flag language={l.id} />
                <span lang={l.id}>{l.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Drapeaux dessinés en SVG (les émojis drapeaux ne s'affichent pas sous Windows) : Royaume-Uni et France.
function Flag({ language }: { language: Language }) {
  const id = useId();
  if (language === "fr") {
    return (
      <svg className="flag" viewBox="0 0 3 2" aria-hidden>
        <rect width="1" height="2" fill="#0055a4" />
        <rect x="1" width="1" height="2" fill="#ffffff" />
        <rect x="2" width="1" height="2" fill="#ef4135" />
      </svg>
    );
  }
  return (
    <svg className="flag" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <clipPath id={`${id}-diagonals`}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g>
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${id}-diagonals)`} stroke="#c8102e" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#ffffff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
      </g>
    </svg>
  );
}
