import {
  EFFECTS,
  PERMANENT,
  SPELL_RANGE,
  distance,
  hasLineOfSight,
  isInMeleeRange,
  positionRelativeTo,
  type EffectCategory,
  type EffectKind,
} from "@arena/shared";
import { abilityName, className } from "../i18n";
import type { CastFrame, EffectFrame, GroupMemberFrame, LoadingFrame, MatchFrame, SelfFrame, TargetFrame, TeammateFrame } from "../store";
import { campOf } from "./gameAppearances";
import type { MatchStateView } from "./matchState";
import type { PlayerView, PlayerVisual } from "./PlayerVisual";

// Cadres du HUD (soi, cible, groupe, partie, équipe, chargement) construits à partir de l'état synchronisé : le jeu les
// compare au dernier envoi et ne prévient React que s'ils ont changé (voir Game.refreshHud).

type NameOf = (id: string) => string;

export function buildSelfFrame(self: PlayerVisual, target: PlayerVisual | undefined, nameOf: NameOf): SelfFrame {
  return {
    ...unitFrame(self.state, nameOf),
    classId: self.state.classId,
    mana: Math.floor(self.state.mana),
    maxMana: self.state.maxMana,
    endurance: Math.floor(self.state.endurance),
    maxEndurance: self.state.maxEndurance,
    attacking: self.state.attacking,
    lock: self.state.lock,
    song: self.state.song,
    queuedAbility: self.state.queuedAbility,
    // Le combo ne part que sur la cible de son ouverture.
    comboAbility: target && self.state.comboTarget === target.sessionId ? self.state.comboAbility : "",
    charging: self.state.charging,
    rolling: self.state.rolling,
    rooted: self.hasEffect("root") || self.hasEffect("halted"),
  };
}

export function buildTargetFrame(self: PlayerVisual, target: PlayerVisual, nameOf: NameOf): TargetFrame {
  return {
    ...unitFrame(target.state, nameOf),
    classId: target.state.classId,
    mana: Math.floor(target.state.mana),
    maxMana: target.state.maxMana,
    endurance: Math.floor(target.state.endurance),
    maxEndurance: target.state.maxEndurance,
    isSelf: target === self,
    isAlly: target.state.team === self.state.team,
    distance: Math.round(distance(self.state, target.state)),
    inMeleeRange: isInMeleeRange(self.state, target.state),
    inLineOfSight: hasLineOfSight(self.state, target.state),
    position: positionRelativeTo(target.state, self.state),
  };
}

// Soi en premier (F1), puis les coéquipiers dans l'ordre de leurs touches (F2 à F8).
export function buildGroup(self: PlayerVisual, members: PlayerVisual[], target: PlayerVisual | undefined, nameOf: NameOf): GroupMemberFrame[] {
  return [self, ...members].map((p) => ({
    id: p.sessionId,
    isSelf: p === self,
    name: p.state.name,
    classId: p.state.classId,
    hp: p.state.hp,
    maxHp: p.state.maxHp,
    mana: Math.floor(p.state.mana),
    maxMana: p.state.maxMana,
    endurance: Math.floor(p.state.endurance),
    maxEndurance: p.state.maxEndurance,
    casting: castFrame(p.state)?.abilityName ?? null,
    effects: sortAfflictionsFirst(effectFrames(p.state, nameOf, true)),
    inRange: p === self || (distance(self.state, p.state) <= SPELL_RANGE && hasLineOfSight(self.state, p.state)),
    isTarget: p === target,
  }));
}

export function buildMatchFrame(state: MatchStateView, myTeam: number): MatchFrame {
  return {
    phase: state.phase,
    timeLeft: Math.ceil(state.phaseTimeLeft),
    playerCount: state.playerCount,
    matchSize: state.matchSize,
    team: myTeam,
    alliesAlive: myTeam === 0 ? state.alive0 : state.alive1,
    enemiesAlive: myTeam === 0 ? state.alive1 : state.alive0,
    teamSize: state.teamSize,
    camp: campOf(myTeam, state.campSwap),
    winner: state.winner,
  };
}

// Le serveur ne nous envoie que nos coéquipiers pendant le choix des classes.
export function buildTeammates(self: PlayerVisual, players: Iterable<PlayerVisual>): TeammateFrame[] {
  return (
    [...players]
      .filter((p) => p.state.team === self.state.team)
      .map((p) => ({
        id: p.sessionId,
        name: p.state.name,
        classId: p.state.classId,
        isSelf: p === self,
        isBot: p.state.isBot,
        leader: p.state.leader,
      }))
      // Soi-même, puis les autres joueurs, puis les bots.
      .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || Number(a.isBot) - Number(b.isBot))
  );
}

// Écran de chargement : tous les joueurs de la partie (le serveur les envoie tous, sans leur classe). Le sien est pris
// du suivi local (selfPercent), plus à jour.
export function buildLoading(loadingState: MatchStateView["loading"], selfId: string, selfPercent: number): LoadingFrame[] {
  return loadingState
    ? [...loadingState.entries()].map(([id, entry]) => ({
        id,
        name: entry.name,
        team: entry.team,
        isBot: entry.isBot,
        isSelf: id === selfId,
        progress: id === selfId ? selfPercent : entry.progress,
      }))
    : [];
}

export function unitFrame(state: PlayerView, nameOf: (id: string) => string) {
  return {
    name: state.name,
    className: state.classId ? className(state.classId) : "",
    hp: state.hp,
    maxHp: state.maxHp,
    cast: castFrame(state),
    effects: effectFrames(state, nameOf),
  };
}

// Les afflictions d'abord (ce qu'il faut purifier), puis les buffs, puis les immunités.
const CATEGORY_ORDER: Record<EffectCategory, number> = { control: 0, debuff: 1, buff: 2, immunity: 3 };

export function sortAfflictionsFirst(effects: EffectFrame[]): EffectFrame[] {
  return effects.sort((a, b) => CATEGORY_ORDER[EFFECTS[a.kind].category] - CATEGORY_ORDER[EFFECTS[b.kind].category]);
}

export function castFrame(state: PlayerView): CastFrame | null {
  if (!state.castAbility || state.castDuration <= 0) return null;
  return {
    abilityName: abilityName(state.castAbility),
    progress: Math.min(1, state.castElapsed / state.castDuration),
  };
}

// Durée restante à la seconde, au dixième dans les dernières secondes (compte à rebours) : le HUD n'est pas redessiné
// à chaque rafraîchissement. coarse : toujours à la seconde (fenêtre de groupe, sans chiffre).
const FINE_COUNTDOWN = 3;
export function roundRemaining(remaining: number, coarse: boolean): number {
  if (coarse || remaining >= FINE_COUNTDOWN) return Math.ceil(remaining);
  return Math.max(0.1, Math.ceil(remaining * 10) / 10);
}

export function effectFrames(state: PlayerView, nameOf: (id: string) => string, coarse = false): EffectFrame[] {
  return [...state.effects].map((e) => ({
    kind: e.kind as EffectKind,
    remaining: e.remaining === PERMANENT ? null : roundRemaining(e.remaining, coarse),
    duration: e.remaining === PERMANENT || !(e.duration > 0) ? null : e.duration,
    sourceId: e.source,
    source: nameOf(e.source),
  }));
}
