import { useCallback, useEffect, useRef, useState } from "react";
import { CLASS_LIST, EFFECTS, NAME_MAX_LENGTH, cleanName, getAbility, getClass, type AbilityDef, type ClassId } from "@arena/shared";
import { audio } from "./audio/AudioManager";
import { GameCanvas } from "./GameCanvas";
import { LanguageMenu } from "./LanguageMenu";
import { abilityColor, abilityDetails, abilityIcon, abilityStatus } from "./abilityBar";
import { effectIcon } from "./effectIcons";
import { MUSIC, UI_SOUNDS } from "./game/commonSounds";
import { OrderWheelGraphic } from "./OrderWheelGraphic";
import { Tutorial, tutorialSeen } from "./Tutorial";
import { ClassLineup } from "./game/ClassLineup";
import { lobbyReady } from "./game/lobbyPriority";
import { abilityDescription, abilityName, className, classRole, classSummary, effectLabel, formatDecimal, moveKeys, quote, t } from "./i18n";
import { useHudStore, type CastFrame, type EffectFrame, type GroupMemberFrame, type SelfFrame } from "./store";

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

function HomeScreen() {
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
          {t("home.creditsIcons")} Lorc, Delapouite, Zeromancer, Sbed, Felbrigg {t("home.and")} Skoll,{" "}
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
        {/* La fenêtre de groupe suit le panneau du joueur, quelle que soit sa hauteur. */}
        <div className="hud-column">
          <SelfPanel />
          <GroupPanel />
        </div>
        <TargetPanel />
      </div>
      <PhaseBanner />
      <SpectatorBanner />
      <FlashMessage />
      <HintMessage />
      <div className="hud-bottom">
        <SelfAuras />
        <SelfCastBar />
        <SwingBar />
        <Hotbar />
      </div>
      <HelpPanel />
      <OrderWheelView />
      {phase === "ended" && <EndScreen />}
    </>
  );
}

// Roue des ordres aux bots, ouverte tant que la molette est enfoncée (voir game/OrderWheel.ts), centrée sur la souris.
function OrderWheelView() {
  const wheel = useHudStore((s) => s.orderWheel);
  if (!wheel) return null;
  return (
    <div className="order-wheel" style={{ left: wheel.x, top: wheel.y }}>
      <OrderWheelGraphic items={wheel.items} selected={wheel.selected} />
    </div>
  );
}

function teamName(team: number): string {
  return t(team === 0 ? "team.0" : "team.1");
}

function ErrorScreen({ message }: { message: string | null }) {
  const leaveGame = useHudStore((s) => s.leaveGame);
  return (
    <div className="screen">
      <p className="hud-error">{t("connect.error", { message: message ?? "" })}</p>
      <button className="primary-button" onClick={leaveGame}>
        {t("connect.back")}
      </button>
    </div>
  );
}

// Chargement trop long : un bot a pris la place du joueur au début du combat.
function ReplacedScreen() {
  const leaveGame = useHudStore((s) => s.leaveGame);
  return (
    <div className="screen">
      <p className="hud-error">{t("loading.replaced")}</p>
      <button className="primary-button" onClick={leaveGame}>
        {t("connect.back")}
      </button>
    </div>
  );
}

// --- Avant le combat ---

// Salle d'attente : chacun choisit sa classe pendant que les joueurs arrivent (ils remplacent des bots). Le chef
// d'équipe choisit la classe des bots de son équipe. La composition adverse reste cachée.
function ClassSelectScreen() {
  const match = useHudStore((s) => s.match);
  const teammates = useHudStore((s) => s.teammates);
  const actions = useHudStore((s) => s.actions);
  const leaveGame = useHudStore((s) => s.leaveGame);
  const self = teammates.find((mate) => mate.isSelf);
  const myClass = self?.classId ?? "";
  const team = match?.team ?? 0;
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
        <p className="screen-text">
          {t("lobby.team")} <span className={`team-name team-${team}`}>{teamName(team)}</span>
        </p>
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
        <ClassLineupView team={team} selected={myClass} onSelect={choose} />
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
function ClassLineupView({ team, selected, onSelect }: { team: number; selected: string; onSelect: (classId: ClassId) => void }) {
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
          team,
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
  }, [team]);

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

// Infobulle d'une compétence : nom à la couleur de son école, coût, incantation, portée et recharge, description, et la
// raison pour laquelle elle ne part pas (barre de jeu). self : le joueur, pour les valeurs qui dépendent de lui.
// tag : mention à côté du nom (« Ultime » sur l'écran de choix).
function AbilityTooltip({ ability, self, reason, tag }: { ability: AbilityDef; self?: SelfFrame; reason?: string | null; tag?: string }) {
  return (
    <div className="slot-tooltip">
      <div className="tooltip-name" style={{ color: abilityColor(ability.id) }}>
        {abilityName(ability.id)}
        {tag && <span className="tooltip-tag">{tag}</span>}
      </div>
      <div className="tooltip-details">{abilityDetails(ability, self).join(" · ")}</div>
      <div className="tooltip-description">{abilityDescription(ability.id)}</div>
      {reason && <div className="tooltip-reason">{reason}</div>}
    </div>
  );
}

// Écran de chargement : les joueurs des deux équipes (son équipe à gauche), chacun avec sa barre. La partie part quand
// tout le monde a fini, ou au bout d'une minute ; un joueur en retard continue de charger pendant la préparation.
function LoadingScreen() {
  const match = useHudStore((s) => s.match);
  const loading = useHudStore((s) => s.loading);
  const team = loading.find((p) => p.isSelf)?.team ?? match?.team ?? 0;
  const late = match?.phase === "preparation";
  return (
    <div className="screen themed-screen">
      <h1>{t("loading.title")}</h1>
      <p className="screen-text">
        {late ? t("loading.late") : t("loading.startsIn")} <strong className="lobby-countdown">{match?.timeLeft ?? 0} s</strong>
      </p>
      <p className="screen-hint">{late ? t("loading.lateHint") : t("loading.hint")}</p>
      <div className="loading-teams">
        {[team, 1 - team].map((side) => (
          <div key={side} className="loading-team">
            <h2 className={`team-name team-${side}`}>{teamName(side)}</h2>
            {loading
              .filter((p) => p.team === side)
              .map((p) => (
                <div key={p.id} className={`loading-line ${p.isSelf ? "roster-self" : ""}`}>
                  <span className="roster-name">
                    {p.name}
                    {p.isSelf && <span className="roster-tag">{t("lobby.you")}</span>}
                    {p.isBot && <span className="roster-tag roster-bot">{t("lobby.bot")}</span>}
                  </span>
                  <span className="loading-bar">
                    <span className={`loading-fill ${p.progress >= 100 ? "loading-done" : ""}`} style={{ width: `${p.progress}%` }} />
                  </span>
                  <span className="loading-percent">{t("loading.percent", { value: p.progress })}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Pendant le combat ---

function PhaseBanner() {
  const match = useHudStore((s) => s.match);
  if (match?.phase !== "preparation") return null;
  return (
    <div className="phase-banner">
      {t("match.preparation")} <strong>{match.timeLeft} s</strong>
    </div>
  );
}

// Mort pendant le combat : on regarde la suite librement, sans brouillard de guerre.
function SpectatorBanner() {
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

function EndScreen() {
  const match = useHudStore((s) => s.match);
  const joinGame = useHudStore((s) => s.joinGame);
  const leaveGame = useHudStore((s) => s.leaveGame);
  if (!match) return null;
  const title = t(match.winner === -1 ? "end.draw" : match.winner === match.team ? "end.victory" : "end.defeat");
  return (
    <div className="end-overlay">
      <h1>{title}</h1>
      {match.winner !== -1 && <p className="screen-text">{t("end.winner", { team: teamName(match.winner) })}</p>}
      <button
        className="primary-button"
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
  );
}

// Son propre cadre : cliquable pour se cibler (F1 au clavier), par exemple pour se lancer un buff.
function SelfPanel() {
  const self = useHudStore((s) => s.self);
  const actions = useHudStore((s) => s.actions);
  if (!self) return null;
  return (
    <div className="hud-panel unit-frame unit-frame-self" onClick={() => actions?.selectSelf()} title={`${self.name} (F1)`}>
      <div className="unit-name">
        <span>
          {self.name} <span className="unit-class">{self.className}</span>
        </span>
        {self.attacking && <span className="tag tag-attack">{t("frame.attack")}</span>}
        {self.lock === "face" && <span className="tag tag-lock">{t("frame.face")}</span>}
        {self.lock === "stick" && <span className="tag tag-lock">{t("frame.stick")}</span>}
      </div>
      <Bar value={self.hp} max={self.maxHp} kind="hp" deadLabel={t("frame.dead")} />
      {self.maxMana > 0 && <Bar value={self.mana} max={self.maxMana} kind="mana" />}
      {self.maxEndurance > 0 && <Bar value={self.endurance} max={self.maxEndurance} kind="endurance" />}
    </div>
  );
}

function TargetPanel() {
  const target = useHudStore((s) => s.target);
  if (!target) return null;

  let tag = <span className="tag tag-out-range">{target.distance} m</span>;
  if (target.isSelf) tag = <span className="tag tag-out-range">{t("frame.you")}</span>;
  else if (!target.inLineOfSight) tag = <span className="tag tag-blocked">{t("frame.outOfSight")}</span>;
  else if (target.inMeleeRange) tag = <span className="tag tag-in-range">{t("frame.inMelee")}</span>;

  return (
    <div className={`hud-panel unit-frame ${target.isAlly ? "frame-ally" : "frame-enemy"}`}>
      <div className="unit-name">
        <span>
          {target.name} <span className="unit-class">{target.className}</span>
        </span>
        {tag}
      </div>
      <Bar value={target.hp} max={target.maxHp} kind="hp" deadLabel={t("frame.dead")} />
      {target.cast && <CastBar cast={target.cast} />}
      {target.effects.length > 0 && (
        <div className="aura-list">
          {target.effects.map((effect) => (
            <EffectIcon key={`${effect.kind}:${effect.sourceId}`} effect={effect} size="target" timer />
          ))}
        </div>
      )}
    </div>
  );
}

// Fenêtre de groupe : ses coéquipiers, cliquables pour les cibler (F2 à F8 au clavier).
function GroupPanel() {
  const group = useHudStore((s) => s.group);
  const actions = useHudStore((s) => s.actions);
  if (group.length === 0) return null;
  return (
    <div className="hud-panel group-panel">
      {group.map((member, index) => (
        <GroupMember
          key={member.id}
          member={member}
          hotkey={`F${index + 2}`}
          onSelect={() => actions?.selectTarget(member.id)}
        />
      ))}
    </div>
  );
}

function GroupMember({ member, hotkey, onSelect }: { member: GroupMemberFrame; hotkey: string; onSelect: () => void }) {
  const dead = member.hp <= 0;
  const classes = [
    "group-member",
    member.isTarget && "group-member-target",
    dead && "group-member-dead",
    !dead && !member.inRange && "group-member-far",
  ];
  return (
    <div className={classes.filter(Boolean).join(" ")} onClick={onSelect} title={`${member.name} (${hotkey})`}>
      <div className="group-member-header">
        <span className="group-name">{member.name}</span>
        {member.casting && <span className="group-casting">{member.casting}</span>}
        <span className="group-hotkey">{hotkey}</span>
      </div>
      <MiniBar value={member.hp} max={member.maxHp} kind="hp" label={dead ? t("frame.dead") : String(member.hp)} />
      {member.maxMana > 0 && <MiniBar value={member.mana} max={member.maxMana} kind="mana" />}
      {member.maxEndurance > 0 && <MiniBar value={member.endurance} max={member.maxEndurance} kind="endurance" />}
      {!dead && <GroupEffects effects={member.effects} />}
    </div>
  );
}

// Effets d'un coéquipier (décidé le 2026-11-21) : contrôles et affaiblissements en grand sur leur propre ligne (ce qu'il
// faut voir pour réveiller, soigner ou purifier) ; buffs et immunités en petit dessous, les buffs permanents plus petits
// et pâles. Deux effets du même type peuvent coexister (Renouveau de deux Prêtres) : un par lanceur.
function GroupEffects({ effects }: { effects: EffectFrame[] }) {
  if (effects.length === 0) return null;
  const category = (effect: EffectFrame) => EFFECTS[effect.kind]?.category ?? "buff";
  const afflictions = effects.filter((e) => category(e) === "control" || category(e) === "debuff");
  const others = effects
    .filter((e) => category(e) !== "control" && category(e) !== "debuff")
    .sort((a, b) => (a.remaining === null ? 1 : 0) - (b.remaining === null ? 1 : 0));
  return (
    <>
      {afflictions.length > 0 && (
        <div className="group-effects group-afflictions">
          {afflictions.map((effect) => (
            <EffectIcon key={`${effect.kind}:${effect.sourceId}`} effect={effect} size="groupAffliction" />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="group-effects">
          {others.map((effect) => (
            <EffectIcon key={`${effect.kind}:${effect.sourceId}`} effect={effect} size="group" />
          ))}
        </div>
      )}
    </>
  );
}

function MiniBar({ value, max, kind, label }: { value: number; max: number; kind: string; label?: string }) {
  const ratio = max > 0 ? Math.max(0, value / max) : 0;
  return (
    <div className={`mini-bar bar-${kind}`}>
      <div className="bar-fill" style={{ width: `${ratio * 100}%` }} />
      {label && <span className="mini-bar-text">{label}</span>}
    </div>
  );
}

// Effet affiché en icône (celle de la compétence qui le pose), bordée selon sa nature (contrôle, affaiblissement,
// buff, immunité), avec un cadran qui se vide et, sur demande, le compte à rebours dessous ; il clignote dans ses
// dernières secondes. Infobulle : nom, durée restante, qui l'a posé.
const ENDING_SOON = 3;
function EffectIcon({ effect, size, timer = false }: { effect: EffectFrame; size: "self" | "buff" | "target" | "group" | "groupAffliction"; timer?: boolean }) {
  const icon = effectIcon(effect.kind);
  const label = effectLabel(effect.kind);
  const { remaining, duration } = effect;
  const elapsed = remaining !== null && duration ? Math.min(1, Math.max(0, 1 - remaining / duration)) : 0;
  const classes = [
    "aura",
    `aura-size-${size}`,
    `aura-${EFFECTS[effect.kind]?.category ?? "buff"}`,
    remaining === null && "aura-permanent",
    remaining !== null && remaining < ENDING_SOON && "aura-ending",
  ];
  const title = `${label}${remaining !== null ? ` — ${formatRemaining(remaining)}${remaining >= 60 ? "" : " s"}` : ""}${effect.source ? ` (${effect.source})` : ""}`;
  return (
    <span className={classes.filter(Boolean).join(" ")} title={title}>
      <span className="aura-box">
        {icon ? (
          <span className="aura-icon" style={{ color: icon.color }} dangerouslySetInnerHTML={{ __html: icon.svg }} />
        ) : (
          <span className="aura-icon aura-fallback">{label.slice(0, 3)}</span>
        )}
        {elapsed > 0 && <span className="aura-clock" style={{ background: `conic-gradient(rgba(0, 0, 0, 0.65) ${elapsed * 360}deg, transparent 0)` }} />}
      </span>
      {timer && remaining !== null && <span className="aura-time">{formatRemaining(remaining)}</span>}
    </span>
  );
}

// Secondes entières, au dixième dans les dernières secondes, en minutes au-delà d'une minute.
function formatRemaining(seconds: number): string {
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  if (seconds >= ENDING_SOON) return String(Math.ceil(seconds));
  return formatDecimal(seconds, 1);
}

// Ses propres effets, juste au-dessus de la barre d'incantation : contrôles et affaiblissements au plus près (plus
// grands), buffs au-dessus (ceux à durée d'abord, les permanents ensuite). Ses immunités ne sont pas montrées.
function SelfAuras() {
  const effects = useHudStore((s) => s.self?.effects);
  if (!effects) return null;
  const category = (effect: EffectFrame) => EFFECTS[effect.kind]?.category ?? "buff";
  const afflictions = effects.filter((e) => category(e) === "control" || category(e) === "debuff");
  const buffs = effects
    .filter((e) => category(e) === "buff")
    .sort((a, b) => (a.remaining === null ? 1 : 0) - (b.remaining === null ? 1 : 0));
  return (
    <div className="self-auras">
      <div className="aura-row aura-row-buffs">
        {buffs.map((effect) => (
          <EffectIcon key={`${effect.kind}:${effect.sourceId}`} effect={effect} size="buff" timer />
        ))}
      </div>
      <div className="aura-row">
        {afflictions.map((effect) => (
          <EffectIcon key={`${effect.kind}:${effect.sourceId}`} effect={effect} size="self" timer />
        ))}
      </div>
    </div>
  );
}

function Bar({ value, max, kind, deadLabel }: { value: number; max: number; kind: string; deadLabel?: string }) {
  const ratio = max > 0 ? value / max : 0;
  const label = value <= 0 && deadLabel ? deadLabel : `${value} / ${max}`;
  return (
    <div className={`bar bar-${kind}`}>
      <div className="bar-fill" style={{ width: `${ratio * 100}%` }} />
      <span className="bar-text">{label}</span>
    </div>
  );
}

function CastBar({ cast }: { cast: CastFrame }) {
  return (
    <div className="bar bar-cast">
      <div className="bar-fill" style={{ width: `${cast.progress * 100}%` }} />
      <span className="bar-text">{cast.abilityName}</span>
    </div>
  );
}

function SelfCastBar() {
  const cast = useHudStore((s) => s.self?.cast ?? null);
  return <div className="self-cast">{cast && <CastBar cast={cast} />}</div>;
}

// Barre d'action : une case par compétence, avec son icône (couleur de son école), sa touche, sa recharge en cadran
// et son état (utilisable, ressource manquante, hors de portée, mauvaise position…). Survol : infobulle ; clic : lancer.
function Hotbar() {
  const self = useHudStore((s) => s.self);
  const target = useHudStore((s) => s.target);
  const cooldownEnds = useHudStore((s) => s.cooldownEnds);
  const actions = useHudStore((s) => s.actions);
  const now = useNow(Object.values(cooldownEnds).some((end) => end > performance.now()));
  const [hovered, setHovered] = useState<string | null>(null);
  const classDef = self ? getClass(self.classId) : undefined;
  if (!self || !classDef) return null;

  return (
    <div className="hotbar">
      {classDef.abilities.map((abilityId, index) => {
        const ability = getAbility(abilityId);
        if (!ability) return null;
        const remaining = Math.max(0, ((cooldownEnds[abilityId] ?? 0) - now) / 1000);
        const status = abilityStatus(ability, self, target);
        const active = abilityId === self.song;
        // Technique de mêlée en attente du prochain coup d'arme.
        const queued = abilityId === self.queuedAbility;
        // Part du cadran déjà découverte (recharge écoulée), en degrés : elle grandit dans le sens des aiguilles
        // d'une montre à partir de midi, le reste est dans l'ombre.
        const elapsed = remaining > 0 && ability.cooldown > 0 ? (1 - remaining / ability.cooldown) * 360 : 0;
        // Combo possible : son ouverture vient de porter, il peut partir au prochain coup d'arme.
        const comboReady = !!ability.after && ability.after === self.comboAbility && !queued;
        const classes = ["slot", `slot-${status.state}`, active && "slot-active", queued && "slot-queued", comboReady && "slot-combo-ready"];
        return (
          <div
            key={abilityId}
            className={classes.filter(Boolean).join(" ")}
            style={{ color: abilityColor(abilityId) }}
            onClick={() => actions?.castAbility(abilityId)}
            onMouseEnter={() => setHovered(abilityId)}
            onMouseLeave={() => setHovered((h) => (h === abilityId ? null : h))}
          >
            <span className="slot-icon" dangerouslySetInnerHTML={{ __html: abilityIcon(abilityId) ?? "" }} />
            <span className="slot-key">{(index + 1) % 10}</span>
            {ability.cost > 0 && self.song !== abilityId && <span className="slot-cost">{ability.cost}</span>}
            {ability.position && <PositionBadge position={ability.position} wrong={status.state === "position"} />}
            {remaining > 0 && (
              <span className="slot-cooldown" style={{ background: `conic-gradient(transparent ${elapsed}deg, rgba(0, 0, 0, 0.72) 0)` }}>
                {formatCooldown(remaining)}
              </span>
            )}
            {hovered === abilityId && <AbilityTooltip ability={ability} self={self} reason={status.reason} />}
          </div>
        );
      })}
    </div>
  );
}

// Jauge de coup d'arme, au-dessus de la barre, tant que l'attaque automatique est active : elle se remplit jusqu'au
// prochain coup, prend la couleur de la technique en attente (dont l'icône s'affiche au bout), éclate quand l'arme
// frappe, et clignote en rouge, pleine, quand le coup est prêt mais ne peut pas partir (hors de portée, pas de face...).
function SwingBar() {
  const attacking = useHudStore((s) => s.self?.attacking ?? false);
  const queuedAbility = useHudStore((s) => s.self?.queuedAbility ?? "");
  const swing = useHudStore((s) => s.swing);
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  // La jauge avance à chaque image sans repasser par React.
  useEffect(() => {
    if (!attacking || !swing) return;
    let frame = 0;
    const update = () => {
      const duration = swing.end - swing.start;
      const progress = duration > 0 ? Math.min(1, (performance.now() - swing.start) / duration) : 1;
      if (fillRef.current) fillRef.current.style.width = `${progress * 100}%`;
      // Une petite marge couvre le délai du réseau avant que le serveur n'annonce le coup.
      barRef.current?.classList.toggle("swing-late", performance.now() > swing.end + LATE_MARGIN_MS);
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [attacking, swing]);

  if (!attacking || !swing) return null;
  const color = queuedAbility ? abilityColor(queuedAbility) : "#e8e2d0";
  return (
    <div className="swing-bar" ref={barRef}>
      {/* Remonté à chaque coup pour rejouer l'éclat. */}
      <div key={swing.start} className={`swing-fill ${swing.struck ? "swing-struck" : ""}`} ref={fillRef} style={{ background: color }} />
      {queuedAbility && (
        <span className="swing-queued" style={{ color }} dangerouslySetInnerHTML={{ __html: abilityIcon(queuedAbility) ?? "" }} />
      )}
    </div>
  );
}

const LATE_MARGIN_MS = 250;

// Position qu'exige une technique, vue de dessus : la cible (cercle dont la moitié avant, en haut, est pleine)
// et une flèche qui l'atteint par l'arrière (dos) ou par le côté (flanc). Rouge quand on est mal placé.
function PositionBadge({ position, wrong }: { position: "back" | "side"; wrong: boolean }) {
  const back = position === "back";
  const [cx, cy] = back ? [8, 5] : [5, 6.5];
  const r = 3.4;
  return (
    <svg className={`slot-position-badge ${wrong ? "slot-position-wrong" : ""}`} viewBox="0 0 16 16">
      <circle cx={cx} cy={cy} r={r} />
      <path className="slot-position-front" d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy} Z`} />
      {back ? <path d="M8 15.5 V10.6 M6 12.6 L8 10.6 L10 12.6" /> : <path d="M15.5 6.5 H10.6 M12.6 4.5 L10.6 6.5 L12.6 8.5" />}
    </svg>
  );
}

function formatCooldown(seconds: number): string {
  if (seconds >= 60) return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return formatDecimal(seconds, 1);
}

// Rafraîchit l'heure courante 10 fois par seconde, uniquement quand c'est utile.
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(interval);
  }, [active]);
  return active ? now : performance.now();
}

function FlashMessage() {
  const message = useHudStore((s) => s.flashMessage);
  if (!message) return null;
  return <div className="flash-message">{message}</div>;
}

function HintMessage() {
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
function SoundControl() {
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

// L'aide des commandes est ouverte d'office à la première partie jouée dans ce navigateur (décidé le 2026-11-19).
const HELP_SEEN_KEY = "arena.helpSeen";

function helpAlreadySeen(): boolean {
  try {
    return !!localStorage.getItem(HELP_SEEN_KEY);
  } catch {
    // Stockage indisponible : aide fermée, comme avant.
    return true;
  }
}

// Aide des commandes, repliée derrière un bouton « i » (le bouton ne prend pas le focus : le clavier reste au jeu).
function HelpPanel() {
  const [open, setOpen] = useState(() => !helpAlreadySeen());
  // Retenu une fois l'aide affichée (dans un effet : l'initialisation de l'état peut être appelée deux fois).
  useEffect(() => {
    try {
      localStorage.setItem(HELP_SEEN_KEY, "1");
    } catch {
      // Stockage indisponible : rien à retenir.
    }
  }, []);
  return (
    <>
      <button
        className={`help-toggle${open ? " active" : ""}`}
        title={t(open ? "help.hide" : "help.show")}
        aria-label={t("help.label")}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && <HelpContent />}
    </>
  );
}

function HelpContent() {
  const mode = useHudStore((s) => s.movementMode);
  const setMode = useHudStore((s) => s.setMovementMode);
  const modern = mode === "modern";
  return (
    <div className="hud-panel help">
      <div className="help-mode" role="group" aria-label={t("help.movementMode")}>
        {t("help.movementMode")}
        {(["modern", "classic"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`help-mode-button${mode === m ? " active" : ""}`}
            aria-pressed={mode === m}
            // Le bouton ne prend pas le focus : le clavier reste au jeu.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMode(m)}
          >
            {t(m === "modern" ? "help.modeModern" : "help.modeClassic")}
          </button>
        ))}
      </div>
      <div>{t(modern ? "help.moveModern" : "help.move", moveKeys())}</div>
      <div>{t(modern ? "help.mouseModern" : "help.mouse", moveKeys())}</div>
      <div>{t("help.target")}</div>
      <div>{t("help.lock")}</div>
      <div>{t("help.attack")}</div>
      <div>{t("help.abilities")}</div>
      <div>{t("help.orders")}</div>
    </div>
  );
}
