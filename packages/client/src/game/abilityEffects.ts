import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { AbilityAnimation, AnimationEffect, EffectAnchor } from "./abilityAnimations";
import type { CharacterInstance } from "./characterAssets";
import { particleRecipe, zoneRecipe } from "./particleDefs";
import type { ParticleFactory } from "./particles";

// Effets à particules d'une compétence (réglés sur animation-lab.html) : portés par le lanceur pendant son geste,
// par chaque cible à l'impact et pendant l'état laissé, ou posés sur la zone d'effet. Chacun démarre et s'arrête
// à un instant du moment, accroché à une partie du corps (ou au centre de la zone), avec un décalage.

export const EFFECT_ANCHORS: Record<EffectAnchor, string> = {
  hands: "Entre les mains",
  hand_r: "Main droite",
  hand_l: "Main gauche",
  weapon: "Bout de l'arme",
  head: "Tête",
  chest: "Poitrine",
  feet: "Pieds (sol)",
};

// Compétence dont le geste est en cours, et où il en est (secondes dans l'animation).
export interface PlayingAbility {
  abilityId: string;
  entry: AbilityAnimation;
  time: number;
}

const BONES: Partial<Record<EffectAnchor, string>> = { hand_r: "hand_r", hand_l: "hand_l", head: "Head", chest: "spine_03" };

// Bout de chaque arme dans son propre repère (les modèles ont la lame ou le bâton vers +y), calculé une fois.
const weaponTips = new WeakMap<TransformNode, Vector3>();
const scratch = new Vector3();
const inverse = new Matrix();

function weaponTip(attach: TransformNode): Vector3 {
  let tip = weaponTips.get(attach);
  if (!tip) {
    attach.computeWorldMatrix(true);
    attach.getWorldMatrix().invertToRef(inverse);
    // Boîte englobante de l'arme dans le repère de l'attache : le bout est en haut, au milieu.
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of attach.getChildMeshes(false)) {
      mesh.computeWorldMatrix(true);
      for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
        Vector3.TransformCoordinatesToRef(corner, inverse, scratch);
        min.minimizeInPlace(scratch);
        max.maximizeInPlace(scratch);
      }
    }
    tip = Number.isFinite(max.y) ? new Vector3((min.x + max.x) / 2, max.y, (min.z + max.z) / 2) : Vector3.Zero();
    weaponTips.set(attach, tip);
  }
  return tip;
}

// Position d'un effet à un instant du geste (secondes dans l'animation) : entre ses deux points clés qui
// encadrent cet instant, à vitesse constante ; sans point clé, son accroche et son décalage.
const between = new Vector3();
export function effectPosition(character: CharacterInstance, effect: AnimationEffect, time: number, out: Vector3): Vector3 {
  const keys = effect.keys;
  if (!keys?.length) return anchorPosition(character, effect.anchor, effect.offset, out);
  let next = keys.findIndex((key) => key.time > time);
  if (next === -1) next = keys.length;
  if (next === 0 || next === keys.length) {
    const key = keys[Math.min(next, keys.length - 1)];
    return anchorPosition(character, key.anchor, key.offset, out);
  }
  const a = keys[next - 1];
  const b = keys[next];
  anchorPosition(character, a.anchor, a.offset, out);
  anchorPosition(character, b.anchor, b.offset, between);
  const f = b.time > a.time ? (time - a.time) / (b.time - a.time) : 1;
  return Vector3.LerpToRef(out, between, f, out);
}

// Position du point d'accroche, puis le décalage (droite, haut, avant, en mètres, dans le repère du personnage).
function anchorPosition(character: CharacterInstance, anchor: EffectAnchor, offset: readonly number[], out: Vector3): Vector3 {
  const frame = (character.root.parent as TransformNode | null) ?? character.root;
  if (anchor === "hands") {
    out.setAll(0);
    for (const hand of character.hands) out.addInPlace(hand.getAbsolutePosition());
    out.scaleInPlace(1 / Math.max(1, character.hands.length));
  } else if (anchor === "weapon" && character.weapons[0]) {
    const attach = character.weapons[0];
    Vector3.TransformCoordinatesToRef(weaponTip(attach), attach.getWorldMatrix(), out);
  } else {
    const bone = BONES[anchor] && character.bones.get(BONES[anchor]);
    out.copyFrom(bone ? bone.getAbsolutePosition() : frame.getAbsolutePosition());
  }
  const [right, up, forward] = offset;
  if (right || up || forward) {
    // Rotation du personnage autour de la verticale seulement (le décalage ne suit pas les inclinaisons du corps).
    const yaw = frame.absoluteRotationQuaternion.toEulerAngles().y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    out.x += right * cos + forward * sin;
    out.y += up;
    out.z += -right * sin + forward * cos;
  }
  return out;
}

// Effets d'un moment, à un instant donné (secondes depuis son début). Sur une zone, les effets se placent autour de
// son centre (décalage dans le repère du lanceur, yaw) au lieu d'un personnage.
export interface EffectTrack {
  id: string;
  effects: readonly AnimationEffect[];
  time: number;
  zone?: { center: Vector3; yaw: number; radius: number };
}

// Un effet joue de start à end (ou jusqu'à la fin du moment, avec untilEnd).
function isActive(effect: AnimationEffect, time: number): boolean {
  return time >= effect.start && (time < effect.end || !!effect.untilEnd);
}

// Position d'un effet de zone : son décalage (interpolé entre ses points clés) autour du centre.
const zoneOffset = new Vector3();
const nextOffset = new Vector3();
function zonePosition(zone: NonNullable<EffectTrack["zone"]>, effect: AnimationEffect, time: number, out: Vector3): Vector3 {
  const keys = effect.keys;
  if (!keys?.length) zoneOffset.fromArray(effect.offset);
  else {
    let next = keys.findIndex((key) => key.time > time);
    if (next === -1) next = keys.length;
    if (next === 0 || next === keys.length) zoneOffset.fromArray(keys[Math.min(next, keys.length - 1)].offset);
    else {
      const a = keys[next - 1];
      const b = keys[next];
      zoneOffset.fromArray(a.offset);
      nextOffset.fromArray(b.offset);
      Vector3.LerpToRef(zoneOffset, nextOffset, b.time > a.time ? (time - a.time) / (b.time - a.time) : 1, zoneOffset);
    }
  }
  const [right, up, forward] = [zoneOffset.x, zoneOffset.y, zoneOffset.z];
  const cos = Math.cos(zone.yaw);
  const sin = Math.sin(zone.yaw);
  return out.set(zone.center.x + right * cos + forward * sin, zone.center.y + up, zone.center.z - right * sin + forward * cos);
}

interface Run {
  effect: AnimationEffect;
  at: Vector3;
  system: ParticleSystem | null;
}

// Démarre et arrête les effets d'un ou plusieurs moments (geste du lanceur, impact, état, zone), et les garde
// accrochés au personnage ou à la zone.
export class AbilityEffectPlayer {
  private running = new Map<string, Run>();

  constructor(private particles: ParticleFactory) {}

  // Geste de compétence en cours du personnage.
  update(character: CharacterInstance | null, playing: PlayingAbility | null) {
    this.updateTracks(character, playing ? [{ id: playing.abilityId, effects: playing.entry.effects ?? [], time: playing.time }] : []);
  }

  updateTracks(character: CharacterInstance | null, tracks: readonly EffectTrack[]) {
    const active = new Set<string>();
    for (const track of tracks) {
      if (!character && !track.zone) continue;
      track.effects.forEach((effect, index) => {
        if (!isActive(effect, track.time)) return;
        const key = `${track.id}:${index}:${effect.recipe}`;
        active.add(key);
        let run = this.running.get(key);
        const place = (out: Vector3) =>
          track.zone ? zonePosition(track.zone, effect, track.time, out) : effectPosition(character!, effect, track.time, out);
        if (!run) {
          run = { effect, at: new Vector3(), system: null };
          place(run.at);
          const recipe = track.zone && effect.fitZone ? zoneRecipe(effect.recipe, track.zone.radius) : particleRecipe(effect.recipe);
          run.system = recipe?.(this.particles, run.at) ?? null;
          this.running.set(key, run);
        }
        run.effect = effect;
        place(run.at);
      });
    }
    for (const [key, run] of this.running) if (!active.has(key)) this.stop(key, run);
  }

  get idle(): boolean {
    return this.running.size === 0;
  }

  stopAll() {
    for (const [key, run] of this.running) this.stop(key, run);
  }

  private stop(key: string, run: Run) {
    if (run.system) {
      // Les dernières particules restent où elles sont, au lieu de suivre le personnage.
      run.system.emitter = run.at.clone();
      run.system.stop();
    }
    this.running.delete(key);
  }
}
