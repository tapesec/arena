// Cadres du combat : le sien et celui de la cible, effets subis, barres d'incantation, grille du groupe.
import { EFFECTS } from "@arena/shared";
import { classIcon } from "../classIcons";
import { effectIcon } from "../effectIcons";
import { effectLabel, formatDecimal, t } from "../i18n";
import {
  useHudStore,
  type CastFrame,
  type EffectFrame,
  type GroupMemberFrame,
  type SelfFrame,
  type TargetFrame,
} from "../store";
import { SwingBar } from "./Hotbar";

// Son propre cadre : cliquable pour se cibler (F1 au clavier), par exemple pour se lancer un buff.
// Cadres du combat (choisis le 2026-11-22, disposition « B · retenue ») : en bas, juste au-dessus de la barre d'action,
// soi à gauche et sa cible à droite, en miroir. Chaque cadre porte un médaillon de classe, le nom, la vie, la mana ou
// l'endurance, et ses buffs dedans ; ses contrôles et affaiblissements au-dessus, en grand. Sa propre incantation (et
// la jauge d'arme) au milieu, entre les deux rangées d'effets ; celle de la cible dans son cadre.
export function CombatFrames() {
  const self = useHudStore((s) => s.self);
  const target = useHudStore((s) => s.target);
  if (!self) return null;
  return (
    <div className="combat-frames">
      <div className="combat-top">
        <Afflictions effects={self.effects} />
        <div className="combat-center">
          <SelfCastBar />
          <SwingBar />
        </div>
        <Afflictions effects={target?.effects ?? []} mirror />
      </div>
      <SelfCard self={self} />
      {target ? <TargetCard target={target} /> : <div className="unit-card unit-card-mirror unit-card-empty">{t("frame.noTarget")}</div>}
    </div>
  );
}

const effectCategory = (effect: EffectFrame) => EFFECTS[effect.kind]?.category ?? "buff";

const isAffliction = (effect: EffectFrame) => effectCategory(effect) === "control" || effectCategory(effect) === "debuff";

// Buffs à durée d'abord, puis permanents, puis immunités (si montrées).
const buffRank = (effect: EffectFrame) => (effectCategory(effect) === "immunity" ? 2 : effect.remaining === null ? 1 : 0);

function buffsOf(effects: EffectFrame[], immunities: boolean): EffectFrame[] {
  return effects.filter((e) => !isAffliction(e) && (immunities || effectCategory(e) !== "immunity")).sort((a, b) => buffRank(a) - buffRank(b));
}

const effectKey = (effect: EffectFrame) => `${effect.kind}:${effect.sourceId}`;

// Contrôles et affaiblissements au-dessus d'un cadre (côté intérieur : vers le centre pour la cible).
function Afflictions({ effects, mirror = false }: { effects: EffectFrame[]; mirror?: boolean }) {
  return (
    <div className={`combat-afflictions${mirror ? " combat-afflictions-mirror" : ""}`}>
      {effects.filter(isAffliction).map((effect) => (
        <EffectIcon key={effectKey(effect)} effect={effect} size="affliction" />
      ))}
    </div>
  );
}

// Couleur de la vie : verte, orange sous la moitié, rouge sous le quart.
const hpTone = (ratio: number) => (ratio > 0.5 ? "" : ratio > 0.25 ? " hp-low" : " hp-critical");

function FrameBar({ value, max, kind, label }: { value: number; max: number; kind: string; label?: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={`frame-bar bar-${kind}${kind === "hp" ? hpTone(ratio) : ""}`}>
      <div className="bar-fill" style={{ width: `${ratio * 100}%` }} />
      <span className="frame-bar-text">{label ?? `${value} / ${max}`}</span>
    </div>
  );
}

function Seal({ classId, side, badge }: { classId: string; side: "self" | "ally" | "enemy"; badge: string }) {
  return (
    <div className={`unit-seal unit-seal-${side}`}>
      <span className="unit-seal-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: classIcon(classId) }} />
      <span className="unit-badge">{badge}</span>
    </div>
  );
}

function ResourceBars({ unit }: { unit: { mana: number; maxMana: number; endurance: number; maxEndurance: number } }) {
  return (
    <>
      {unit.maxMana > 0 && <FrameBar value={unit.mana} max={unit.maxMana} kind="mana" />}
      {unit.maxEndurance > 0 && <FrameBar value={unit.endurance} max={unit.maxEndurance} kind="endurance" />}
    </>
  );
}

function SelfCard({ self }: { self: SelfFrame }) {
  const actions = useHudStore((s) => s.actions);
  return (
    <div className="unit-card unit-card-self" onClick={() => actions?.selectSelf()} title={`${self.name} (F1)`}>
      <Seal classId={self.classId} side="self" badge="F1" />
      <div className="unit-body">
        <div className="unit-line">
          <b className="unit-title">{self.name}</b>
          <span className="unit-tags">
            {self.attacking && <span className="tag tag-attack">{t("frame.attack")}</span>}
            {self.lock === "face" && <span className="tag tag-lock">{t("frame.face")}</span>}
            {self.lock === "stick" && <span className="tag tag-lock">{t("frame.stick")}</span>}
            <span className="unit-class">{self.className}</span>
          </span>
        </div>
        <FrameBar value={self.hp} max={self.maxHp} kind="hp" label={self.hp <= 0 ? t("frame.dead") : undefined} />
        <ResourceBars unit={self} />
        {/* Ses immunités ne sont pas montrées (comme avant) : seulement ses buffs. */}
        <div className="unit-buffs">
          {buffsOf(self.effects, false).map((effect) => (
            <EffectIcon key={effectKey(effect)} effect={effect} size="frameBuff" />
          ))}
        </div>
      </div>
    </div>
  );
}

function TargetCard({ target }: { target: TargetFrame }) {
  let tag = <span className="tag tag-out-range">{target.distance} m</span>;
  if (target.isSelf) tag = <span className="tag tag-out-range">{t("frame.you")}</span>;
  else if (!target.inLineOfSight) tag = <span className="tag tag-blocked">{t("frame.outOfSight")}</span>;
  else if (target.inMeleeRange) tag = <span className="tag tag-in-range">{t("frame.inMelee")}</span>;
  const side = target.isSelf ? "self" : target.isAlly ? "ally" : "enemy";
  const badge = target.isSelf ? "F1" : t(target.isAlly ? "frame.ally" : "frame.enemy");
  return (
    <div className={`unit-card unit-card-mirror unit-card-${side}`}>
      <Seal classId={target.classId} side={side} badge={badge} />
      <div className="unit-body">
        <div className="unit-line">
          <span className="unit-tags">{tag}</span>
          <b className="unit-title">{target.name}</b>
        </div>
        <FrameBar value={target.hp} max={target.maxHp} kind="hp" label={target.hp <= 0 ? t("frame.dead") : undefined} />
        {/* Son incantation prend la place de sa mana ou de son endurance. */}
        {target.cast ? <FrameBar value={target.cast.progress} max={1} kind="cast" label={target.cast.abilityName} /> : <ResourceBars unit={target} />}
        {/* Ses immunités comptent (inutile de la mezzer) : avec ses buffs. */}
        <div className="unit-buffs">
          {buffsOf(target.effects, true).map((effect) => (
            <EffectIcon key={effectKey(effect)} effect={effect} size="frameBuff" />
          ))}
        </div>
      </div>
    </div>
  );
}

// Fenêtre de groupe (choisie le 2026-11-22, « Grille ») : deux colonnes de tuiles, soi en premier (F1, liseré doré),
// puis ses coéquipiers (F2 à F8), cliquables pour les cibler. La vie remplit la tuile ; buffs en petit au milieu,
// contrôles et affaiblissements en grand en bas à droite ; fine barre de mana ou d'endurance en bas.
export function GroupPanel() {
  const group = useHudStore((s) => s.group);
  const actions = useHudStore((s) => s.actions);
  if (group.length === 0) return null;
  return (
    <div className="group-grid">
      {group.map((member, index) => (
        <GroupTile
          key={member.id}
          member={member}
          hotkey={`F${index + 1}`}
          onSelect={() => (member.isSelf ? actions?.selectSelf() : actions?.selectTarget(member.id))}
        />
      ))}
    </div>
  );
}

function GroupTile({ member, hotkey, onSelect }: { member: GroupMemberFrame; hotkey: string; onSelect: () => void }) {
  const dead = member.hp <= 0;
  const ratio = member.maxHp > 0 ? Math.max(0, Math.min(1, member.hp / member.maxHp)) : 0;
  const resource = member.maxMana > 0 ? { value: member.mana, max: member.maxMana, kind: "mana" } : { value: member.endurance, max: member.maxEndurance, kind: "endurance" };
  const classes = [
    "group-tile",
    member.isSelf && "group-tile-self",
    member.isTarget && "group-tile-target",
    dead && "group-tile-dead",
    !dead && !member.inRange && "group-tile-far",
  ];
  return (
    <div className={classes.filter(Boolean).join(" ")} onClick={onSelect} title={`${member.name} (${hotkey})`}>
      <div className={`group-tile-fill${hpTone(ratio)}`} style={{ width: `${ratio * 100}%` }} />
      <div className="group-tile-top">
        <span className="group-tile-class" aria-hidden="true" dangerouslySetInnerHTML={{ __html: classIcon(member.classId) }} />
        <span className="group-tile-name">{member.isSelf ? t("frame.you") : member.name}</span>
        <span className="group-tile-key">{hotkey}</span>
      </div>
      {dead ? (
        <div className="group-tile-dead-label">{t("frame.dead")}</div>
      ) : (
        <>
          <div className="group-tile-buffs">
            {buffsOf(member.effects, true).map((effect) => (
              <EffectIcon key={effectKey(effect)} effect={effect} size="tileBuff" />
            ))}
          </div>
          {member.casting ? <span className="group-tile-cast">{member.casting}</span> : <span className="group-tile-hp">{member.hp}</span>}
          {resource.max > 0 && (
            <div className={`group-tile-resource bar-${resource.kind}`}>
              <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, resource.value / resource.max)) * 100}%` }} />
            </div>
          )}
          <div className="group-tile-afflictions">
            {member.effects.filter(isAffliction).map((effect) => (
              <EffectIcon key={effectKey(effect)} effect={effect} size="tileAffliction" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Effet affiché en icône (celle de la compétence qui le pose), bordée selon sa nature (contrôle, affaiblissement,
// buff, immunité), avec un cadran qui se vide (pas de compte à rebours, décidé le 2026-11-22). Il clignote à la fin :
// un buff dans ses 10 dernières secondes, les autres dans leurs 3 dernières. Infobulle : nom, durée restante, qui
// l'a posé.
const ENDING_SOON = 3;

const BUFF_ENDING_SOON = 10;

type EffectSize = "affliction" | "frameBuff" | "tileBuff" | "tileAffliction";

function EffectIcon({ effect, size }: { effect: EffectFrame; size: EffectSize }) {
  const icon = effectIcon(effect.kind);
  const label = effectLabel(effect.kind);
  const { remaining, duration } = effect;
  const elapsed = remaining !== null && duration ? Math.min(1, Math.max(0, 1 - remaining / duration)) : 0;
  const category = effectCategory(effect);
  const endingAt = category === "buff" ? BUFF_ENDING_SOON : ENDING_SOON;
  const classes = [
    "aura",
    `aura-size-${size}`,
    `aura-${category}`,
    remaining === null && "aura-permanent",
    remaining !== null && remaining < endingAt && "aura-ending",
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
    </span>
  );
}

// Durée restante de l'infobulle : secondes entières, au dixième dans les dernières secondes, en minutes au-delà d'une
// minute.
function formatRemaining(seconds: number): string {
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  if (seconds >= ENDING_SOON) return String(Math.ceil(seconds));
  return formatDecimal(seconds, 1);
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
