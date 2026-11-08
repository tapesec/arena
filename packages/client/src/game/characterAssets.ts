import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";

// Modèles 3D produits par scripts/build-assets.mjs, servis depuis public/models/.
const MODELS_URL = "/models/";

// Agrandissement des personnages (le modèle d'origine mesure 1,84 m).
const CHARACTER_SCALE = 1.2;

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
  // Échelle du modèle : certains packs ne sont pas à l'échelle réelle (FBX en centimètres, armes de pirate géantes).
  scale?: number;
  // Couleurs par nom de matériau, pour les modèles FBX dont Babylon ne lit pas les couleurs.
  // Les matériaux listés dans glow brillent légèrement (gemme, glace).
  colors?: Record<string, string>;
  glow?: string[];
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
  // Teinte des cheveux et sourcils (leur texture est grise, faite pour être teintée).
  hairColor?: string;
  weapons: WeaponMount[];
  animations: CharacterAnimationSet;
}

// Animations communes aux lanceurs de sorts : un coup de bâton ou de poing, et le sort qui part.
const CASTER_ATTACKS = ["Sword_Attack"];
const CAST_RELEASE = "Spell_Simple_Shoot";

// Une classe sans entrée ici reste affichée en capsule.
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
  lame: {
    model: "characters/lame.glb",
    hairColor: "#3b2a1e",
    weapons: [
      { model: "weapons/dagger.glb", bone: "hand_r", position: [0, 0.08, 0.02], rotation: [0, 0, 0], scale: 0.35 },
      { model: "weapons/dagger.glb", bone: "hand_l", position: [0, 0.08, 0.02], rotation: [0, 0, 0], scale: 0.35 },
    ],
    animations: {
      idle: "Sword_Idle",
      attacks: ["Sword_Regular_A", "Sword_Regular_B", "Sword_Regular_C"],
      abilities: { backstab: "Sword_Regular_C", flankStrike: "Sword_Regular_B", evasion: "Roll", default: "Yes" },
    },
  },
  arcaniste: {
    model: "characters/arcaniste.glb",
    hairColor: "#7a2418",
    weapons: [
      {
        model: "weapons/ice-staff.fbx",
        bone: "hand_r",
        position: [0, 0.08, 0.02],
        // Le modèle est à l'envers dans la main : on le retourne.
        rotation: [Math.PI, 0, 0],
        scale: 0.0065,
        colors: { Ice: "#8fdcff", Staff: "#5b3d22" },
        glow: ["Ice"],
      },
    ],
    animations: { idle: "Idle_Loop", attacks: CASTER_ATTACKS, abilities: { default: CAST_RELEASE } },
  },
  pretre: {
    model: "characters/pretre.glb",
    hairColor: "#d8b46a",
    weapons: [
      {
        model: "weapons/staff.fbx",
        bone: "hand_r",
        position: [0, 0.08, 0.02],
        // Le modèle est à l'envers dans la main : on le retourne.
        rotation: [Math.PI, 0, 0],
        scale: 0.0065,
        colors: { Wood: "#8a5a32", Gem: "#ffd966" },
        glow: ["Gem"],
      },
    ],
    animations: { idle: "Idle_Loop", attacks: CASTER_ATTACKS, abilities: { default: CAST_RELEASE } },
  },
  barde: {
    model: "characters/barde.glb",
    hairColor: "#5a3a22",
    weapons: [
      { model: "weapons/dagger.glb", bone: "hand_r", position: [0, 0.08, 0.02], rotation: [0, 0, 0], scale: 0.35 },
      // Le luth est porté en bandoulière dans le dos, manche au-dessus de l'épaule (orientation calculée en jeu).
      {
        model: "weapons/lute.glb",
        bone: "spine_03",
        position: [0, 0.1, -0.18],
        rotation: [(13 * Math.PI) / 12, (13 * Math.PI) / 12, Math.PI / 12],
        scale: 0.6,
      },
    ],
    animations: { idle: "Idle_Loop", attacks: ["Sword_Attack"], abilities: { default: CAST_RELEASE } },
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
      // Aucune animation lancée au chargement : elles sont jouées sur les personnages, pas sur les modèles d'origine.
      const options = { pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } };
      container = LoadAssetContainerAsync(MODELS_URL + url, this.scene, options).then((loaded) => {
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
    // Agrandi pour la lisibilité vue de haut ; purement visuel, les portées et collisions ne changent pas.
    root.scaling.scaleInPlace(CHARACTER_SCALE);

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
      attach.scaling.setAll(mount.scale ?? 1);
      for (const node of weapon.rootNodes) {
        if (node.name === "__root__" || node.name === "__fbx_root__") {
          // Le nœud racine ajouté par le chargeur (glTF ou FBX) change de repère ; le squelette l'a déjà fait.
          for (const child of node.getChildren()) (child as TransformNode).parent = attach;
          node.dispose();
        } else (node as TransformNode).parent = attach;
      }
      if (mount.colors) paintWeapon(attach, mount.colors, mount.glow ?? []);
      weapons.push(attach);
    });

    const meshes = root.getChildMeshes(false);
    if (def.hairColor) {
      const color = Color3.FromHexString(def.hairColor);
      for (const mesh of meshes) {
        const material = mesh.material as PBRMaterial | null;
        if (material?.name.startsWith("MI_Hair")) material.albedoColor = color;
      }
    }
    for (const attach of weapons) meshes.push(...attach.getChildMeshes(false));

    return {
      root,
      set: def.animations,
      meshes,
      animations,
      weapons,
      // Matériaux et textures sont partagés par tous les personnages de la classe : on ne les libère pas.
      dispose() {
        for (const group of animations.values()) group.dispose();
        for (const attach of weapons) attach.dispose(false, false);
        root.dispose(false, false);
        for (const skeleton of entries.skeletons) skeleton.dispose();
      },
    };
  }
}

// Colore les matériaux d'une arme d'après leur nom (sous-matériaux compris).
function paintWeapon(attach: TransformNode, colors: Record<string, string>, glow: string[]) {
  for (const mesh of attach.getChildMeshes(false)) {
    const material = mesh.material;
    const materials = material instanceof MultiMaterial ? material.subMaterials : [material];
    for (const sub of materials) {
      const hex = sub && colors[sub.name];
      if (!hex || !(sub instanceof StandardMaterial)) continue;
      const color = Color3.FromHexString(hex);
      sub.diffuseColor = color;
      sub.specularColor = new Color3(0.15, 0.15, 0.15);
      if (glow.includes(sub.name)) sub.emissiveColor = color.scale(0.45);
    }
  }
}
