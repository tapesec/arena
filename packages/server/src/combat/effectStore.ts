// Pose et retrait des effets d'un joueur : la liste du serveur (ActiveEffect) et sa copie synchronisée vers les
// clients (EffectState).

import { HP_BUFF_AMOUNT, PERMANENT, type EffectKind } from "@arena/shared";
import type { ActiveEffect, PlayerRuntime } from "../PlayerRuntime";
import { EffectState } from "../state";

export function addEffect(
  player: PlayerRuntime,
  kind: EffectKind,
  duration: number,
  sourceId: string,
  // value : valeur propre à l'effet (part de vitesse perdue d'un snare, montant d'un tic) ; magic : posé par un sort ;
  // perSource : un effet par lanceur (Renouveau), seul celui du même lanceur est rafraîchi.
  { value = 0, magic = false, perSource = false }: { value?: number; magic?: boolean; perSource?: boolean } = {},
): ActiveEffect {
  const existing = perSource ? player.effects.find((e) => e.kind === kind && e.sourceId === sourceId) : player.getEffect(kind);
  if (existing) {
    existing.remaining = duration;
    existing.duration = duration;
    existing.sourceId = sourceId;
    existing.value = value;
    existing.magic = magic;
    existing.ticks = undefined;
    existing.view.remaining = Number.isFinite(duration) ? duration : PERMANENT;
    existing.view.duration = Number.isFinite(duration) ? duration : PERMANENT;
    existing.view.source = sourceId;
    existing.view.value = value;
    return existing;
  }
  const view = new EffectState();
  view.kind = kind;
  view.remaining = Number.isFinite(duration) ? duration : PERMANENT;
  view.duration = Number.isFinite(duration) ? duration : PERMANENT;
  view.source = sourceId;
  view.value = value;
  player.state.effects.push(view);
  const effect: ActiveEffect = { kind, remaining: duration, duration, sourceId, value, magic, view };
  player.effects.push(effect);

  if (kind === "buffHp") {
    player.state.maxHp += HP_BUFF_AMOUNT;
    player.state.hp += HP_BUFF_AMOUNT;
  }
  return effect;
}

export function removeEffect(player: PlayerRuntime, effect: ActiveEffect) {
  player.effects = player.effects.filter((e) => e !== effect);
  const index = player.state.effects.indexOf(effect.view);
  if (index >= 0) player.state.effects.splice(index, 1);

  if (effect.kind === "buffHp") {
    player.state.maxHp -= HP_BUFF_AMOUNT;
    player.state.hp = Math.min(player.state.hp, player.state.maxHp);
  }
}
