import { getAbility, type CombatEvent, type InterruptEvent } from "@arena/shared";

const CONTROL_NAMES: Record<string, string> = { mez: "mez", stun: "stun", root: "root" };
const BUFF_NAMES: Record<string, string> = { buffHp: "vie", buffStrength: "force" };
const INTERRUPT_CAUSES: Record<InterruptEvent["reason"], string> = {
  damage: "dégâts",
  move: "mouvement",
  silence: "silence",
  cc: "contrôle",
};

function abilityName(id: string): string {
  return id === "auto" ? "attaque" : (getAbility(id)?.name ?? id);
}

// Transforme un événement de combat en lignes de journal lisibles.
export function formatCombatEvent(event: CombatEvent, nameOf: (id: string) => string, selfId: string): string[] {
  const source = nameOf(event.sourceId);
  const target = nameOf(event.targetId);
  // Le joueur local est appelé "Vous" : il faut alors conjuguer à la deuxième personne.
  const targetIsSelf = event.targetId === selfId;
  const sourceIsSelf = event.sourceId === selfId;
  const ability = abilityName(event.abilityId);

  switch (event.kind) {
    case "damage": {
      const lines = [`${source} → ${target} : ${ability} ${event.amount}${event.crit ? " (critique)" : ""}`];
      if (event.killed) lines.push(event.targetId === selfId ? "Vous êtes mort" : `${target} est mort`);
      return lines;
    }
    case "heal": {
      const to = event.sourceId === event.targetId ? "" : ` → ${target}`;
      return [`${source}${to} : ${ability} +${event.amount}`];
    }
    case "blocked": {
      const blocker = event.detail && event.detail !== event.targetId ? ` par ${nameOf(event.detail)}` : "";
      return [`${ability} de ${source} bloqué${blocker}`];
    }
    case "evaded":
      return [`${target} ${targetIsSelf ? "esquivez" : "esquive"} ${ability} de ${source}`];
    case "absorbed":
      return [`${targetIsSelf ? "Votre bulle" : `La bulle de ${target}`} absorbe ${ability} de ${source}`];
    case "intercepted":
      return [`${target} ${targetIsSelf ? "interceptez" : "intercepte"} le coup visant ${nameOf(event.detail ?? "")}`];
    case "cc":
      return [`${target} : ${CONTROL_NAMES[event.detail ?? ""] ?? event.detail} (${ability})`];
    case "immune":
      return [`${target} ${targetIsSelf ? "êtes immunisé" : "est immunisé"} (${CONTROL_NAMES[event.detail ?? ""] ?? event.detail})`];
    case "cleanse":
      return [`${source} ${sourceIsSelf ? "purifiez" : "purifie"} ${target}`];
    case "resurrect":
      return [`${source} ${sourceIsSelf ? "ressuscitez" : "ressuscite"} ${target}`];
    case "buff":
      return [`${source} → ${target} : buff de ${BUFF_NAMES[event.detail ?? ""] ?? event.detail}`];
    case "guard":
      return [`${source} ${sourceIsSelf ? "protégez" : "protège"} ${target}`];
    case "unguard":
      return [`${source} ${sourceIsSelf ? "ne protégez plus" : "ne protège plus"} ${target}`];
  }
}

export function formatInterrupt(event: InterruptEvent, nameOf: (id: string) => string): string {
  return `${nameOf(event.casterId)} : ${abilityName(event.abilityId)} interrompu (${INTERRUPT_CAUSES[event.reason]})`;
}
