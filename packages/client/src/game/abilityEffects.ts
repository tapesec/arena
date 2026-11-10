import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { AbilityAnimation, AnimationEffect, EffectAnchor } from "./abilityAnimations";
import type { CharacterInstance } from "./characterAssets";
import * as P from "./particles";
import type { ParticleFactory, Recipe } from "./particles";

// Effets à particules portés par le personnage pendant le geste d'une compétence (réglés sur animation-lab.html) :
// chacun démarre et s'arrête à un instant du geste, accroché à une partie du corps, avec un décalage.

// Effets proposés, avec leur nom sur la page de réglage.
export const EFFECT_RECIPES: Record<string, { label: string; recipe: Recipe }> = {
  fireCharge: { label: "Formation de feu", recipe: P.fireCharge },
  frostCharge: { label: "Formation de givre", recipe: P.frostCharge },
  fireTrail: { label: "Traînée de feu", recipe: P.fireTrail },
  frostTrail: { label: "Traînée de givre", recipe: P.frostTrail },
  arcaneTrail: { label: "Traînée arcanique", recipe: P.arcaneTrail },
  silenceTrail: { label: "Traînée de silence", recipe: P.silenceTrail },
  smokeTrail: { label: "Fumée", recipe: P.smokeTrail },
  fireBurst: { label: "Explosion de feu", recipe: P.fireBurst },
  frostBurst: { label: "Éclat de givre", recipe: P.frostBurst },
  arcaneBurst: { label: "Éclat arcanique", recipe: P.arcaneBurst },
  silencePuff: { label: "Bouffée de silence", recipe: P.silencePuff },
  critSparks: { label: "Étincelles", recipe: P.critSparks },
  healFlash: { label: "Éclair de soin", recipe: P.healFlash },
  healColumn: { label: "Colonne de soin", recipe: P.healColumn },
  buffSpiral: { label: "Spirale de buff", recipe: P.buffSpiral },
  resurrectRain: { label: "Pluie de résurrection", recipe: P.resurrectRain },
  noteBurst: { label: "Gerbe de notes", recipe: P.noteBurst },
  notesAura: { label: "Notes de musique", recipe: P.notesAura },
  mezHalo: { label: "Volutes de mez", recipe: P.mezHalo },
  frostMist: { label: "Brume de givre", recipe: P.frostMist },
  frostCoat: { label: "Givre sur le corps", recipe: P.frostCoat },
  bubbleShards: { label: "Éclats de bulle", recipe: P.bubbleShards },
  burning: { label: "Flammes", recipe: P.burning },
  rageFlames: { label: "Flammes de rage", recipe: P.rageFlames },
  rampartFlames: { label: "Flammes du Rempart", recipe: P.rampartFlames },
  rallyHalo: { label: "Couronne dorée", recipe: P.rallyHalo },
  arcaneColumn: { label: "Colonne arcanique", recipe: P.arcaneColumn },
  arcaneSparks: { label: "Éclairs arcaniques", recipe: P.arcaneSparks },
  chargeStreak: { label: "Traînée de charge", recipe: P.chargeStreak },
  speedDust: { label: "Poussière", recipe: P.speedDust },
};

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

const BONES: Partial<Record<EffectAnchor, string>> = { hand_r: "hand_r", hand_l: "hand_l", head: "head", chest: "spine_03" };

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

// Démarre et arrête les effets du geste en cours d'un personnage, et les garde accrochés à lui.
export class AbilityEffectPlayer {
  private running = new Map<string, { effect: AnimationEffect; at: Vector3; system: ParticleSystem | null }>();

  constructor(private particles: ParticleFactory) {}

  update(character: CharacterInstance | null, playing: PlayingAbility | null) {
    const active = new Set<string>();
    if (character && playing) {
      (playing.entry.effects ?? []).forEach((effect, index) => {
        if (playing.time < effect.start || playing.time >= effect.end) return;
        const key = `${playing.abilityId}:${index}:${effect.recipe}`;
        active.add(key);
        let run = this.running.get(key);
        if (!run) {
          run = { effect, at: new Vector3(), system: null };
          effectPosition(character, effect, playing.time, run.at);
          run.system = EFFECT_RECIPES[effect.recipe]?.recipe(this.particles, run.at) ?? null;
          this.running.set(key, run);
        }
        run.effect = effect;
        effectPosition(character, effect, playing.time, run.at);
      });
    }
    for (const [key, run] of this.running) if (!active.has(key)) this.stop(key, run);
  }

  stopAll() {
    for (const [key, run] of this.running) this.stop(key, run);
  }

  private stop(key: string, run: { at: Vector3; system: ParticleSystem | null }) {
    if (run.system) {
      // Les dernières particules restent où elles sont, au lieu de suivre le personnage.
      run.system.emitter = run.at.clone();
      run.system.stop();
    }
    this.running.delete(key);
  }
}
