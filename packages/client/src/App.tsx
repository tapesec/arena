import { useEffect, useState } from "react";
import { getAbility } from "@arena/shared";
import { GameCanvas } from "./GameCanvas";
import { HOTBAR } from "./hotbar";
import { useHudStore, type CastFrame } from "./store";

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
      <FlashMessage />
      <div className="hud-bottom">
        <SelfCastBar />
        <Hotbar />
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
      <Bar value={self.hp} max={self.maxHp} kind="hp" deadLabel="Mort" />
      <Bar value={self.mana} max={self.maxMana} kind="mana" />
      <Bar value={self.endurance} max={self.maxEndurance} kind="endurance" />
    </div>
  );
}

function TargetPanel() {
  const target = useHudStore((s) => s.target);
  if (!target) return null;

  let tag = <span className="tag tag-out-range">{target.distance} m</span>;
  if (!target.inLineOfSight) tag = <span className="tag tag-blocked">Hors de vue</span>;
  else if (!target.facing) tag = <span className="tag tag-blocked">Pas en face</span>;
  else if (target.inMeleeRange) tag = <span className="tag tag-in-range">Au contact</span>;

  return (
    <div className="hud-panel unit-frame">
      <div className="unit-name">
        {target.name}
        {tag}
      </div>
      <Bar value={target.hp} max={target.maxHp} kind="hp" deadLabel="Mort" />
      {target.cast && <CastBar cast={target.cast} />}
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

function Hotbar() {
  const self = useHudStore((s) => s.self);
  const cooldownEnds = useHudStore((s) => s.cooldownEnds);
  const now = useNow(Object.values(cooldownEnds).some((end) => end > performance.now()));

  return (
    <div className="hotbar">
      {HOTBAR.map((abilityId, index) => {
        const ability = getAbility(abilityId);
        if (!ability) return null;
        const remaining = Math.max(0, ((cooldownEnds[abilityId] ?? 0) - now) / 1000);
        const affordable = !self || self[ability.resource] >= ability.cost;
        return (
          <div key={abilityId} className={`slot ${affordable ? "" : "slot-unaffordable"}`}>
            <span className="slot-key">{index + 1}</span>
            <span className="slot-name">{ability.name}</span>
            <span className="slot-cost">
              {ability.cost} {ability.resource === "mana" ? "mana" : "endu"}
            </span>
            {remaining > 0 && <span className="slot-cooldown">{remaining.toFixed(1)}</span>}
          </div>
        );
      })}
    </div>
  );
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

function HelpPanel() {
  const playerCount = useHudStore((s) => s.playerCount);
  return (
    <div className="hud-panel help">
      <div>Joueurs connectés : {playerCount}</div>
      <div>ZQSD : se déplacer</div>
      <div>Tab ou clic : cibler · Échap : annuler</div>
      <div>F : activer/couper l'attaque</div>
      <div>E : faire face à la cible</div>
      <div>1 2 3 : compétences</div>
      {import.meta.env.DEV && <div>R : revivre (test)</div>}
    </div>
  );
}
