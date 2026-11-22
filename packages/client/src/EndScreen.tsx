import { useEffect, useState } from "react";
import type { MatchSummaryPlayer } from "@arena/shared";
import { audio } from "./audio/AudioManager";
import { SWORDS, classIcon } from "./classIcons";
import { UI_SOUNDS } from "./game/commonSounds";
import { currentLanguage, t } from "./i18n";
import { killIcon, killMove } from "./KillBoard";
import { useHudStore, type SummaryFrame } from "./store";

// Écran de fin (choisi le 2026-11-22, « La Bannière » avec le récap complet) : la bannière du vainqueur se déroule
// (bleue en victoire, rouge en défaite), puis le récap : survivants, durée du combat, coup final, et un tableau par
// équipe (éliminations, dégâts, soins, contrôles) avec le héros de la partie. Le décor se teinte derrière : doré en
// victoire, gris et sombre en défaite. Les musiques de victoire et de défaite restent celles d'avant (GameAudio).

// Attente après la fin de la partie : l'annonce de la dernière élimination (sceau brisé) a le temps de se jouer.
const END_DELAY_MS = 2000;

const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const formatNumber = (n: number) => n.toLocaleString(currentLanguage() === "fr" ? "fr-FR" : "en-US");
const survivors = (count: number) => t(count === 1 ? "end.survivors1" : "end.survivorsN", { count });
const icon = (svg: string, className = "end-icon") => <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;

export function EndScreen() {
  const match = useHudStore((s) => s.match);
  const summary = useHudStore((s) => s.summary);
  const finalKill = useHudStore((s) => s.kills[0]);
  const joinGame = useHudStore((s) => s.joinGame);
  const leaveGame = useHudStore((s) => s.leaveGame);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), END_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!match || !shown) return null;

  const victory = match.winner === match.team;
  const title = t(match.winner === -1 ? "end.draw" : victory ? "end.victory" : "end.defeat");
  const allyRows = summary?.players.filter((p) => p.team === match.team) ?? [];
  const enemyRows = summary?.players.filter((p) => p.team !== match.team) ?? [];
  const alive = (rows: MatchSummaryPlayer[], fallback: number) => (summary ? rows.filter((p) => p.alive).length : fallback);
  const alliesAlive = alive(allyRows, match.alliesAlive);
  const enemiesAlive = alive(enemyRows, match.enemiesAlive);
  const kills = summary?.players.reduce((sum, p) => sum + p.kills, 0) ?? 0;
  const pips = (count: number, size: number, side: string) => (
    <span className={`end-pips ${side}`} aria-hidden="true">
      {Array.from({ length: size }, (_, i) => (
        <i key={i} className={i < count ? "" : "off"} />
      ))}
    </span>
  );

  return (
    <div className={`end-overlay ${victory ? "victory" : "defeat"}`}>
      <div className="end-crest">
        <div className="end-rod" />
        <div className="end-banner">
          <div className="end-emblem">{icon(SWORDS)}</div>
          <h1 className="end-title">{title}</h1>
        </div>
      </div>
      {match.winner !== -1 && (
        <div className="end-sub">{t(victory ? "end.winAlly" : "end.winEnemy", { survivors: survivors(victory ? alliesAlive : enemiesAlive) })}</div>
      )}

      <div className="end-recap">
        <div className="end-facts">
          <div className="end-fact">
            <span className="end-fact-key">{t("end.factSurvivors")}</span>
            <span className="end-fact-value">
              <span className="end-big kill-ally">{alliesAlive}</span>
              {icon(SWORDS)}
              <span className="end-big kill-enemy">{enemiesAlive}</span>
            </span>
            <span className="end-fact-note">
              {pips(alliesAlive, match.teamSize, "kill-ally")} {pips(enemiesAlive, match.teamSize, "kill-enemy")}
            </span>
          </div>
          {summary && (
            <div className="end-fact">
              <span className="end-fact-key">{t("end.factDuration")}</span>
              <span className="end-fact-value">
                <span className="end-big">{formatDuration(summary.seconds)}</span>
              </span>
              <span className="end-fact-note">{t(kills === 1 ? "end.kills1" : "end.killsN", { count: kills })}</span>
            </div>
          )}
          {finalKill && (
            <div className="end-fact">
              <span className="end-fact-key">{t("end.factFinal")}</span>
              <span className="end-fact-value">
                <span className={finalKill.killerAlly ? "kill-ally" : "kill-enemy"}>{finalKill.killerName}</span>
              </span>
              <span className="end-fact-note">
                {icon(killIcon(finalKill.abilityId))} {killMove(finalKill.abilityId)} {t("end.on")}{" "}
                <span className={finalKill.victimAlly ? "kill-ally" : "kill-enemy"}>{finalKill.victimName}</span>
              </span>
            </div>
          )}
        </div>
        {summary && (
          <div className="end-teams">
            <TeamTable title={t("loading.allies")} side="kill-ally" rows={allyRows} survivors={alliesAlive} summary={summary} />
            <TeamTable title={t("loading.enemies")} side="kill-enemy" rows={enemyRows} survivors={enemiesAlive} summary={summary} />
          </div>
        )}
      </div>

      <div className="end-actions">
        <button
          className="end-button"
          onClick={() => {
            audio.play(UI_SOUNDS.click);
            joinGame();
          }}
        >
          {t("end.newMatch")}
        </button>
        <button className="link-button" onClick={leaveGame}>
          {t("end.home")}
        </button>
      </div>
    </div>
  );
}

// Tableau d'une équipe, trié par éliminations puis dégâts ; soi en doré, les morts barrés, le héros signalé.
function TeamTable(props: { title: string; side: string; rows: MatchSummaryPlayer[]; survivors: number; summary: SummaryFrame }) {
  const { title, side, rows, summary } = props;
  const sorted = [...rows].sort((a, b) => b.kills - a.kills || b.damage - a.damage);
  return (
    <div className={`end-team ${side}`}>
      <h2>
        {title} <small>{survivors(props.survivors)}</small>
      </h2>
      <table>
        <thead>
          <tr>
            <th scope="col">{t("end.colPlayer")}</th>
            <th scope="col" title={t("end.colKillsTitle")}>
              {t("end.colKills")}
            </th>
            <th scope="col">{t("end.colDamage")}</th>
            <th scope="col">{t("end.colHealing")}</th>
            <th scope="col" title={t("end.colControlsTitle")}>
              {t("end.colControls")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const hero = p.id === summary.heroId;
            const classes = [p.alive ? "" : "dead", p.id === summary.selfId ? "me" : "", hero ? "hero" : ""].filter(Boolean).join(" ");
            return (
              <tr key={p.id} className={classes}>
                <td className="end-who">
                  {icon(classIcon(p.classId))}
                  <span>{p.name}</span>
                  {hero && <em className="end-hero">{t("end.hero")}</em>}
                </td>
                <td>
                  <b>{p.kills}</b>
                </td>
                <td>{formatNumber(p.damage)}</td>
                <td>{p.healing ? formatNumber(p.healing) : "–"}</td>
                <td>{p.controls}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
