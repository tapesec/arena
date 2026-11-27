import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

// Écart des bras d'un personnage (voir Appearance.armSpread) : après l'animation, chaque bras tourne autour de l'axe
// avant du torse pour s'éloigner du corps. Plein pendant les animations détendues (repos, marche, course), effacé en
// douceur pendant les autres (sorts, coups, réactions…), dont les gestes restent ceux d'origine.

// Durée du fondu de l'écart, en secondes.
const FADE = 0.25;

interface Arm {
  bone: TransformNode;
  // Os suivant (avant-bras) : donne la direction du bras.
  next: TransformNode;
  // Côté du bras : 1 à droite, -1 à gauche.
  side: number;
  // Rotation de l'animation, et celle qu'on a écrite par-dessus (pour reconnaître une image où l'animation n'a rien
  // réécrit : animation en pause).
  base: Quaternion;
  written: Quaternion | null;
}

// Renvoie de quoi retirer l'écart (rotations de l'animation rendues), ou null sans les os des bras.
export function spreadArms(
  scene: Scene,
  bones: Map<string, TransformNode>,
  animations: Map<string, AnimationGroup>,
  relaxed: Set<string>,
  degrees: number,
): (() => void) | null {
  const arm = (name: string, next: string, side: number): Arm | null => {
    const bone = bones.get(name);
    const child = bones.get(next);
    if (!bone || !child) return null;
    bone.rotationQuaternion ??= Quaternion.FromEulerVector(bone.rotation);
    return { bone, next: child, side, base: bone.rotationQuaternion.clone(), written: null };
  };
  const right = arm("upperarm_r", "lowerarm_r", 1);
  const left = arm("upperarm_l", "lowerarm_l", -1);
  if (!right || !left) return null;
  const arms = [right, left];
  const groups = [...animations.values()];
  const angle = (degrees * Math.PI) / 180;
  let weight = 0;

  // Calculs réutilisés d'une image à l'autre.
  const lateral = new Vector3();
  const axis = new Vector3();
  const direction = new Vector3();
  const swing = new Vector3();
  const inverse = new Matrix();
  const delta = new Quaternion();

  const observer = scene.onAfterAnimationsObservable.add(() => {
    // Détendu : seules des animations détendues jouent (au moins une).
    const playing = groups.filter((group) => group.isPlaying);
    const target = playing.length > 0 && playing.every((group) => relaxed.has(group.name)) ? 1 : 0;
    const step = scene.getEngine().getDeltaTime() / 1000 / FADE;
    weight = target > weight ? Math.min(target, weight + step) : Math.max(target, weight - step);

    // Positions de l'image précédente (les matrices de cette image ne sont pas encore calculées) : assez justes pour
    // orienter l'axe et choisir le sens.
    right.bone.getAbsolutePosition().subtractToRef(left.bone.getAbsolutePosition(), lateral);
    if (lateral.lengthSquared() < 1e-8) return;
    // Axe avant du torse : perpendiculaire à la ligne des épaules, à l'horizontale.
    Vector3.CrossToRef(lateral, Vector3.UpReadOnly, axis);
    if (axis.lengthSquared() < 1e-8) return;
    axis.normalize();

    for (const a of arms) {
      const current = a.bone.rotationQuaternion!;
      // L'animation a réécrit la rotation : c'est la nouvelle base ; sinon (pause) la base reste.
      if (!a.written || !current.equalsWithEpsilon(a.written, 1e-6)) a.base.copyFrom(current);
      if (weight <= 0) {
        if (a.written) current.copyFrom(a.base);
        a.written = null;
        continue;
      }
      // Sens : celui qui pousse le bras vers l'extérieur (son côté de la ligne des épaules).
      a.next.getAbsolutePosition().subtractToRef(a.bone.getAbsolutePosition(), direction);
      Vector3.CrossToRef(axis, direction, swing);
      let sign = Vector3.Dot(swing, lateral) * a.side >= 0 ? 1 : -1;
      // Axe dans le repère du parent de l'os, puis rotation appliquée dans ce repère (après celle de l'animation). Un
      // repère en miroir (glTF importé : racine à l'échelle -1) inverse le sens des rotations.
      const parent = a.bone.parent as TransformNode | null;
      if (parent) {
        const world = parent.getWorldMatrix();
        if (world.determinant() < 0) sign = -sign;
        world.invertToRef(inverse);
        Vector3.TransformNormalToRef(axis, inverse, direction);
      } else direction.copyFrom(axis);
      Quaternion.RotationAxisToRef(direction.normalize(), sign * angle * weight, delta);
      delta.multiplyToRef(a.base, current);
      a.written ??= new Quaternion();
      a.written.copyFrom(current);
    }
  });

  return () => {
    scene.onAfterAnimationsObservable.remove(observer);
    for (const a of arms) if (a.written) a.bone.rotationQuaternion!.copyFrom(a.base);
  };
}
