import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CLASSES, getAbility, type ClassId, type CombatEvent, type EffectKind } from "@arena/shared";
import { momentLength, statusKindsOf, tuningOf, zoneCenterIsTarget, type AbilityAnimation, type AnimationTuning } from "./abilityAnimations";
import { AbilityEffectPlayer } from "./abilityEffects";
import type { ParticleFactory } from "./particles";
import type { GroundMarks } from "./groundMarks";
import type { PlayerVisual } from "./PlayerVisual";
import { PROJECTILE_TRAVEL_TIME, isProjectile } from "./spellFx";

// Ce que subissent les cibles d'une compétence, réglé sur animation-lab.html (voir AbilityAnimation) :
// - à l'impact (arrivée du projectile, sinon départ du sort), une réaction et des effets sur chaque cible touchée ;
// - tant que dure l'état laissé par la compétence (mez, root, buff…), des effets sur la cible ;
// - sur une zone d'effet, des effets posés une seule fois en son centre.

// Événements qui montrent qu'une compétence de zone a atteint un joueur.
const LANDED = new Set<CombatEvent["kind"]>(["damage", "heal", "cc", "buff", "debuff", "cleanse", "resurrect", "taunt", "absorbed", "blocked"]);
// Événements qui montrent qu'une compétence à cible unique a manqué sa cible : l'impact annoncé n'a pas lieu.
const MISSED = new Set<CombatEvent["kind"]>(["evaded", "immune", "absorbed"]);
// Un impact peut encore être annulé tant qu'il n'a pas commencé, ou à peine (compétence instantanée : l'issue
// arrive juste après le départ du sort).
const CANCEL_GRACE = 0.05;

// Temps (secondes) pendant lequel les joueurs atteints par une compétence de zone sont rattachés à son lancement :
// le serveur envoie ses effets juste après elle.
const AREA_WINDOW = 0.3;

interface Impact {
  targetId: string;
  abilityId: string;
  entry: AbilityAnimation;
  // Temps depuis l'impact (négatif tant que le projectile vole).
  age: number;
  length: number;
  reacted: boolean;
  player: AbilityEffectPlayer;
}

interface Zone {
  abilityId: string;
  entry: AbilityAnimation;
  age: number;
  length: number;
  // Joueur au centre de la zone (la cible d'un sort offensif, sinon le lanceur) : le centre est relevé à l'impact.
  centerId: string;
  yaw: number;
  radius: number;
  center: Vector3 | null;
  player: AbilityEffectPlayer;
}

interface StatusRun {
  abilityId: string;
  entry: AbilityAnimation | undefined;
  age: number;
  player: AbilityEffectPlayer;
}

interface AreaCast {
  casterId: string;
  abilityId: string;
  kinds: string[];
  age: number;
  delay: number;
  hit: Set<string>;
}

export class TargetVisuals {
  private impacts: Impact[] = [];
  private zones: Zone[] = [];
  private areaCasts: AreaCast[] = [];
  // États en cours sur chaque joueur : type d'état → compétence d'origine et ses effets.
  private statuses = new Map<string, Map<string, StatusRun>>();
  // Dernière compétence (et son auteur) qui a atteint chaque joueur, pour chaque type d'état qu'elle laisse.
  private origins = new Map<string, Map<string, { abilityId: string; source: string }>>();

  constructor(
    private particles: ParticleFactory,
    private tuning: AnimationTuning,
    private marks: GroundMarks | null = null,
  ) {}

  // La réaction d'un coup reçu est celle réglée pour l'impact de la compétence (le jeu ne joue pas la sienne).
  handlesReaction(targetId: string, abilityId: string): boolean {
    return this.impacts.some((impact) => impact.targetId === targetId && sameAbility(impact.abilityId, abilityId) && !!impact.entry.impact?.reaction);
  }

  // Les effets de l'état en cours sur ce joueur sont réglés (ils remplacent les particules d'état du code).
  hasTunedStatus(playerId: string, kind: string): boolean {
    return this.statuses.get(playerId)?.get(kind)?.entry?.status !== undefined;
  }

  // Une compétence part (fin d'incantation, ou compétence instantanée).
  onAbility(casterId: string, abilityId: string, targetId: string, players: Map<string, PlayerVisual>) {
    const ability = getAbility(abilityId);
    const entry = tuningOf(this.tuning, abilityId);
    const projectile = isProjectile(abilityId);
    const delay = projectile ? PROJECTILE_TRAVEL_TIME : 0;
    // Compétence à cible unique (ou impact de la Charge, qui n'est pas une compétence de la barre).
    if (!ability?.radius) {
      this.reached(targetId || casterId, casterId, abilityId, entry, delay);
      return;
    }
    this.areaCasts.push({ casterId, abilityId, kinds: statusKindsOf(abilityId), age: 0, delay, hit: new Set() });
    if (entry?.zone?.length) {
      const caster = players.get(casterId);
      this.zones.push({
        abilityId,
        entry,
        age: -delay,
        length: momentLength(entry.zone),
        centerId: zoneCenterIsTarget(abilityId) && targetId ? targetId : casterId,
        yaw: caster ? yawOf(caster.root) : 0,
        radius: ability.radius,
        center: null,
        player: new AbilityEffectPlayer(this.particles, this.marks),
      });
    }
  }

  // Issue d'une compétence sur un joueur : atteint par une compétence de zone, ou manqué par une compétence à cible
  // unique.
  onCombat(event: CombatEvent) {
    if (MISSED.has(event.kind)) {
      this.missed(event.targetId, event.sourceId, event.abilityId);
      return;
    }
    if (!LANDED.has(event.kind)) return;
    const cast = this.areaCasts.find((c) => c.casterId === event.sourceId && c.abilityId === event.abilityId);
    if (!cast || cast.hit.has(event.targetId)) return;
    cast.hit.add(event.targetId);
    this.reached(event.targetId, event.sourceId, event.abilityId, tuningOf(this.tuning, event.abilityId), cast.delay - cast.age);
  }

  // L'impact annoncé n'a pas lieu, et la compétence n'a pas posé ses états.
  private missed(targetId: string, source: string, abilityId: string) {
    this.impacts = this.impacts.filter((impact) => {
      if (impact.targetId !== targetId || !sameAbility(impact.abilityId, abilityId) || impact.age > CANCEL_GRACE) return true;
      impact.player.stopAll();
      return false;
    });
    const origins = this.origins.get(targetId);
    for (const [kind, origin] of origins ?? []) {
      if (origin.source === source && sameAbility(origin.abilityId, abilityId)) origins!.delete(kind);
    }
  }

  update(dt: number, players: Map<string, PlayerVisual>) {
    for (const cast of this.areaCasts) cast.age += dt;
    this.areaCasts = this.areaCasts.filter((cast) => cast.age <= AREA_WINDOW);
    for (const id of this.origins.keys()) if (!players.has(id)) this.origins.delete(id);
    this.updateStatuses(dt, players);
    this.impacts = this.impacts.filter((impact) => this.updateImpact(impact, dt, players));
    this.zones = this.zones.filter((zone) => this.updateZone(zone, dt, players));
  }

  dispose() {
    for (const impact of this.impacts) impact.player.stopAll();
    for (const zone of this.zones) zone.player.stopAll();
    for (const runs of this.statuses.values()) for (const run of runs.values()) run.player.stopAll();
    this.impacts = [];
    this.zones = [];
    this.areaCasts = [];
    this.statuses.clear();
    this.origins.clear();
  }

  // La compétence atteint un joueur (delay : temps avant l'impact) : on retient d'où viennent ses états, et on
  // lance ce qu'il subit à l'impact.
  private reached(targetId: string, source: string, abilityId: string, entry: AbilityAnimation | undefined, delay: number) {
    let origins = this.origins.get(targetId);
    if (!origins) this.origins.set(targetId, (origins = new Map()));
    for (const kind of statusKindsOf(abilityId)) origins.set(kind, { abilityId, source });
    if (!entry?.impact) return;
    this.impacts.push({
      targetId,
      abilityId,
      entry,
      age: -Math.max(0, delay),
      length: momentLength(entry.impact.effects, entry.impact.reaction),
      reacted: false,
      player: new AbilityEffectPlayer(this.particles, this.marks),
    });
  }

  // false : l'impact est fini.
  private updateImpact(impact: Impact, dt: number, players: Map<string, PlayerVisual>): boolean {
    impact.age += dt;
    const target = players.get(impact.targetId);
    // Une cible tuée par le coup garde ses effets d'impact (sans réaction : elle tombe).
    if (!target || impact.age > impact.length) {
      impact.player.stopAll();
      return false;
    }
    if (impact.age < 0) return true;
    const reaction = impact.entry.impact?.reaction;
    if (!impact.reacted && reaction && target.isAlive) target.playTunedReaction(reaction);
    impact.reacted = true;
    impact.player.updateTracks(target.character, [{ id: impact.abilityId, effects: impact.entry.impact?.effects ?? [], time: impact.age }]);
    return true;
  }

  private updateZone(zone: Zone, dt: number, players: Map<string, PlayerVisual>): boolean {
    zone.age += dt;
    if (zone.age < 0) return true;
    if (!zone.center) {
      const anchor = players.get(zone.centerId);
      if (!anchor) return false;
      zone.center = anchor.root.getAbsolutePosition().clone();
    }
    if (zone.age > zone.length) {
      zone.player.stopAll();
      return false;
    }
    zone.player.updateTracks(null, [
      { id: zone.abilityId, effects: zone.entry.zone ?? [], time: zone.age, zone: { center: zone.center, yaw: zone.yaw, radius: zone.radius } },
    ]);
    return true;
  }

  // Effets réglés pour chaque état en cours, d'après la compétence qui l'a posé.
  private updateStatuses(dt: number, players: Map<string, PlayerVisual>) {
    for (const [id, runs] of this.statuses) {
      const player = players.get(id);
      for (const [kind, run] of runs) {
        if (player?.isAlive && player.hasEffect(kind as EffectKind)) continue;
        run.player.stopAll();
        runs.delete(kind);
      }
      if (!runs.size) this.statuses.delete(id);
    }
    for (const [id, player] of players) {
      if (!player.isAlive) continue;
      for (const effect of player.state.effects) {
        let runs = this.statuses.get(id);
        let run = runs?.get(effect.kind);
        if (!run) {
          this.noticeAreaStatus(id, effect.kind, effect.source);
          const abilityId = this.originOf(id, effect.kind, effect.source, players);
          run = { abilityId, entry: abilityId ? tuningOf(this.tuning, abilityId) : undefined, age: 0, player: new AbilityEffectPlayer(this.particles, this.marks) };
          if (!runs) this.statuses.set(id, (runs = new Map()));
          runs.set(effect.kind, run);
        } else run.age += dt;
        if (run.entry?.status?.length) {
          run.player.updateTracks(player.character, [{ id: `${effect.kind}:${run.abilityId}`, effects: run.entry.status, time: run.age }]);
        }
      }
    }
  }

  // Un état qui apparaît sur un joueur pendant une compétence de zone de son auteur, sans autre événement
  // (Cri de ralliement) : le joueur a été atteint.
  private noticeAreaStatus(targetId: string, kind: string, source: string) {
    const cast = this.areaCasts.find((c) => c.casterId === source && c.kinds.includes(kind) && !c.hit.has(targetId));
    if (!cast) return;
    cast.hit.add(targetId);
    this.reached(targetId, source, cast.abilityId, tuningOf(this.tuning, cast.abilityId), cast.delay - cast.age);
  }

  // Compétence qui a posé un état : la dernière qui a atteint le joueur avec ce type d'état, sinon celle de la
  // classe de l'auteur qui le pose.
  private originOf(targetId: string, kind: string, source: string, players: Map<string, PlayerVisual>): string {
    const known = this.origins.get(targetId)?.get(kind);
    if (known && known.source === source) return known.abilityId;
    const classId = players.get(source)?.state.classId as ClassId | undefined;
    const candidates = classId && CLASSES[classId] ? CLASSES[classId].abilities : [];
    return candidates.find((id) => statusKindsOf(id).includes(kind)) ?? "";
  }
}

// Orientation d'un personnage autour de la verticale (radians).
function yawOf(node: TransformNode): number {
  return node.rotationQuaternion ? node.rotationQuaternion.toEulerAngles().y : node.rotation.y;
}

// L'impact de la Charge (chargeImpact) arrive avec des événements de combat de la Charge.
function sameAbility(impactId: string, eventId: string): boolean {
  return impactId === eventId || (impactId === "chargeImpact" && eventId === "charge");
}
