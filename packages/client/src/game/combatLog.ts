import type { CombatEvent, InterruptEvent } from "@arena/shared";
import { abilityName as contentAbilityName, effectLabel, t, type TextKey } from "../i18n";

// Ce contre quoi une cible est immunisée (detail de l'événement "immune") : un contrôle, la magie (Cri de
// ralliement), la mêlée (Rempart) ou les effets de mobilité (Ballade rythmée).
function immunityName(detail: string): string {
  if (detail === "magic") return t("log.immuneMagic");
  if (detail === "melee") return contentAbilityName("rampart");
  if (detail === "mobility") return contentAbilityName("ballad");
  return effectLabel(detail);
}

function abilityName(id: string): string {
  return id === "auto" ? t("log.autoAttack") : contentAbilityName(id);
}

// Ligne qui commence par le nom d'un personnage : « vous » / « you » prend une majuscule quand c'est le joueur
// local (un pseudo est laissé tel quel).
function lead(line: string, leadIsSelf: boolean): string {
  return leadIsSelf ? line.charAt(0).toUpperCase() + line.slice(1) : line;
}

// Nom affiché d'un effet dans le journal : la Gangrène y est décrite par ce qu'elle fait.
function effectName(detail: string): string {
  return detail === "gangrene" ? t("log.healingReduced") : effectLabel(detail);
}

// Transforme un événement de combat en lignes de journal lisibles. nameOf donne « vous » / « you » pour le joueur
// local ; les phrases dont il est le sujet ont leur propre texte (variantes « Self », pour la conjugaison).
export function formatCombatEvent(event: CombatEvent, nameOf: (id: string) => string, selfId: string): string[] {
  const source = nameOf(event.sourceId);
  const target = nameOf(event.targetId);
  const targetIsSelf = event.targetId === selfId;
  const sourceIsSelf = event.sourceId === selfId;
  const ability = abilityName(event.abilityId);
  // La compétence et son auteur : « Trait de feu de Kael » / “Kael's Fire Bolt”, ou « votre … » / “your …”.
  const attack = t(sourceIsSelf ? "log.attackOfSelf" : event.abilityId === "auto" ? "log.autoAttackOf" : "log.attackOf", { source, ability });
  const bySubject = (key: TextKey, selfKey: TextKey, isSelf: boolean, params: Record<string, string | number>) =>
    t(isSelf ? selfKey : key, params);

  switch (event.kind) {
    case "damage": {
      const lines = [lead(t("log.damage", { source, target, ability, amount: event.amount ?? 0 }), sourceIsSelf) + (event.crit ? t("log.crit") : "")];
      if (event.killed) lines.push(targetIsSelf ? t("log.youDied") : t("log.died", { target }));
      return lines;
    }
    case "heal": {
      const params = { source, target, ability, amount: event.amount ?? 0 };
      return [lead(t(event.sourceId === event.targetId ? "log.heal" : "log.healOther", params), sourceIsSelf)];
    }
    case "blocked": {
      const blocker = event.detail && event.detail !== event.targetId ? nameOf(event.detail) : "";
      return [t(blocker ? "log.blockedBy" : "log.blocked", { attack, blocker })];
    }
    case "evaded":
      return [bySubject("log.evaded", "log.evadedSelf", targetIsSelf, { target, attack })];
    case "absorbed":
      return [bySubject("log.absorbed", "log.absorbedSelf", targetIsSelf, { target, attack })];
    case "intercepted":
      return [bySubject("log.intercepted", "log.interceptedSelf", targetIsSelf, { target, ally: nameOf(event.detail ?? "") })];
    case "cc":
    case "debuff": {
      // Sans répéter la compétence quand l'effet porte le même nom (« Oubli (Oubli) »).
      const effect = effectName(event.detail ?? "");
      const key = effect === ability ? "log.effectSameName" : "log.effect";
      return [lead(t(key, { target, effect, ability }), targetIsSelf)];
    }
    case "immune":
      return [bySubject("log.immune", "log.immuneSelf", targetIsSelf, { target, what: immunityName(event.detail ?? "") })];
    case "taunt":
      return [bySubject("log.taunt", "log.tauntSelf", sourceIsSelf, { source, target })];
    case "cleanse":
      return [bySubject("log.cleanse", "log.cleanseSelf", sourceIsSelf, { source, target })];
    case "resurrect":
      return [bySubject("log.resurrect", "log.resurrectSelf", sourceIsSelf, { source, target })];
    case "buff":
      return [lead(t("log.buff", { source, target, ability }), sourceIsSelf)];
    case "guard":
      return [bySubject("log.guard", "log.guardSelf", sourceIsSelf, { source, target })];
    case "unguard":
      return [bySubject("log.unguard", "log.unguardSelf", sourceIsSelf, { source, target })];
  }
}

const INTERRUPT_CAUSES: Record<InterruptEvent["reason"], TextKey> = {
  damage: "log.cause.damage",
  move: "log.cause.move",
  silence: "log.cause.silence",
  cc: "log.cause.cc",
  taunt: "log.cause.taunt",
};

export function formatInterrupt(event: InterruptEvent, nameOf: (id: string) => string, selfId: string): string {
  const line = t("log.interrupt", { caster: nameOf(event.casterId), ability: abilityName(event.abilityId), cause: t(INTERRUPT_CAUSES[event.reason]) });
  return lead(line, event.casterId === selfId);
}
