import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { MIXAMO_ANIMATIONS, retargetMixamo } from "./mixamo";
import type { Shadows } from "./shadows";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";

// Modèles 3D produits par scripts/build-assets.mjs, servis depuis public/models/.
const MODELS_URL = "/models/";

// Agrandissement des personnages (le modèle d'origine mesure 1,84 m).
const CHARACTER_SCALE = 1.2;

// Part de métal gardée sur les matériaux des modèles (voir load).
const METALLIC = 0.25;

// Peinture des équipes (0 bleu, 1 rouge), proche de l'anneau au sol.
const TEAM_PAINT = ["#2c5cb8", "#b8302c"];

// Bibliothèques d'animations : un squelette sans maillage et ses animations.
const ANIMATION_LIBRARIES = ["animations/UAL1.glb", "animations/UAL2.glb"];

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
  // Matériaux peints à la couleur de l'équipe (la texture est retirée, le relief gardé).
  teamPaint?: string[];
  // Où ranger l'arme quand le personnage lance un sort (le bâton passe dans le dos).
  stow?: Placement;
}

// Placement d'une arme sur un os du squelette.
type Placement = Pick<WeaponMount, "bone" | "position" | "rotation">;

// Animations propres à une classe (les déplacements sont communs à tous).
export interface CharacterAnimationSet {
  idle: string;
  // Coup d'auto-attaque (une seule animation par classe ; plusieurs seraient jouées à tour de rôle).
  attacks: string[];
  // Animation jouée au déclenchement d'une compétence ; "default" pour celles qui ne sont pas listées.
  abilities: Record<string, string>;
  // Incantation propre à certains sorts (sinon, l'incantation commune Spell_Simple_Idle_Loop).
  casts?: Record<string, string>;
}

interface CharacterDef {
  model: string;
  // Matériau de la tenue, dont la couleur dépend de l'équipe (textures characters/<classe>-<équipe>.webp).
  outfit: string;
  // Teinte des cheveux et sourcils (leur texture est grise, faite pour être teintée).
  hairColor?: string;
  weapons: WeaponMount[];
  animations: CharacterAnimationSet;
}

// Animations communes aux lanceurs de sorts : un coup de bâton ou de poing, et le sort qui part.
const CASTER_ATTACKS = ["Sword_Attack"];
const CAST_RELEASE = "Spell_Simple_Shoot";

// Prise en main d'une arme à une main, mesurée sur les doigts refermés des animations d'épée : la poignée passe
// dans le poing, perpendiculaire aux doigts (axe z de l'os de la main), lame côté pouce. Les modèles d'arme ont
// leur lame vers +y et leur garde vers x : on les tourne pour que la lame suive l'axe z de la main et que la garde
// suive l'axe des doigts (y). La main gauche est le miroir de la droite : seul le côté de la paume change (x).
const GRIP_ROTATION: [number, number, number] = [0, Math.PI / 2, Math.PI / 2];
// Centre du poing fermé dans le repère de l'os de la main : côté paume (x) et à mi-chemin des phalanges (y).
const PALM = 0.03;
const GRIP_HEIGHT = 0.1;
// Recul le long de la poignée pour que la main tienne le milieu du manche, pas la garde (selon l'arme).
const SWORD_HANDLE = 0.09;
const DAGGER_HANDLE = 0.05;
function grip(hand: "r" | "l", handle: number): Pick<WeaponMount, "bone" | "position" | "rotation"> {
  return { bone: `hand_${hand}`, position: [hand === "r" ? -PALM : PALM, GRIP_HEIGHT, handle], rotation: GRIP_ROTATION };
}

// Bâton des lanceurs de sorts : il traverse la paume et reste vertical dans la pose d'incantation (la main pend le
// long du corps, elle n'est pas faite pour un bâton). UP_IN_HAND est la verticale du monde exprimée dans le repère
// de l'os de la main pendant Spell_Simple_Idle_Loop ; la main tient le bâton un peu au-dessus de son milieu.
const UP_IN_HAND: [number, number, number] = [0.506, -0.77, 0.388];
function staffGrip(gripAboveMiddle: number): Placement {
  const [ux, uy, uz] = UP_IN_HAND;
  const g = gripAboveMiddle;
  return { bone: "hand_r", position: [-PALM - ux * g, GRIP_HEIGHT - uy * g, -uz * g], rotation: alignModelY(UP_IN_HAND) };
}

// Bâton rangé dans le dos pendant un sort, en travers, le haut au-dessus de l'épaule droite. Repère du buste dans
// l'os spine_03, mesuré sur la pose d'attente : le haut, l'avant et la droite du personnage.
const TORSO_UP: [number, number, number] = [0, 0.97, -0.24];
const TORSO_FORWARD: [number, number, number] = [0, 0.24, 0.97];
const TORSO_RIGHT: [number, number, number] = [-1, 0, 0];
// Inclinaison du bâton par rapport à la verticale, distance derrière le dos et décalage vers le bas.
const STOW_TILT = (30 * Math.PI) / 180;
const STOW_BACK = 0.2;
const STOW_DOWN = 0.05;
function staffStow(middle: number): Placement {
  const axis = normalize(TORSO_UP.map((u, i) => u * Math.cos(STOW_TILT) + TORSO_RIGHT[i] * Math.sin(STOW_TILT)));
  // Le milieu du bâton (middle, sur l'axe du modèle) se place derrière le dos.
  const position = TORSO_FORWARD.map((f, i) => -f * STOW_BACK - TORSO_UP[i] * STOW_DOWN - axis[i] * middle);
  return { bone: "spine_03", position: position as [number, number, number], rotation: alignModelY(axis) };
}

// Rotation (angles x et z, sans y) qui amène l'axe y du modèle sur la direction donnée.
function alignModelY(direction: readonly number[]): [number, number, number] {
  const [dx, dy, dz] = normalize(direction);
  const z = Math.asin(-dx);
  return [Math.atan2(dz / Math.cos(z), dy / Math.cos(z)), 0, z];
}

function normalize(v: readonly number[]): [number, number, number] {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

// Une classe sans entrée ici reste affichée en capsule.
const CHARACTERS: Record<string, CharacterDef> = {
  gardien: {
    model: "characters/gardien.glb",
    outfit: "MI_Knight",
    weapons: [
      { model: "weapons/sword.glb", ...grip("r", SWORD_HANDLE) },
      {
        model: "weapons/shield.glb",
        bone: "lowerarm_l",
        position: [0, 0.15, 0],
        rotation: [0, -Math.PI / 2, 0],
        // Le Gardien est presque tout en armure : son bouclier porte la couleur de l'équipe.
        teamPaint: ["MI_Trim_Furniture"],
      },
    ],
    animations: {
      idle: "Idle_Shield_Loop",
      attacks: ["Sword_Regular_A"],
      abilities: { shieldBash: "Shield_OneShot", guard: "Sword_Block", default: "Yes" },
    },
  },
  lame: {
    model: "characters/lame.glb",
    outfit: "MI_Ranger",
    hairColor: "#3b2a1e",
    weapons: [
      { model: "weapons/dagger.glb", ...grip("r", DAGGER_HANDLE), scale: 0.35 },
      { model: "weapons/dagger.glb", ...grip("l", DAGGER_HANDLE), scale: 0.35 },
    ],
    animations: {
      idle: "Sword_Idle",
      attacks: ["Sword_Regular_B"],
      abilities: {
        backstab: "Sword_Regular_C",
        flankStrike: "Sword_Regular_B",
        evasion: "Roll",
        rage: "MonsterTransformation",
        default: "Yes",
      },
    },
  },
  arcaniste: {
    model: "characters/arcaniste.glb",
    outfit: "MI_Wizard",
    hairColor: "#7a2418",
    weapons: [
      {
        model: "weapons/ice-staff.fbx",
        ...staffGrip(0.15),
        stow: staffStow(-0.03),
        scale: 0.0065,
        colors: { Ice: "#8fdcff", Staff: "#5b3d22" },
        glow: ["Ice"],
      },
    ],
    animations: { idle: "Idle_Loop", attacks: CASTER_ATTACKS, abilities: { default: CAST_RELEASE } },
  },
  pretre: {
    model: "characters/pretre.glb",
    outfit: "MI_Noble",
    hairColor: "#d8b46a",
    weapons: [
      {
        model: "weapons/staff.fbx",
        // Son origine est plus basse que celle du bâton de glace : on le prend plus haut pour qu'il touche aussi le sol.
        ...staffGrip(0.3),
        stow: staffStow(0.125),
        scale: 0.0065,
        colors: { Wood: "#8a5a32", Gem: "#ffd966" },
        glow: ["Gem"],
      },
    ],
    animations: {
      idle: "Idle_Loop",
      attacks: CASTER_ATTACKS,
      // Les buffs (animations Mixamo) : incantation Standing Idle 03, puis bras levé, bâton pointé vers l'allié.
      abilities: { buffHp: "Mixamo_Cast_1H", buffStrength: "Mixamo_Cast_1H", default: CAST_RELEASE },
      casts: { buffHp: "Mixamo_Idle_03", buffStrength: "Mixamo_Idle_03" },
    },
  },
  barde: {
    model: "characters/barde.glb",
    outfit: "MI_Peasant",
    hairColor: "#5a3a22",
    weapons: [
      { model: "weapons/dagger.glb", ...grip("r", DAGGER_HANDLE), scale: 0.35 },
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

// Noms de toutes les animations attribuées aux classes (attente, coups, compétences, incantations).
function usedAnimations(): Set<string> {
  const names = new Set<string>();
  for (const { animations: set } of Object.values(CHARACTERS)) {
    names.add(set.idle);
    for (const name of [...set.attacks, ...Object.values(set.abilities), ...Object.values(set.casts ?? {})]) names.add(name);
  }
  return names;
}

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
  // Habille le personnage d'une des deux couleurs d'équipe (0 bleu, 1 rouge).
  setTeam(team: number): void;
  // Range les armes qui le prévoient (le bâton dans le dos) ou les remet en main.
  setStowed(stowed: boolean): void;
  dispose(): void;
}

// Charge une seule fois chaque fichier, puis crée autant d'instances que de joueurs.
export class CharacterAssets {
  private containers = new Map<string, Promise<AssetContainer>>();
  // Ombres portées : chaque personnage créé (et ses armes) projette son ombre.
  shadows: Shadows | null = null;
  // Matériaux de tenue par classe et par équipe, partagés par tous les personnages concernés.
  private outfits = new Map<string, PBRMaterial>();
  // Matériaux d'arme peints, par matériau d'origine et par équipe.
  private paints = new Map<string, PBRMaterial>();
  // Animations Mixamo, reciblées une fois sur un personnage modèle invisible (voir mixamo.ts).
  private mixamo: Promise<AnimationGroup[]> | null = null;

  // libraries : bibliothèques d'animations à charger (la page de visualisation charge les versions complètes).
  constructor(
    private scene: Scene,
    private libraries: string[] = ANIMATION_LIBRARIES,
  ) {
    registerBuiltInLoaders();
  }

  // Lance le téléchargement de tout ce qui est connu, pour qu'il soit prêt à l'apparition des joueurs.
  preload() {
    for (const url of this.libraries) void this.load(url);
    void this.loadMixamo();
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
      // Un chemin absolu (commençant par /) est pris tel quel, les autres sont relatifs à public/models/.
      container = LoadAssetContainerAsync(url.startsWith("/") ? url : MODELS_URL + url, this.scene, options).then((loaded) => {
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

  // only : si fourni, seules ces animations sont rebranchées sur le personnage (la page de visualisation en
  // affiche une par personnage ; les rebrancher toutes coûterait cher en mémoire).
  // Charge et recible les animations Mixamo, une seule fois. Le personnage modèle (n'importe lequel : tous partagent
  // le même squelette) reste caché ; les animations obtenues se clonent ensuite sur chaque personnage, par nom d'os.
  private loadMixamo(): Promise<AnimationGroup[]> {
    this.mixamo ??= (async () => {
      const model = await this.load(CHARACTERS.pretre.model);
      const template = model.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
      const root = template.rootNodes[0] as TransformNode;
      root.setEnabled(false);
      const groups: AnimationGroup[] = [];
      // Le jeu ne charge que les animations Mixamo attribuées à une classe ; la page de visualisation, qui charge les
      // bibliothèques complètes, les prend toutes.
      const all = this.libraries !== ANIMATION_LIBRARIES;
      const used = usedAnimations();
      for (const [name, url] of Object.entries(MIXAMO_ANIMATIONS)) {
        if (!all && !used.has(name)) continue;
        const group = retargetMixamo(name, await this.load(url), root);
        if (group) groups.push(group);
      }
      return groups;
    })();
    return this.mixamo;
  }

  async create(classId: string, parent: TransformNode, only?: ReadonlySet<string>): Promise<CharacterInstance | null> {
    const def = CHARACTERS[classId];
    if (!def) return null;
    const [character, libraries, weaponContainers, mixamo] = await Promise.all([
      this.load(def.model),
      Promise.all(this.libraries.map((url) => this.load(url))),
      Promise.all(def.weapons.map((w) => this.load(w.model))),
      this.loadMixamo(),
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
        if (only && !only.has(group.name)) continue;
        const clone = group.clone(group.name, (target: { name: string }) => bones.get(target.name) ?? null);
        clone.stop();
        animations.set(group.name, clone);
      }
    }
    for (const group of mixamo) {
      if (only && !only.has(group.name)) continue;
      const clone = group.clone(group.name, (target: { name: string }) => bones.get(target.name) ?? null);
      clone.stop();
      animations.set(group.name, clone);
    }

    // Les armes sont accrochées aux os de la main ou de l'avant-bras et suivent leurs mouvements.
    const weapons: TransformNode[] = [];
    // Armes qui se rangent : leur attache, et où la mettre en main ou rangée.
    const stowable: { attach: TransformNode; held: Placement; stowed: Placement }[] = [];
    const teamPainted: { mesh: AbstractMesh; base: PBRMaterial }[] = [];
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
      if (mount.stow) stowable.push({ attach, held: mount, stowed: mount.stow });
      const paintable = mount.teamPaint ?? [];
      for (const mesh of attach.getChildMeshes(false)) {
        if (mesh.material && paintable.includes(mesh.material.name)) teamPainted.push({ mesh, base: mesh.material as PBRMaterial });
      }
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
    const outfitMeshes = meshes.filter((mesh) => mesh.material?.name === def.outfit);
    const baseOutfit = outfitMeshes[0]?.material as PBRMaterial | undefined;
    for (const attach of weapons) meshes.push(...attach.getChildMeshes(false));
    this.shadows?.cast(meshes);

    return {
      root,
      set: def.animations,
      meshes,
      animations,
      weapons,
      setTeam: (team) => {
        if (baseOutfit) {
          const material = this.outfitMaterial(classId, team, baseOutfit);
          for (const mesh of outfitMeshes) mesh.material = material;
        }
        for (const { mesh, base } of teamPainted) mesh.material = this.paintMaterial(base, team);
      },
      setStowed: (stowed) => {
        for (const weapon of stowable) {
          const placement = stowed ? weapon.stowed : weapon.held;
          const bone = bones.get(placement.bone);
          if (!bone || weapon.attach.parent === bone) continue;
          weapon.attach.parent = bone;
          weapon.attach.position.set(...placement.position);
          weapon.attach.rotation.set(...placement.rotation);
        }
      },
      // Matériaux et textures sont partagés par tous les personnages de la classe : on ne les libère pas.
      dispose() {
        for (const group of animations.values()) group.dispose();
        for (const attach of weapons) attach.dispose(false, false);
        root.dispose(false, false);
        for (const skeleton of entries.skeletons) skeleton.dispose();
      },
    };
  }

  private paintMaterial(base: PBRMaterial, team: number): PBRMaterial {
    const key = `${base.uniqueId}-${team}`;
    let material = this.paints.get(key);
    if (!material) {
      material = base.clone(`${base.name}-${team}`);
      material.albedoTexture = null;
      material.albedoColor = Color3.FromHexString(TEAM_PAINT[team] ?? TEAM_PAINT[0]).toLinearSpace();
      this.paints.set(key, material);
    }
    return material;
  }

  private outfitMaterial(classId: string, team: number, base: PBRMaterial): PBRMaterial {
    const key = `${classId}-${team}`;
    let material = this.outfits.get(key);
    if (!material) {
      material = base.clone(`${base.name}-${team}`);
      material.albedoTexture = new Texture(`${MODELS_URL}characters/${key}.webp`, this.scene, false, false);
      this.outfits.set(key, material);
    }
    return material;
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
