import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";

// Modèles 3D produits par scripts/build-assets.mjs, servis depuis public/models/.
const MODELS_URL = "/models/";

// Part de métal gardée sur les matériaux des modèles (voir load).
const METALLIC = 0.25;

// Bibliothèques d'animations : un squelette sans maillage et ses animations.
const ANIMATION_LIBRARIES = ["animations/UAL1_Standard.glb", "animations/UAL2.glb"];

// Arme tenue dans une main : os du squelette auquel elle est attachée, et placement dans la main
// (position en mètres, rotation en radians, dans le repère de l'os).
interface WeaponMount {
  model: string;
  bone: string;
  position: [number, number, number];
  rotation: [number, number, number];
}

// Animations propres à une classe (les déplacements sont communs à tous).
export interface CharacterAnimationSet {
  idle: string;
  // Coups d'auto-attaque, joués à tour de rôle.
  attacks: string[];
  // Animation jouée au déclenchement d'une compétence ; "default" pour celles qui ne sont pas listées.
  abilities: Record<string, string>;
}

interface CharacterDef {
  model: string;
  weapons: WeaponMount[];
  animations: CharacterAnimationSet;
}

// Classes qui ont déjà un modèle ; les autres restent en capsule pour l'instant.
const CHARACTERS: Record<string, CharacterDef> = {
  gardien: {
    model: "characters/gardien.glb",
    weapons: [
      { model: "weapons/sword.glb", bone: "hand_r", position: [0, 0.08, 0.02], rotation: [0, 0, 0] },
      { model: "weapons/shield.glb", bone: "lowerarm_l", position: [0, 0.15, 0], rotation: [0, -Math.PI / 2, 0] },
    ],
    animations: {
      idle: "Idle_Shield_Loop",
      attacks: ["Sword_Regular_A", "Sword_Regular_B", "Sword_Regular_C"],
      abilities: { shieldBash: "Shield_OneShot", guard: "Sword_Block", default: "Yes" },
    },
  },
};

export function hasCharacterModel(classId: string): boolean {
  return classId in CHARACTERS;
}

// Un personnage instancié dans la scène : son maillage, ses armes et ses animations.
export interface CharacterInstance {
  root: TransformNode;
  set: CharacterAnimationSet;
  meshes: AbstractMesh[];
  animations: Map<string, AnimationGroup>;
  // Points d'attache des armes, exposés pour les régler en développement.
  weapons: TransformNode[];
  dispose(): void;
}

// Charge une seule fois chaque fichier, puis crée autant d'instances que de joueurs.
export class CharacterAssets {
  private containers = new Map<string, Promise<AssetContainer>>();

  constructor(private scene: Scene) {
    registerBuiltInLoaders();
  }

  // Lance le téléchargement de tout ce qui est connu, pour qu'il soit prêt à l'apparition des joueurs.
  preload() {
    for (const url of ANIMATION_LIBRARIES) void this.load(url);
    for (const def of Object.values(CHARACTERS)) {
      void this.load(def.model);
      for (const weapon of def.weapons) void this.load(weapon.model);
    }
  }

  private load(url: string): Promise<AssetContainer> {
    let container = this.containers.get(url);
    if (!container) {
      container = LoadAssetContainerAsync(MODELS_URL + url, this.scene).then((loaded) => {
        // Sans image d'environnement à refléter, le métal sort presque noir : on l'atténue.
        for (const material of loaded.materials) {
          if (material.getClassName() === "PBRMaterial") (material as unknown as { metallic: number }).metallic = METALLIC;
        }
        return loaded;
      });
      this.containers.set(url, container);
    }
    return container;
  }

  async create(classId: string, parent: TransformNode): Promise<CharacterInstance | null> {
    const def = CHARACTERS[classId];
    if (!def) return null;
    const [character, libraries, weaponContainers] = await Promise.all([
      this.load(def.model),
      Promise.all(ANIMATION_LIBRARIES.map((url) => this.load(url))),
      Promise.all(def.weapons.map((w) => this.load(w.model))),
    ]);

    // Les noms d'origine sont gardés : c'est par eux qu'on retrouve les os pour les animations.
    const entries = character.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
    const root = entries.rootNodes[0] as TransformNode;
    root.parent = parent;

    const bones = new Map<string, TransformNode>();
    for (const node of root.getDescendants(false)) if (node instanceof TransformNode) bones.set(node.name, node);

    // Toutes les animations partagent le même squelette (mêmes noms d'os) : on les rebranche sur ce personnage.
    const animations = new Map<string, AnimationGroup>();
    for (const library of libraries) {
      for (const group of library.animationGroups) {
        const clone = group.clone(group.name, (target: { name: string }) => bones.get(target.name) ?? null);
        clone.stop();
        animations.set(group.name, clone);
      }
    }

    // Les armes sont accrochées aux os de la main ou de l'avant-bras et suivent leurs mouvements.
    const weapons: TransformNode[] = [];
    def.weapons.forEach((mount, i) => {
      const bone = bones.get(mount.bone);
      if (!bone) return;
      const weapon = weaponContainers[i].instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
      // Attache intermédiaire réglable ; le maillage de l'arme garde son orientation d'origine dessous.
      const attach = new TransformNode(`attach-${mount.bone}`, this.scene);
      attach.parent = bone;
      attach.position.set(...mount.position);
      attach.rotation.set(...mount.rotation);
      for (const node of weapon.rootNodes) {
        // Le nœud racine ajouté par le chargeur glTF retourne l'axe z ; le squelette l'a déjà fait.
        for (const child of node.getChildren()) (child as TransformNode).parent = attach;
        node.dispose();
      }
      weapons.push(attach);
    });

    const meshes = root.getChildMeshes(false);
    for (const attach of weapons) meshes.push(...attach.getChildMeshes(false));

    return {
      root,
      set: def.animations,
      meshes,
      animations,
      weapons,
      dispose() {
        for (const group of animations.values()) group.dispose();
        for (const attach of weapons) attach.dispose(false, true);
        root.dispose(false, true);
      },
    };
  }
}
