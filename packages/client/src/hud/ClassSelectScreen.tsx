// Écran de choix de classe : personnages en 3D (ClassLineup), compétences de chaque classe, équipe et compte à rebours.
import { useCallback, useEffect, useRef, useState } from "react";
import { CLASS_LIST, getAbility, type ClassId } from "@arena/shared";
import { audio } from "../audio/AudioManager";
import { abilityColor, abilityIcon } from "../abilityBar";
import { UI_SOUNDS } from "../game/commonSounds";
import { Tutorial, tutorialSeen } from "../Tutorial";
import { ClassLineup } from "../game/ClassLineup";
import { lobbyReady } from "../game/lobbyPriority";
import { abilityName, className, classRole, classSummary, t } from "../i18n";
import { useHudStore } from "../store";
import { AbilityTooltip } from "./AbilityTooltip";
import { PositionBadge } from "./Hotbar";

// Salle d'attente : chacun choisit sa classe pendant que les joueurs arrivent (ils remplacent des bots). Le chef
// d'équipe choisit la classe des bots de son équipe. La composition adverse reste cachée.
export function ClassSelectScreen() {
  const match = useHudStore((s) => s.match);
  const teammates = useHudStore((s) => s.teammates);
  const actions = useHudStore((s) => s.actions);
  const leaveGame = useHudStore((s) => s.leaveGame);
  const self = teammates.find((mate) => mate.isSelf);
  const myClass = self?.classId ?? "";
  const camp = match?.camp ?? 0;
  // Joueurs de son équipe seulement : le nombre total trahirait combien de bots il y a en face.
  const humans = teammates.filter((mate) => !mate.isBot).length;
  const full = (match?.matchSize ?? 0) > 0 && (match?.playerCount ?? 0) >= (match?.matchSize ?? 0);

  // Didacticiel : ouvert d'office à la première partie (voir Tutorial), puis par le bouton « Comment jouer ? ».
  const [tutorial, setTutorial] = useState(() => !tutorialSeen());
  const closeTutorial = useCallback(() => setTutorial(false), []);

  const timeLeft = match?.timeLeft ?? 0;
  const choose = (classId: ClassId) => {
    audio.play(UI_SOUNDS.classSelect);
    actions?.selectClass(classId);
  };

  return (
    <div className="screen lobby-screen themed-screen">
      <header className="lobby-header">
        <h1>{t("lobby.title")}</h1>
        <div className={`lobby-timer ${timeLeft <= 10 ? "lobby-timer-urgent" : ""}`}>
          <span className="lobby-timer-label">{t("lobby.startsIn")}</span>
          <strong className="lobby-countdown">{timeLeft} s</strong>
        </div>
        <p className="screen-hint">
          {full ? t("lobby.full") : t("lobby.players", { humans, total: teammates.length })}
        </p>
        <button type="button" className="primary-button tutorial-open" onClick={() => setTutorial(true)}>
          {t("tutorial.open")}
        </button>
      </header>
      {tutorial && <Tutorial classId={myClass as ClassId | ""} onClose={closeTutorial} />}
      <div className="lobby-body">
        <ClassLineupView camp={camp} selected={myClass} onSelect={choose} />
        <aside className="roster">
          <h2>{t("lobby.yourTeam")}</h2>
          <div className="roster-lines">
            {teammates.map((mate) => (
              <div key={mate.id} className={`roster-line ${mate.isSelf ? "roster-self" : ""}`}>
                <span className="roster-name">
                  {mate.name}
                  {mate.isSelf && <span className="roster-tag">{t("lobby.you")}</span>}
                  {mate.leader && <span className="roster-tag roster-leader">{t("lobby.leader")}</span>}
                  {mate.isBot && <span className="roster-tag roster-bot">{t("lobby.bot")}</span>}
                </span>
                {mate.isBot && self?.leader ? (
                  <select
                    className="roster-select"
                    value={mate.classId}
                    onChange={(e) => {
                      audio.play(UI_SOUNDS.click);
                      actions?.setBotClass(mate.id, e.target.value as ClassId);
                    }}
                  >
                    {CLASS_LIST.map((c) => (
                      <option key={c.id} value={c.id}>
                        {className(c.id)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong className="roster-class">{className(mate.classId)}</strong>
                )}
              </div>
            ))}
          </div>
          {self?.leader && <p className="screen-hint">{t("lobby.leaderHint")}</p>}
          <p className="screen-hint">{t("lobby.hidden")}</p>
        </aside>
      </div>
      {import.meta.env.DEV && self?.leader && (
        <button className="secondary-button" onClick={() => actions?.forceStart()}>
          {t("lobby.forceStart")}
        </button>
      )}
      <button className="link-button" onClick={leaveGame}>
        {t("lobby.leave")}
      </button>
    </div>
  );
}

// Les classes alignées : en haut leurs personnages en 3D (apparence du camp du joueur, voir ClassLineup), en dessous,
// dans la même colonne, le nom et les compétences (infobulle au survol, la même qu'en jeu). Un clic sur le personnage
// ou sur son nom choisit la classe.
function ClassLineupView({ camp, selected, onSelect }: { camp: number; selected: string; onSelect: (classId: ClassId) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lineupRef = useRef<ClassLineup | null>(null);
  const [hovered, setHovered] = useState(-1);
  const [ready, setReady] = useState(false);

  // Valeurs courantes, pour la scène créée après coup (voir le délai ci-dessous).
  const current = useRef({ selected, hovered });
  current.current = { selected, hovered };

  useEffect(() => {
    setReady(false);
    let lineup: ClassLineup | null = null;
    // Création reportée d'un instant, comme pour le jeu (GameCanvas) : en développement, StrictMode monte, démonte et
    // remonte aussitôt ; le premier montage lancerait sinon des téléchargements pour rien.
    const start = setTimeout(() => {
      try {
        lineup = new ClassLineup(
          canvasRef.current!,
          CLASS_LIST.map((c) => c.id),
          camp,
          () => setReady(true),
        );
      } catch {
        // Pas de WebGL : on choisit sa classe par les noms, sans les personnages (et le jeu n'attend pas).
        setReady(true);
        lobbyReady();
        return;
      }
      lineupRef.current = lineup;
      lineup.setSelected(current.current.selected);
      lineup.setHovered(current.current.hovered);
    }, 0);
    return () => {
      clearTimeout(start);
      lineup?.dispose();
      lineupRef.current = null;
    };
  }, [camp]);

  useEffect(() => lineupRef.current?.setSelected(selected), [selected]);
  useEffect(() => lineupRef.current?.setHovered(hovered), [hovered]);

  // Colonne sous le pointeur, d'après sa position dans le canvas (toutes les colonnes ont la même largeur).
  const columnAt = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * CLASS_LIST.length);
    return index >= 0 && index < CLASS_LIST.length ? index : -1;
  };

  return (
    <div className="lobby-classes">
      <div className="lobby-stage-wrap">
        <canvas
          ref={canvasRef}
          className="lobby-stage"
          aria-hidden="true"
          onMouseMove={(e) => setHovered(columnAt(e))}
          onMouseLeave={() => setHovered(-1)}
          onClick={(e) => {
            const index = columnAt(e);
            if (index >= 0) onSelect(CLASS_LIST[index].id);
          }}
        />
        {!ready && <div className="lobby-loading">{t("lobby.loadingCharacters")}</div>}
      </div>
      <div className="lobby-columns">
        {CLASS_LIST.map((c, index) => (
          <div
            key={c.id}
            className={`lobby-column ${selected === c.id ? "lobby-column-selected" : ""} ${hovered === index ? "lobby-column-hover" : ""}`}
          >
            <button
              className="lobby-class-name"
              aria-pressed={selected === c.id}
              onClick={() => onSelect(c.id)}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(-1)}
            >
              <span className="class-name">{className(c.id)}</span>
              <span className="class-role">{classRole(c.id)}</span>
            </button>
            <p className="lobby-class-summary">{classSummary(c.id)}</p>
            <div className="lobby-abilities">
              {c.abilities.map((abilityId, slot) => (
                <LobbyAbility key={abilityId} abilityId={abilityId} slot={slot} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Icône d'une compétence dans le choix de classe, avec sa touche (comme sur la barre de jeu), un liseré doré pour
// l'ultime, et l'infobulle de la barre de jeu au survol (ou au focus clavier). slot : sa place dans la barre (0 = touche 1).
function LobbyAbility({ abilityId, slot }: { abilityId: string; slot: number }) {
  const [shown, setShown] = useState(false);
  const ability = getAbility(abilityId);
  if (!ability) return null;
  return (
    <div
      className={`slot lobby-ability ${ability.ultimate ? "lobby-ability-ultimate" : ""}`}
      style={{ color: abilityColor(abilityId) }}
      tabIndex={0}
      aria-label={`${(slot + 1) % 10} · ${abilityName(abilityId)}${ability.ultimate ? ` · ${t("lobby.ultimate")}` : ""}`}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
    >
      <span className="slot-icon" dangerouslySetInnerHTML={{ __html: abilityIcon(abilityId) ?? "" }} />
      <span className="slot-key">{(slot + 1) % 10}</span>
      {ability.ultimate && <span className="lobby-ultimate-star" aria-hidden="true">★</span>}
      {ability.position && <PositionBadge position={ability.position} wrong={false} />}
      {shown && <AbilityTooltip ability={ability} tag={ability.ultimate ? t("lobby.ultimate") : undefined} />}
    </div>
  );
}
