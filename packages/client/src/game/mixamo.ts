import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AnimatorAvatar } from "@babylonjs/core/Animations/animatorAvatar";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

// Animations téléchargées sur Mixamo (Adobe), au format FBX sans personnage (« Without Skin »), et reciblées sur le
// squelette Quaternius de nos personnages. Clé : nom de l'animation dans le jeu ; valeur : fichier dans public/models/.
// Licence Mixamo : utilisables dans le jeu, y compris commercialement, mais pas redistribuables comme fichiers à part.
export const MIXAMO_ANIMATIONS: Record<string, string> = {
  Mixamo_Cast_1H: "mixamo/cast-spell-1h.fbx",
  Mixamo_Idle_03: "mixamo/standing-idle-03.fbx",
  Mixamo_Spell_Casting: "mixamo/spell-casting.fbx",
  Mixamo_Casting_Spell: "mixamo/casting-spell.fbx",
  Mixamo_2H_Area_Attack_02: "mixamo/2h-magic-area-attack-02.fbx",
  Mixamo_2H_Magic_Attack_04: "mixamo/2h-magic-attack-04.fbx",
  Mixamo_2H_Cast_01: "mixamo/2h-cast-spell-01.fbx",
  Mixamo_2H_Magic_Attack_05: "mixamo/2h-magic-attack-05.fbx",
  Mixamo_Guitar_Playing: "mixamo/guitar-playing.fbx",
  Mixamo_Sword_Shield_Attack: "mixamo/sword-shield-attack.fbx",
  Mixamo_Taunt_Chest_Thump: "mixamo/taunt-chest-thump.fbx",
  Mixamo_Shield_Block_Idle: "mixamo/sword-shield-block-idle.fbx",
  Mixamo_Shield_Block: "mixamo/sword-shield-block.fbx",
  Mixamo_Shield_Impact: "mixamo/sword-shield-impact.fbx",
  Mixamo_Waving: "mixamo/waving.fbx",
  Mixamo_1H_Magic_Attack_01: "mixamo/standing-1h-magic-attack-01.fbx",
  Mixamo_2H_Magic_Attack_01: "mixamo/standing-2h-magic-attack-01.fbx",
};

// Os de Mixamo -> os de nos personnages (même anatomie, noms différents).
const BONE_MAP = buildBoneMap();

function buildBoneMap(): Map<string, string> {
  const map = new Map<string, string>();
  const trunk: Record<string, string> = {
    Hips: "pelvis",
    Spine: "spine_01",
    Spine1: "spine_02",
    Spine2: "spine_03",
    Neck: "neck_01",
    Head: "Head",
  };
  for (const [from, to] of Object.entries(trunk)) map.set(`mixamorig:${from}`, to);
  const limbs: Record<string, string> = {
    Shoulder: "clavicle",
    Arm: "upperarm",
    ForeArm: "lowerarm",
    Hand: "hand",
    UpLeg: "thigh",
    Leg: "calf",
    Foot: "foot",
    ToeBase: "ball",
  };
  const fingers: Record<string, string> = { Thumb: "thumb", Index: "index", Middle: "middle", Ring: "ring", Pinky: "pinky" };
  for (const [side, suffix] of [
    ["Left", "l"],
    ["Right", "r"],
  ]) {
    for (const [from, to] of Object.entries(limbs)) map.set(`mixamorig:${side}${from}`, `${to}_${suffix}`);
    for (const [from, to] of Object.entries(fingers)) {
      for (const i of [1, 2, 3]) map.set(`mixamorig:${side}Hand${from}${i}`, `${to}_0${i}_${suffix}`);
    }
  }
  return map;
}

// Recible l'animation d'un fichier Mixamo sur un personnage modèle (template : racine d'un personnage instancié, avec
// son squelette). L'animation obtenue vise les os du modèle par leur nom : elle se clone ensuite sur chaque personnage.
export function retargetMixamo(name: string, source: AssetContainer, template: TransformNode): AnimationGroup | null {
  const group = source.animationGroups[0];
  if (!group) return null;
  const avatar = new AnimatorAvatar(`mixamo-${name}`, template, false, false);
  const retargeted = avatar.retargetAnimationGroup(group, { mapNodeNames: BONE_MAP, animationGroupName: name, fixRootPosition: false });
  fixPelvis(retargeted, source, avatar);
  retargeted.stop();
  return retargeted;
}

// Babylon convertit mal le déplacement du bassin (centimètres et axe vertical y chez Mixamo, mètres et axe z chez nous) :
// on le recalcule, en ne gardant que le mouvement vertical (accroupi, redressé). L'animation se joue sur place.
function fixPelvis(retargeted: AnimationGroup, source: AssetContainer, avatar: AnimatorAvatar) {
  const target = retargeted.targetedAnimations.find((t) => t.animation.targetProperty === "position");
  const sourceTrack = source.animationGroups[0].targetedAnimations.find((t) => t.animation.targetProperty === "position");
  const hips = source.transformNodes.find((node) => node.name === "mixamorig:Hips");
  const rest = avatar.findBoneByName("pelvis")?.getRestMatrix().getTranslation();
  if (!target || !sourceTrack || !hips || !rest) {
    if (target) retargeted.removeTargetedAnimation(target.animation);
    return;
  }
  const sourceKeys = sourceTrack.animation.getKeys();
  const scale = rest.z / hips.position.y;
  const keys = target.animation.getKeys().map((key, i) => {
    const lift = ((sourceKeys[i]?.value as Vector3 | undefined)?.y ?? hips.position.y) - hips.position.y;
    return { ...key, value: rest.add(new Vector3(0, 0, lift * scale)) };
  });
  target.animation.setKeys(keys);
}
