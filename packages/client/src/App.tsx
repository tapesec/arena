import { useEffect, useState } from "react";
import { CLASS_LIST, EFFECTS, getAbility, getClass } from "@arena/shared";
import { GameCanvas } from "./GameCanvas";
import { useHudStore, type CastFrame, type EffectFrame } from "./store";

export function App() {
  const selectedClass = useHudStore((s) => s.selectedClass);
  if (!selectedClass) return <ClassPicker />;
  return (
    <>
      <GameCanvas classId={selectedClass} />
      <Hud />
    </>
  );
}

// Choix provisoire de la classe avant de rejoindre l'arène (la vraie sélection viendra à l'étape 6).
function ClassPicker() {
  const selectClass = useHudStore((s) => s.selectClass);
  return (
    <div className="class-picker">
      <h1>Choisissez votre classe</h1>
      <div className="class-list">
        {CLASS_LIST.map((c) => (
          <button key={c.id} className="class-card" onClick={() => selectClass(c.id)}>
            <span className="class-name">{c.name}</span>
            <span className="class-role">{c.role}</span>
            <span className="class-stats">
              {c.maxHp} PV · {c.resource === "mana" ? "Mana" : "Endurance"}
            </span>
            <span className="class-abilities">{c.abilities.map((id) => getAbility(id)?.name).join(" · ")}</span>
          </button>
        ))}
      </div>
    </div>
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
      <ChangeClassButton />
    </>
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

function Hotbar() {
  const self = useHudStore((s) => s.self);
  const cooldownEnds = useHudStore((s) => s.cooldownEnds);
  const now = useNow(Object.values(cooldownEnds).some((end) => end > performance.now()));
  const classDef = self ? getClass(self.classId) : undefined;
  if (!self || !classDef) return null;

  return (
    <div className="hotbar">
      {classDef.abilities.map((abilityId, index) => {
        const ability = getAbility(abilityId);
        if (!ability) return null;
        const remaining = Math.max(0, ((cooldownEnds[abilityId] ?? 0) - now) / 1000);
        const affordable = self[ability.resource] >= ability.cost;
        const active = abilityId === "speedSong" && self.songActive;
        return (
          <div
            key={abilityId}
            className={`slot ${affordable ? "" : "slot-unaffordable"} ${active ? "slot-active" : ""}`}
          >
            <span className="slot-key">{index + 1}</span>
            <span className="slot-name">{ability.name}</span>
            <span className="slot-cost">
              {ability.cost > 0 ? `${ability.cost} ${ability.resource === "mana" ? "mana" : "endu"}` : ""}
              {ability.castTime > 0 ? ` · ${ability.castTime}s` : ""}
            </span>
            {remaining > 0 && <span className="slot-cooldown">{formatCooldown(remaining)}</span>}
          </div>
        );
      })}
    </div>
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

function ChangeClassButton() {
  const selectClass = useHudStore((s) => s.selectClass);
  return (
    <button className="change-class" onClick={() => selectClass(null)}>
      Changer de classe
    </button>
  );
}

function HelpPanel() {
  const playerCount = useHudStore((s) => s.playerCount);
  return (
    <div className="hud-panel help">
      <div>Joueurs connectés : {playerCount}</div>
      <div>ZQSD : se déplacer</div>
      <div>Tab : ennemi suivant · clic : cibler · F1 : soi-même</div>
      <div>Échap : annuler la cible · E : faire face</div>
      <div>F : activer/couper l'attaque</div>
      <div>1 à 7 : compétences</div>
      {import.meta.env.DEV && <div>R : revivre (test)</div>}
    </div>
  );
}
