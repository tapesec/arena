import { GameCanvas } from "./GameCanvas";
import { useHudStore, type UnitFrame } from "./store";

export function App() {
  return (
    <>
      <GameCanvas />
      <Hud />
    </>
  );
}

function Hud() {
  const status = useHudStore((s) => s.status);
  const error = useHudStore((s) => s.error);

  if (status === "connecting") return <div className="hud-panel hud-status">Connexion au serveur…</div>;
  if (status === "error") return <div className="hud-panel hud-status hud-error">Connexion impossible : {error}</div>;

  return (
    <>
      <div className="hud-frames">
        <SelfPanel />
        <TargetPanel />
      </div>
      <CombatLog />
      <HelpPanel />
    </>
  );
}

function SelfPanel() {
  const self = useHudStore((s) => s.self);
  if (!self) return null;
  return (
    <div className="hud-panel unit-frame">
      <div className="unit-name">
        {self.name}
        {self.attacking && <span className="tag tag-attack">Attaque</span>}
      </div>
      <HealthBar unit={self} />
    </div>
  );
}

function TargetPanel() {
  const target = useHudStore((s) => s.target);
  if (!target) return null;
  return (
    <div className="hud-panel unit-frame">
      <div className="unit-name">
        {target.name}
        <span className={`tag ${target.inMeleeRange ? "tag-in-range" : "tag-out-range"}`}>
          {target.inMeleeRange ? "À portée" : `${target.distance} m`}
        </span>
      </div>
      <HealthBar unit={target} />
    </div>
  );
}

function HealthBar({ unit }: { unit: UnitFrame }) {
  const ratio = unit.maxHp > 0 ? unit.hp / unit.maxHp : 0;
  return (
    <div className="health-bar">
      <div className="health-fill" style={{ width: `${ratio * 100}%` }} />
      <span className="health-text">{unit.hp > 0 ? `${unit.hp} / ${unit.maxHp}` : "Mort"}</span>
    </div>
  );
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

function HelpPanel() {
  const playerCount = useHudStore((s) => s.playerCount);
  return (
    <div className="hud-panel help">
      <div>Joueurs connectés : {playerCount}</div>
      <div>ZQSD : se déplacer</div>
      <div>Tab ou clic : cibler · Échap : annuler</div>
      <div>F : activer/couper l'attaque</div>
      {import.meta.env.DEV && <div>R : revivre (test)</div>}
    </div>
  );
}
