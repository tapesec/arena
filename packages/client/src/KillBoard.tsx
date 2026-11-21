import { useEffect, useRef, useState, type CSSProperties } from "react";
import { audio } from "./audio/AudioManager";
import { abilityIcon } from "./abilityBar";
import { ALERTS } from "./game/commonSounds";
import { abilityName, t } from "./i18n";
import { useHudStore, type KillFrame } from "./store";

// Annonces d'élimination (décidées le 2026-11-21, style « Entaille » et décompte en chiffres) : en haut, les survivants
// de chaque équipe ; au centre, le nom de la victime tranché par une entaille, avec un tintement de cloche au moment de
// l'entaille ; à droite, le fil des dernières éliminations (KillFeed, au-dessus du panneau d'aide). Bandeau « Dernier
// survivant » quand une équipe n'a plus qu'un joueur. Son équipe en bleu, celle d'en face en rouge.

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

const inFight = (phase: string | undefined) => phase === "fighting" || phase === "ended";

// Élimination affichée au centre : la plus récente, tant qu'elle a moins de ANNOUNCE_MS. Déduite de son heure
// d'arrivée (pas d'un état à part) : le fil et l'annonce sont toujours d'accord, dès le premier rendu.
function useAnnounced(): KillFrame | null {
  const latest = useHudStore((s) => s.kills[0]);
  const [, refresh] = useState(0);
  const left = latest ? latest.at + ANNOUNCE_MS - performance.now() : 0;
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => refresh((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [latest, left > 0]);
  return latest && left > 0 ? latest : null;
}

export function KillBoard() {
  const phase = useHudStore((s) => s.match?.phase);
  if (!inFight(phase)) return null;
  return (
    <>
      <KillScore />
      <KillAnnouncements />
    </>
  );
}

// Compteur qui augmente chaque fois que value baisse : l'animation de choc repart à chaque mort, pas quand le chiffre
// remonte (résurrection) ni au début du combat.
function useDrops(value: number): number {
  const previous = useRef(value);
  const drops = useRef(0);
  if (value < previous.current) drops.current++;
  previous.current = value;
  return drops.current;
}

// Décompte : gros chiffres qui sautent quand ils baissent, et un losange par joueur qui s'éteint à sa mort.
function KillScore() {
  const allies = useHudStore((s) => s.match?.alliesAlive ?? 0);
  const enemies = useHudStore((s) => s.match?.enemiesAlive ?? 0);
  const size = useHudStore((s) => s.match?.teamSize ?? 0);
  const allyDrops = useDrops(allies);
  const enemyDrops = useDrops(enemies);
  const pips = (alive: number) => Array.from({ length: size }, (_, i) => <i key={i} className={i < alive ? "" : "off"} />);
  const num = (alive: number, ally: boolean, drops: number) => (
    <b key={`${ally ? "ally" : "enemy"}-${drops}`} className={`kill-num ${side(ally)}${drops > 0 ? " hit" : ""}`}>
      {alive}
    </b>
  );
  return (
    <div className="kill-score" role="group" aria-label={t("kill.score", { allies, enemies })}>
      {num(allies, true, allyDrops)}
      <span className="kill-vs" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SWORDS }} />
      {num(enemies, false, enemyDrops)}
      <div className="kill-pips kill-ally" aria-hidden="true">
        {pips(allies)}
      </div>
      <span />
      <div className="kill-pips kill-enemy" aria-hidden="true">
        {pips(enemies)}
      </div>
    </div>
  );
}

function KillAnnouncements() {
  const latest = useHudStore((s) => s.kills[0]);
  const alliesAlive = useHudStore((s) => s.match?.alliesAlive ?? 0);
  const enemiesAlive = useHudStore((s) => s.match?.enemiesAlive ?? 0);
  const shown = useAnnounced();
  const [last, setLast] = useState<KillFrame["lastStanding"] | null>(null);
  // Texte lu par les lecteurs d'écran (région permanente, remplie à chaque annonce).
  const [spoken, setSpoken] = useState("");

  // Tintement au moment de l'entaille.
  useEffect(() => {
    if (!latest || performance.now() - latest.at > IMPACT_MS) return;
    setSpoken(t("kill.spoken", { killer: latest.killerName, victim: latest.victimName, move: killMove(latest.abilityId) }));
    const bell = setTimeout(() => audio.play(latest.victimAlly ? ALERTS.killAlly : ALERTS.killEnemy, { priority: true }), IMPACT_MS);
    return () => clearTimeout(bell);
  }, [latest]);

  // Le bandeau suit l'annonce de l'élimination ; une autre mort avant qu'il n'apparaisse l'annule (le survivant est
  // peut-être déjà tombé).
  useEffect(() => {
    const standing = latest?.lastStanding;
    if (!standing) return;
    const show = setTimeout(() => setLast(standing), LAST_STANDING_DELAY_MS);
    return () => clearTimeout(show);
  }, [latest]);

  // Une fois affiché, il reste LAST_STANDING_MS, quoi qu'il arrive entre-temps…
  useEffect(() => {
    if (!last) return;
    setSpoken(`${t("kill.lastStanding")} : ${last.name}`);
    const bell = setTimeout(() => audio.play(ALERTS.lastStanding, { priority: true }), LAST_STANDING_BELL_MS);
    const hide = setTimeout(() => setLast(null), LAST_STANDING_MS);
    return () => {
      clearTimeout(bell);
      clearTimeout(hide);
    };
  }, [last]);

  // … sauf si son équipe repasse à plusieurs (résurrection).
  const standingStill = last && (last.ally ? alliesAlive : enemiesAlive) <= 1;

  return (
    <>
      {shown && <KillAnnouncement key={shown.id} kill={shown} />}
      {standingStill && (
        <div className="kill-last" key={last.name} aria-hidden="true">
          <div className="kill-last-kicker">{t("kill.lastStanding")}</div>
          <div className={`kill-last-name ${side(last.ally)}`}>{last.name}</div>
          <div className="kill-last-note">{t(last.ally ? "kill.lastAlly" : "kill.lastEnemy")}</div>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {spoken}
      </div>
    </>
  );
}

// Le nom de la victime en grand, tranché en deux moitiés décalées ; dessous, le tueur et la compétence qui a achevé.
// Le nom rétrécit s'il est long, pour ne pas passer sur les cadres en haut à gauche.
function KillAnnouncement({ kill }: { kill: KillFrame }) {
  return (
    <div className="kill-announce" aria-hidden="true">
      <div className={`kill-name ${side(kill.victimAlly)}`} style={{ "--kill-name-length": Math.max(6, kill.victimName.length) } as CSSProperties}>
        <span className="kill-name-base">{kill.victimName}</span>
        <span className="kill-name-top">{kill.victimName}</span>
        <span className="kill-name-bottom">{kill.victimName}</span>
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

// Fil des dernières éliminations (tueur, compétence, victime barrée), sans celle qui est encore annoncée au centre.
// Placé en haut à droite, au-dessus du panneau d'aide (voir .hud-right).
export function KillFeed() {
  const phase = useHudStore((s) => s.match?.phase);
  const kills = useHudStore((s) => s.kills);
  const shown = useAnnounced();
  if (!inFight(phase)) return null;
  const feed = kills.filter((kill) => kill !== shown).slice(0, FEED_SIZE);
  if (!feed.length) return null;
  return (
    <ul className="kill-feed" aria-hidden="true">
      {feed.map((kill) => (
        <li key={kill.id} className={kill.victimAlly ? "ally-fell" : ""}>
          <span className={side(kill.killerAlly)}>{kill.killerName}</span>
          <span className="kill-feed-icon" title={killMove(kill.abilityId)} dangerouslySetInnerHTML={{ __html: killIcon(kill.abilityId) }} />
          <span className={`kill-feed-victim ${side(kill.victimAlly)}`}>{kill.victimName}</span>
        </li>
      ))}
    </ul>
  );
}
