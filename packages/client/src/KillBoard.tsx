import { useEffect, useState } from "react";
import { audio } from "./audio/AudioManager";
import { abilityIcon } from "./abilityBar";
import { ALERTS } from "./game/commonSounds";
import { abilityName, t } from "./i18n";
import { useHudStore, type KillFrame } from "./store";

// Annonces d'élimination (décidées le 2026-11-21, style « Entaille » et décompte en chiffres) : en haut, les survivants
// de chaque équipe ; au centre, le nom de la victime tranché par une entaille, avec un tintement de cloche au moment de
// l'entaille ; à droite, le fil des dernières éliminations. Bandeau « Dernier survivant » quand une équipe n'a plus
// qu'un joueur. Son équipe en bleu, celle d'en face en rouge.

// Durée de l'annonce au centre, avant qu'elle ne rejoigne le fil, et instant de l'entaille (calé sur l'animation CSS).
const ANNOUNCE_MS = 2300;
const IMPACT_MS = 220;
// Lignes du fil.
const FEED_SIZE = 5;
// Bandeau « Dernier survivant » : après l'annonce de l'élimination, pendant LAST_STANDING_MS ; tintement un peu après.
const LAST_STANDING_DELAY_MS = 1500;
const LAST_STANDING_MS = 3600;
const LAST_STANDING_BELL_MS = 250;

// Identifiant de l'attaque automatique dans les événements de combat.
const AUTO_ATTACK_ID = "auto";

// Deux épées croisées : séparateur du décompte, et icône de l'attaque automatique.
const SWORDS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M64 32l176 176-32 32L32 64zm384 0L272 208l32 32L480 64zM176 272l-80 80-48-16 16 48-32 32 32 32 32-32 48 16-16-48 80-80zm160 0-32 32 80 80-16 48 48-16 32 32 32-32-32-32 16-48-48 16z"/></svg>';

function killIcon(abilityId: string): string {
  return (abilityId !== AUTO_ATTACK_ID && abilityIcon(abilityId)) || SWORDS;
}

function killMove(abilityId: string): string {
  return abilityId === AUTO_ATTACK_ID ? t("kill.auto") : abilityName(abilityId);
}

const side = (ally: boolean) => (ally ? "kill-ally" : "kill-enemy");

export function KillBoard() {
  const phase = useHudStore((s) => s.match?.phase);
  if (phase !== "fighting" && phase !== "ended") return null;
  return (
    <>
      <KillScore />
      <KillAnnouncements />
    </>
  );
}

// Décompte : gros chiffres qui sautent quand ils baissent, et un losange par joueur qui s'éteint à sa mort.
function KillScore() {
  const allies = useHudStore((s) => s.match?.alliesAlive ?? 0);
  const enemies = useHudStore((s) => s.match?.enemiesAlive ?? 0);
  const size = useHudStore((s) => s.match?.teamSize ?? 0);
  const pips = (alive: number) => Array.from({ length: size }, (_, i) => <i key={i} className={i < alive ? "" : "off"} />);
  // La clé change avec le chiffre : l'animation repart à chaque mort (pas au début du combat, à effectif plein).
  const num = (alive: number, ally: boolean) => (
    <b key={`${ally ? "ally" : "enemy"}-${alive}`} className={`kill-num ${side(ally)}${alive < size ? " hit" : ""}`}>
      {alive}
    </b>
  );
  return (
    <div className="kill-score" role="status" aria-label={t("kill.score", { allies, enemies })}>
      {num(allies, true)}
      <span className="kill-vs" dangerouslySetInnerHTML={{ __html: SWORDS }} />
      {num(enemies, false)}
      <div className="kill-pips kill-ally">{pips(allies)}</div>
      <span />
      <div className="kill-pips kill-enemy">{pips(enemies)}</div>
    </div>
  );
}

function KillAnnouncements() {
  const kills = useHudStore((s) => s.kills);
  // Élimination au centre (la plus récente, tant qu'elle n'a pas fini) ; les autres sont dans le fil.
  const [shown, setShown] = useState<KillFrame | null>(null);
  const [last, setLast] = useState<KillFrame["lastStanding"] | null>(null);
  const latest = kills[0];

  useEffect(() => {
    if (!latest) return;
    // Une nouvelle mort remplace aussitôt l'annonce en cours.
    setShown(latest);
    const bell = setTimeout(() => audio.play(latest.victimAlly ? ALERTS.killAlly : ALERTS.killEnemy, { priority: true }), IMPACT_MS);
    const done = setTimeout(() => setShown(null), ANNOUNCE_MS);
    return () => {
      clearTimeout(bell);
      clearTimeout(done);
    };
  }, [latest]);

  // Le bandeau suit l'annonce de l'élimination ; une autre mort avant qu'il n'apparaisse l'annule (le survivant est
  // peut-être déjà tombé).
  useEffect(() => {
    const standing = latest?.lastStanding;
    if (!standing) return;
    const show = setTimeout(() => setLast(standing), LAST_STANDING_DELAY_MS);
    return () => clearTimeout(show);
  }, [latest]);

  // Une fois affiché, il reste LAST_STANDING_MS, quoi qu'il arrive entre-temps.
  useEffect(() => {
    if (!last) return;
    const bell = setTimeout(() => audio.play(ALERTS.lastStanding, { priority: true }), LAST_STANDING_BELL_MS);
    const hide = setTimeout(() => setLast(null), LAST_STANDING_MS);
    return () => {
      clearTimeout(bell);
      clearTimeout(hide);
    };
  }, [last]);

  const feed = kills.filter((kill) => kill !== shown).slice(0, FEED_SIZE);
  return (
    <>
      {shown && <KillAnnouncement key={shown.id} kill={shown} />}
      <ul className="kill-feed">
        {feed.map((kill) => (
          <li key={kill.id} className={kill.victimAlly ? "ally-fell" : ""}>
            <span className={side(kill.killerAlly)}>{kill.killerName}</span>
            <span className="kill-feed-icon" title={killMove(kill.abilityId)} dangerouslySetInnerHTML={{ __html: killIcon(kill.abilityId) }} />
            <span className={`kill-feed-victim ${side(kill.victimAlly)}`}>{kill.victimName}</span>
          </li>
        ))}
      </ul>
      {last && (
        <div className="kill-last" key={last.name}>
          <div className="kill-last-kicker">{t("kill.lastStanding")}</div>
          <div className={`kill-last-name ${side(last.ally)}`}>{last.name}</div>
          <div className="kill-last-note">{t(last.ally ? "kill.lastAlly" : "kill.lastEnemy")}</div>
        </div>
      )}
    </>
  );
}

// Le nom de la victime en grand, tranché en deux moitiés décalées ; dessous, le tueur et la compétence qui a achevé.
function KillAnnouncement({ kill }: { kill: KillFrame }) {
  return (
    <div className="kill-announce" aria-live="polite">
      <div className={`kill-name ${side(kill.victimAlly)}`}>
        <span className="kill-name-base">{kill.victimName}</span>
        <span className="kill-name-top" aria-hidden="true">
          {kill.victimName}
        </span>
        <span className="kill-name-bottom" aria-hidden="true">
          {kill.victimName}
        </span>
        <span className="kill-slash" />
      </div>
      <div className="kill-by">
        <span className={side(kill.killerAlly)}>{kill.killerName}</span>
        <span className="kill-by-icon" dangerouslySetInnerHTML={{ __html: killIcon(kill.abilityId) }} />
        {killMove(kill.abilityId)}
      </div>
    </div>
  );
}
