// Barre d'action : compétences, roulade, jauge du coup d'arme, recharges.
import { useEffect, useRef, useState } from "react";
import {
  ROLL_COOLDOWN,
  ROLL_DISTANCE,
  ROLL_DURATION,
  ROLL_ID,
  getAbility,
  getClass,
  isIncapacitated,
} from "@arena/shared";
import { abilityColor, abilityIcon } from "../abilityBar";
import { abilityStatus, errorText } from "../abilityStatus";
import { formatDecimal, t } from "../i18n";
import { useHudStore } from "../store";
import { AbilityTooltip } from "./AbilityTooltip";

// Barre d'action : une case par compétence, avec son icône (couleur de son école), sa touche, sa recharge en cadran
// et son état (utilisable, ressource manquante, hors de portée, mauvaise position…). Survol : infobulle ; clic : lancer.
export function Hotbar() {
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
      <RollSlot now={now} />
    </div>
  );
}

// Flèche qui s'enroule : icône de la roulade (dessinée pour le jeu).
const ROLL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 64a192 192 0 0 1 187 148l37-14-22 102-82-64 32-12A144 144 0 1 0 400 320h50A192 192 0 1 1 256 64zm-32 128a32 32 0 1 1 0 64 32 32 0 0 1 0-64zm-24 88h80l40 80h-48l-24-40-32 40h-56z"/></svg>';

// Case de la roulade (Espace), à part au bout de la barre : grisée quand elle est impossible, cadran de recharge.
function RollSlot({ now }: { now: number }) {
  const self = useHudStore((s) => s.self);
  const end = useHudStore((s) => s.cooldownEnds[ROLL_ID] ?? 0);
  const actions = useHudStore((s) => s.actions);
  const [hovered, setHovered] = useState(false);
  if (!self) return null;
  const remaining = Math.max(0, (end - now) / 1000);
  const reason =
    self.hp <= 0
      ? errorText("dead")
      : isIncapacitated(self.effects)
        ? errorText("incapacitated")
        : self.rooted
          ? errorText("rooted")
          : self.charging
            ? errorText("charging")
            : null;
  const elapsed = remaining > 0 ? (1 - remaining / ROLL_COOLDOWN) * 360 : 0;
  return (
    <div
      className={`slot slot-roll ${reason ? "slot-disabled" : "slot-ready"}${self.rolling ? " slot-active" : ""}`}
      onClick={() => actions?.roll()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="slot-icon" dangerouslySetInnerHTML={{ __html: ROLL_ICON }} />
      <span className="slot-key">{t("roll.key")}</span>
      {remaining > 0 && (
        <span className="slot-cooldown" style={{ background: `conic-gradient(transparent ${elapsed}deg, rgba(0, 0, 0, 0.72) 0)` }}>
          {formatCooldown(remaining)}
        </span>
      )}
      {hovered && (
        <div className="slot-tooltip">
          <div className="tooltip-name">{t("roll.name")}</div>
          <div className="tooltip-description">
            {t("roll.description", { distance: ROLL_DISTANCE, duration: formatDecimal(ROLL_DURATION, 1), cooldown: ROLL_COOLDOWN })}
          </div>
          {reason && <div className="tooltip-reason">{reason}</div>}
        </div>
      )}
    </div>
  );
}

// Jauge de coup d'arme, au-dessus de la barre, tant que l'attaque automatique est active : elle se remplit jusqu'au
// prochain coup, prend la couleur de la technique en attente (dont l'icône s'affiche au bout), éclate quand l'arme
// frappe, et clignote en rouge, pleine, quand le coup est prêt mais ne peut pas partir (hors de portée, pas de face...).
export function SwingBar() {
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
export function PositionBadge({ position, wrong }: { position: "back" | "side"; wrong: boolean }) {
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
