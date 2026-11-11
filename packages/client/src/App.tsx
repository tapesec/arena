import { useEffect, useRef, useState } from "react";
import { CLASS_LIST, EFFECTS, TEAM_NAMES, getAbility, getClass } from "@arena/shared";
import { audio } from "./audio/AudioManager";
import { GameCanvas } from "./GameCanvas";
import { abilityColor, abilityDetails, abilityIcon, abilityStatus } from "./abilityBar";
import { CLASS_BADGES } from "./game/classBadges";
import { MUSIC, UI_SOUNDS } from "./game/commonSounds";
import { useHudStore, type CastFrame, type EffectFrame, type GroupMemberFrame } from "./store";

export function App() {
  const inGame = useHudStore((s) => s.inGame);
  const gameKey = useHudStore((s) => s.gameKey);
  const phase = useHudStore((s) => s.match?.phase);
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
  return (
    <div className="screen">
      <h1>Arena</h1>
      <p className="screen-text">Combat de groupe 8 contre 8</p>
      <button
        className="primary-button"
        onClick={() => {
          // Premier clic : le navigateur autorise alors le son.
          audio.unlock();
          audio.play(UI_SOUNDS.click);
          joinGame();
        }}
      >
        Rejoindre une partie
      </button>
      <p className="credits">
        Musiques : « Woodland Fantasy », Matthew Pablo,{" "}
        <a href="https://www.matthewpablo.com" target="_blank" rel="noreferrer">
          matthewpablo.com
        </a>{" "}
        · « The Last Encounter », Eric Matyas,{" "}
        <a href="https://soundimage.org" target="_blank" rel="noreferrer">
          soundimage.org
        </a>
        <br />
        Icônes : Lorc, Delapouite, Zeromancer, Sbed, Felbrigg et Skoll,{" "}
        <a href="https://game-icons.net" target="_blank" rel="noreferrer">
          game-icons.net
        </a>{" "}
        (CC BY 3.0)
        <br />
        Sons : « Elemental Magic: Fire Attacks », Last Day Dreaming,{" "}
        <a href="https://lastdaydreaming.uwu.ai" target="_blank" rel="noreferrer">
          lastdaydreaming.uwu.ai
        </a>{" "}
        (
        <a href="https://creativecommons.org/licenses/by-nd/4.0/" target="_blank" rel="noreferrer">
          CC BY-ND 4.0
        </a>
        ) · voix de combat, Marti Topmade
      </p>
    </div>
  );
}

function Hud() {
  const status = useHudStore((s) => s.status);
  const error = useHudStore((s) => s.error);
  const phase = useHudStore((s) => s.match?.phase);

  if (status === "connecting") return <div className="screen">Connexion au serveur…</div>;
  if (status === "error") return <ErrorScreen message={error} />;
  if (!phase || phase === "waiting") return <WaitingScreen />;
  if (phase === "classSelect") return <ClassSelectScreen />;

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
      <div className="hud-bottom">
        <SelfCastBar />
        <SwingBar />
        <Hotbar />
      </div>
      <CombatLog />
      <HelpPanel />
      {phase === "ended" && <EndScreen />}
    </>
  );
}

function ErrorScreen({ message }: { message: string | null }) {
  const leaveGame = useHudStore((s) => s.leaveGame);
  return (
    <div className="screen">
      <p className="hud-error">Connexion impossible : {message}</p>
      <button className="primary-button" onClick={leaveGame}>
        Retour
      </button>
    </div>
  );
}

// --- Avant le combat ---

function WaitingScreen() {
  const match = useHudStore((s) => s.match);
  const actions = useHudStore((s) => s.actions);
  const leaveGame = useHudStore((s) => s.leaveGame);
  const count = match?.playerCount ?? 0;
  return (
    <div className="screen">
      <h1>En attente de joueurs</h1>
      <p className="screen-text">
        {count} / {match?.matchSize ?? "?"} joueurs
      </p>
      <p className="screen-hint">La partie commence dès qu'elle est complète.</p>
      {import.meta.env.DEV && (
        <div className="button-row">
          <button className="secondary-button" disabled={count < 2} onClick={() => actions?.forceStart()}>
            Lancer maintenant (test)
          </button>
          <button className="secondary-button" onClick={() => actions?.addBots()}>
            Compléter avec des bots
          </button>
        </div>
      )}
      <button className="link-button" onClick={leaveGame}>
        Quitter la file
      </button>
    </div>
  );
}

function ClassSelectScreen() {
  const match = useHudStore((s) => s.match);
  const teammates = useHudStore((s) => s.teammates);
  const actions = useHudStore((s) => s.actions);
  const myClass = teammates.find((t) => t.isSelf)?.classId ?? "";
  const team = match?.team ?? 0;

  return (
    <div className="screen">
      <h1>Choisissez votre classe</h1>
      <p className="screen-text">
        Équipe <span className={`team-name team-${team}`}>{TEAM_NAMES[team]}</span> · {match?.timeLeft ?? 0} s
      </p>
      <div className="class-list">
        {CLASS_LIST.map((c) => (
          <button
            key={c.id}
            className={`class-card ${myClass === c.id ? "class-card-selected" : ""}`}
            onClick={() => {
              audio.play(UI_SOUNDS.classSelect);
              actions?.selectClass(c.id);
            }}
          >
            <span className="class-name">{c.name}</span>
            <span className="class-role">{c.role}</span>
            <span className="class-stats">
              {c.maxHp} PV · {c.resource === "mana" ? "Mana" : "Endurance"}
            </span>
            <span className="class-abilities">{c.abilities.map((id) => getAbility(id)?.name).join(" · ")}</span>
          </button>
        ))}
      </div>
      <div className="roster">
        <h2>Votre équipe</h2>
        {teammates.map((t, i) => (
          <div key={i} className="roster-line">
            {t.name}
            {t.isSelf && " (vous)"} :{" "}
            <strong>{t.classId ? getClass(t.classId)?.name : t.isBot ? "choix automatique" : "…"}</strong>
          </div>
        ))}
        <p className="screen-hint">La composition adverse reste cachée jusqu'à la rencontre.</p>
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
      Préparation : le combat commence dans <strong>{match.timeLeft} s</strong>
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
      Vous êtes mort · <strong>Mode spectateur</strong> : ZQSD déplace la caméra, V revient à votre corps
    </div>
  );
}

function EndScreen() {
  const match = useHudStore((s) => s.match);
  const joinGame = useHudStore((s) => s.joinGame);
  const leaveGame = useHudStore((s) => s.leaveGame);
  if (!match) return null;
  const title = match.winner === -1 ? "Égalité" : match.winner === match.team ? "Victoire !" : "Défaite";
  return (
    <div className="end-overlay">
      <h1>{title}</h1>
      {match.winner !== -1 && <p className="screen-text">Les {TEAM_NAMES[match.winner]} remportent la partie.</p>}
      <button
        className="primary-button"
        onClick={() => {
          audio.play(UI_SOUNDS.click);
          joinGame();
        }}
      >
        Nouvelle partie
      </button>
      <button className="link-button" onClick={leaveGame}>
        Retour à l'accueil
      </button>
    </div>
  );
}

function SelfPanel() {
  const self = useHudStore((s) => s.self);
  if (!self) return null;
  return (
    <div className="hud-panel unit-frame">
      <div className="unit-name">
        <span>
          {self.name} <span className="unit-class">{self.className}</span>
        </span>
        {self.attacking && <span className="tag tag-attack">Attaque</span>}
        {self.lock === "face" && <span className="tag tag-lock">Face</span>}
        {self.lock === "stick" && <span className="tag tag-lock">Stick</span>}
      </div>
      <Bar value={self.hp} max={self.maxHp} kind="hp" deadLabel="Mort" />
      {self.maxMana > 0 && <Bar value={self.mana} max={self.maxMana} kind="mana" />}
      {self.maxEndurance > 0 && <Bar value={self.endurance} max={self.maxEndurance} kind="endurance" />}
      <EffectList effects={self.effects} />
    </div>
  );
}

function TargetPanel() {
  const target = useHudStore((s) => s.target);
  if (!target) return null;

  let tag = <span className="tag tag-out-range">{target.distance} m</span>;
  if (target.isSelf) tag = <span className="tag tag-out-range">Vous</span>;
  else if (!target.inLineOfSight) tag = <span className="tag tag-blocked">Hors de vue</span>;
  else if (!target.isAlly && !target.facing) tag = <span className="tag tag-blocked">Pas en face</span>;
  else if (target.inMeleeRange) tag = <span className="tag tag-in-range">Au contact</span>;

  return (
    <div className={`hud-panel unit-frame ${target.isAlly ? "frame-ally" : "frame-enemy"}`}>
      <div className="unit-name">
        <span>
          {target.name} <span className="unit-class">{target.className}</span>
        </span>
        {tag}
      </div>
      <Bar value={target.hp} max={target.maxHp} kind="hp" deadLabel="Mort" />
      {target.cast && <CastBar cast={target.cast} />}
      <EffectList effects={target.effects} />
    </div>
  );
}

// Libellés courts des effets, pour la fenêtre de groupe (le libellé complet est en infobulle).
const SHORT_EFFECT_LABELS: Record<string, string> = {
  mez: "Mez",
  stun: "Stun",
  root: "Root",
  snare: "Ral",
  immuneMez: "iMez",
  immuneStun: "iStun",
  immuneRoot: "iRoot",
  evasion: "Év",
  rage: "Rage",
  concentration: "Conc",
  guarded: "Gard",
  intercept: "Int",
  buffHp: "PV",
  buffStrength: "For",
  speed: "Vit",
  regenAura: "Aura",
  bubble: "Bul",
  taunted: "Prov",
  halted: "Arrêt",
  magicImmune: "iMag",
  rampart: "Remp",
  meleeImmune: "iCaC",
};

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
  const badge = member.classId ? CLASS_BADGES[member.classId] : undefined;
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
        {badge && (
          <span className="group-badge" style={{ background: badge.color }}>
            <svg viewBox="0 0 24 24" width="11" height="11" dangerouslySetInnerHTML={{ __html: badge.icon }} />
          </span>
        )}
        <span className="group-name">{member.name}</span>
        {member.casting && <span className="group-casting">{member.casting}</span>}
        <span className="group-hotkey">{hotkey}</span>
      </div>
      <MiniBar value={member.hp} max={member.maxHp} kind="hp" label={dead ? "Mort" : String(member.hp)} />
      {member.maxMana > 0 && <MiniBar value={member.mana} max={member.maxMana} kind="mana" />}
      {member.maxEndurance > 0 && <MiniBar value={member.endurance} max={member.maxEndurance} kind="endurance" />}
      {!dead && member.effects.length > 0 && (
        <div className="group-effects">
          {member.effects.map((effect) => (
            <span
              key={effect.kind}
              className={`group-effect effect-${EFFECTS[effect.kind]?.category ?? "buff"}`}
              title={`${EFFECTS[effect.kind]?.label ?? effect.kind}${effect.remaining !== null ? ` (${effect.remaining}s)` : ""}`}
            >
              {SHORT_EFFECT_LABELS[effect.kind] ?? effect.kind}
            </span>
          ))}
        </div>
      )}
    </div>
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

function EffectList({ effects }: { effects: EffectFrame[] }) {
  if (effects.length === 0) return null;
  return (
    <div className="effect-list">
      {effects.map((effect) => (
        <span key={effect.kind} className={`effect effect-${EFFECTS[effect.kind]?.category ?? "buff"}`}>
          {EFFECTS[effect.kind]?.label ?? effect.kind}
          {effect.remaining !== null && ` ${effect.remaining}s`}
        </span>
      ))}
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
        const active = abilityId === "speedSong" && self.songActive;
        // Technique de mêlée en attente du prochain coup d'arme.
        const queued = abilityId === self.queuedAbility;
        // Part du cadran déjà découverte (recharge écoulée), en degrés : elle grandit dans le sens des aiguilles
        // d'une montre à partir de midi, le reste est dans l'ombre.
        const elapsed = remaining > 0 && ability.cooldown > 0 ? (1 - remaining / ability.cooldown) * 360 : 0;
        const classes = ["slot", `slot-${status.state}`, active && "slot-active", queued && "slot-queued"];
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
            {ability.cost > 0 && <span className="slot-cost">{ability.cost}</span>}
            {ability.position && <PositionBadge position={ability.position} wrong={status.state === "position"} />}
            {remaining > 0 && (
              <span className="slot-cooldown" style={{ background: `conic-gradient(transparent ${elapsed}deg, rgba(0, 0, 0, 0.72) 0)` }}>
                {formatCooldown(remaining)}
              </span>
            )}
            {hovered === abilityId && (
              <div className="slot-tooltip">
                <div className="tooltip-name" style={{ color: abilityColor(abilityId) }}>
                  {ability.name}
                </div>
                <div className="tooltip-details">{abilityDetails(ability).join(" · ")}</div>
                <div className="tooltip-description">{ability.description}</div>
                {status.reason && <div className="tooltip-reason">{status.reason}</div>}
              </div>
            )}
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
  return seconds.toFixed(1);
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

function CombatLog() {
  const lines = useHudStore((s) => s.combatLog);
  if (lines.length === 0) return null;
  return (
    <div className="hud-panel combat-log">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

// Volume général et sourdine, mémorisés dans le navigateur.
function SoundControl() {
  const [settings, setSettings] = useState(audio.settings);
  return (
    <div className="sound-control">
      <button
        className="sound-toggle"
        title={settings.muted ? "Réactiver le son" : "Couper le son"}
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
        aria-label="Volume"
        onChange={(e) => {
          audio.setVolume(Number(e.target.value));
          setSettings(audio.settings);
        }}
      />
    </div>
  );
}

function HelpPanel() {
  return (
    <div className="hud-panel help">
      <div>Z/S : avancer/reculer · Q/D : pivoter</div>
      <div>Clic droit maintenu : la souris oriente (haut/bas : inclinaison) · Q/D : pas de côté</div>
      <div>Tab : ennemi suivant · clic : cibler · F1 : soi-même · Échap : annuler</div>
      <div>F : faire face à la cible · C : la suivre (stick)</div>
      <div>R : activer/couper l'attaque · molette : zoom · V : recentrer</div>
      <div>1 à 9, 0 : compétences</div>
    </div>
  );
}
