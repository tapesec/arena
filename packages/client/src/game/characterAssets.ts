import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AnimatorAvatar } from "@babylonjs/core/Animations/animatorAvatar";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Material } from "@babylonjs/core/Materials/material";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { assetUrl } from "../assets";
import { MIXAMO_ANIMATIONS, UAL_TO_MIXAMO, retargetMixamo } from "./mixamo";
import {
  appearanceUrl,
  boneName,
  isHairCut,
  isCustom,
  isMonster,
  modelFile,
  PLAY_FRAME,
  type Appearance,
  type DefaultSocket,
  type Mount,
  type MountedItem,
  type Recolor,
} from "./appearance";
import { gameCharacterFiles, hasBothCamps, raceBody } from "./gameAppearances";
import { paintCells, tintImage } from "./textureTint";
import type { Shadows } from "./shadows";
import { TUNING } from "./tuning";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";

// Modèles 3D produits par scripts/build-assets.mjs, servis depuis public/models/.

// Agrandissement des personnages (le modèle d'origine mesure 1,84 m).
const CHARACTER_SCALE = 1.2;
// Pièces de tenue sans ombre portée (voir plus bas, à l'appel des ombres).
const NO_SHADOW_PIECES = /^(Eyes|Eyebrows|Hair_(Beard|Moustache|MuttonChops))|_Acc_|Belt|Bracer/;

// Part de métal gardée sur les matériaux des modèles (voir load).
const METALLIC = 0.25;

// Bibliothèques d'animations : un squelette sans maillage et ses animations.
export const ANIMATION_LIBRARIES = ["animations/UAL1.glb", "animations/UAL2.glb"];

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
  // Où ranger l'arme quand le personnage lance un sort (le bâton passe dans le dos).
  stow?: Placement;
  // Instrument (luth) : pendant une animation de jeu (INSTRUMENT_ANIMATIONS), il passe entre les mains (voir
  // holdInstrument). hiddenWhilePlaying : arme cachée pendant ce temps (la dague de la main qui gratte).
  instrument?: boolean;
  hiddenWhilePlaying?: boolean;
}

// Animations où le Barde joue de son instrument : il le tient entre ses mains.
export const INSTRUMENT_ANIMATIONS = new Set(["Mixamo_Guitar_Playing"]);

// Luth tenu en main, dans le repère du modèle (caisse vers +y, manche vers -y, table vers +z, avant mise à
// l'échelle) : point gratté par la main droite (bas de la caisse, entre la rosace et le chevalet), et recul des
// cordes derrière la paume, vers le ventre.
const LUTE_STRUM_POINT = new Vector3(0, 0.55, 0.03);
const LUTE_BEHIND_HAND = 0.05;
// Fin du jeu : le luth suit encore les mains le temps que les bras finissent leur mouvement, puis glisse jusqu'à
// sa place en bandoulière (secondes).
const INSTRUMENT_FOLLOW = 0.2;
const INSTRUMENT_RETURN = 0.35;

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
  // Sorts dont un seul geste couvre l'incantation et le lancement (au lieu de l'incantation commune puis d'un
  // geste) : voir CastGesture.
  castGestures?: Record<string, CastGesture>;
  // Vitesse de lecture de certaines animations de compétence (1 = normale).
  abilityRates?: Record<string, number>;
  // Postures tenues tant que dure un état : course de la Charge, garde du Rempart.
  stances?: { charge?: string; rampart?: string };
}

// Geste joué dès le début de l'incantation, calé pour que son moment fort (release, en secondes dans l'animation)
// tombe au départ du sort ; il s'arrête peu après (voir CharacterAnimator).
export interface CastGesture {
  animation: string;
  release: number;
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

// Luth entre les mains, recalculé à chaque image dans le repère de son os (le buste) : le point gratté sous la paume
// droite, un peu vers le ventre ; le manche (-y du modèle) vers la paume gauche ; la table vers l'avant du personnage. Les mains
// viennent de l'image précédente (une image de retard, invisible).
function holdInstrument(attach: TransformNode, bones: Map<string, TransformNode>) {
  if (!followHands(attach, bones, new Vector3(...TORSO_FORWARD))) return;
  const face = new Vector3(0, 0, 1).applyRotationQuaternion(attach.rotationQuaternion!);
  const strum = LUTE_STRUM_POINT.scale(attach.scaling.x).applyRotationQuaternion(attach.rotationQuaternion!);
  attach.position.subtractInPlace(face.scale(LUTE_BEHIND_HAND)).subtractInPlace(strum);
}

// Repère qui suit les mains, dans celui de son parent : origine sur la paume droite, y de la paume gauche vers la droite,
// z vers l'avant du buste (forward, dans le repère du parent). Mains confondues ou alignées sur l'avant du buste : pas
// d'orientation possible, on garde celle de l'image précédente (et on rend false).
function followHands(node: TransformNode, bones: Map<string, TransformNode>, forward: Vector3): boolean {
  const parent = node.parent as TransformNode | null;
  const right = palmOf(bones, "r");
  const left = palmOf(bones, "l");
  if (!parent || !right || !left) return false;
  const toParent = parent.getWorldMatrix().clone().invert();
  const r = Vector3.TransformCoordinates(right, toParent);
  const l = Vector3.TransformCoordinates(left, toParent);
  const up = r.subtract(l);
  if (up.lengthSquared() < 1e-6) return false;
  up.normalize();
  const face = forward.subtract(up.scale(Vector3.Dot(forward, up)));
  if (face.lengthSquared() < 1e-6) return false;
  face.normalize();
  const side = Vector3.Cross(up, face);
  node.rotationQuaternion = Quaternion.FromRotationMatrix(Matrix.FromValues(
    side.x, side.y, side.z, 0,
    up.x, up.y, up.z, 0,
    face.x, face.y, face.z, 0,
    0, 0, 0, 1,
  ));
  node.position.copyFrom(r);
  return true;
}

// Instrument d'un personnage de l'éditeur d'apparence (voir createCustom) : son attache, le repère qui suit les mains,
// l'os de sa place (home) et ses placements à sa place (rest, relevé au départ) et joué (play), dans leur repère.
// releasedAt : instant (s) où l'on a cessé de jouer ; from : placement au début du retour à sa place.
interface Snapshot {
  position: Vector3;
  rotation: Quaternion;
  scale: number;
}
interface PlayedInstrument {
  node: TransformNode;
  frame: TransformNode;
  home: TransformNode;
  rest: Snapshot | null;
  play: Snapshot;
  releasedAt: number | null;
  from: Snapshot | null;
}

function snapshot(node: TransformNode): Snapshot {
  return {
    position: node.position.clone(),
    rotation: node.rotationQuaternion?.clone() ?? node.rotation.toQuaternion(),
    scale: node.scaling.x,
  };
}

// Remet un placement, en angles d'Euler (comme ceux réglés dans l'éditeur).
function applySnapshot(node: TransformNode, { position, rotation, scale }: Snapshot) {
  node.rotationQuaternion = null;
  node.position.copyFrom(position);
  node.rotation.copyFrom(rotation.toEulerAngles());
  node.scaling.setAll(scale);
}

// Placement « joué » par défaut d'un luth Quaternius (caisse vers +y du modèle, manche vers -y, table vers +z) : manche
// tourné vers la main gauche, point gratté (bas de la caisse) sous la paume droite, un peu vers le ventre ; même taille à
// l'écran qu'à sa place.
const QUATERNIUS_LUTE_STRUM = new Vector3(0, 0.55, 0.03);
function defaultPlay(node: TransformNode, torso: TransformNode): Snapshot {
  node.computeWorldMatrix(true);
  const torsoScale = torso.absoluteScaling.x || 1;
  const scale = node.absoluteScaling.x / torsoScale;
  const rotation = Quaternion.Identity();
  const strum = QUATERNIUS_LUTE_STRUM.scale(scale).applyRotationQuaternion(rotation);
  const behind = (LUTE_BEHIND_HAND * CHARACTER_SCALE) / torsoScale;
  return { position: strum.negate().subtractInPlace(new Vector3(0, 0, behind)), rotation, scale };
}

// Milieu de la paume : entre le poignet (os de la main) et la base du majeur.
function palmOf(bones: Map<string, TransformNode>, side: "r" | "l"): Vector3 | null {
  const wrist = bones.get(`hand_${side}`);
  const finger = bones.get(`middle_01_${side}`);
  if (!wrist || !finger) return null;
  return Vector3.Center(wrist.getAbsolutePosition(), finger.getAbsolutePosition());
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

// Accélération des gestes longs du Gardien (voir abilityRates).
const GARDIEN_GESTURE_RATE = 2.33 / 1.5;

// Une classe sans entrée ici reste affichée en capsule.
export const CHARACTERS: Record<string, CharacterDef> = {
  gardien: {
    model: "characters/gardien.glb",
    weapons: [
      { model: "weapons/sword.glb", ...grip("r", SWORD_HANDLE) },
      {
        model: "weapons/shield.glb",
        bone: "lowerarm_l",
        position: [0, 0.15, 0],
        rotation: [0, -Math.PI / 2, 0],
      },
    ],
    animations: {
      idle: "Idle_Shield_Loop",
      attacks: ["Sword_Regular_A"],
      abilities: {
        shieldBash: "Shield_OneShot",
        guard: "Sword_Block",
        powerStrike: "Sword_Heavy_C",
        cripplingStrike: "Sword_Heavy_D",
        taunt: "Mixamo_Taunt_Chest_Thump",
        rallyCry: "Mixamo_Waving",
        // La Charge : course (posture), puis l'attaque sautée à l'arrivée.
        charge: "",
        chargeImpact: "Mixamo_Sword_Shield_Attack",
        rampart: "",
        default: "Yes",
      },
      // Trois gestes trop longs, accélérés d'autant : la Frappe handicapante (2,33 s) passe à 1,5 s, la plus courte ;
      // la Provocation (2,83 s) à 1,8 s et le Cri de ralliement (3,17 s) à 2 s.
      abilityRates: { cripplingStrike: GARDIEN_GESTURE_RATE, taunt: GARDIEN_GESTURE_RATE, rallyCry: GARDIEN_GESTURE_RATE },
      stances: { charge: "Sprint_Loop", rampart: "Mixamo_Shield_Block_Idle" },
    },
  },
  lame: {
    model: "characters/lame.glb",
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
        kick: "Kick",
        poisonBlade: "Sword_Regular_A",
        gangrene: "Sword_Regular_C",
        armorBreak: "Sword_Heavy_C",
        default: "Yes",
      },
    },
  },
  arcaniste: {
    model: "characters/arcaniste.glb",
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
    animations: {
      idle: "Idle_Loop",
      attacks: CASTER_ATTACKS,
      // Sorts instantanés (Concentration, Puissance arcanique) : geste commun au lancement.
      abilities: { default: CAST_RELEASE },
      // Sorts incantés : un seul geste, de l'incantation au lancement (le bâton est rangé dans le dos pendant le sort,
      // voir PlayerVisual). release : moment où les mains partent en avant ou frappent, mesuré dans chaque animation.
      castGestures: {
        firebolt: { animation: "Mixamo_Casting_Spell", release: 1.0 },
        frostbolt: { animation: "Mixamo_Casting_Spell", release: 1.0 },
        blast: { animation: "Mixamo_2H_Area_Attack_02", release: 1.8 },
        frostNova: { animation: "Mixamo_2H_Area_Attack_02", release: 1.8 },
        nearSight: { animation: "Mixamo_2H_Magic_Attack_05", release: 2.0 },
        burn: { animation: "Mixamo_2H_Magic_Attack_04", release: 1.0 },
        bubble: { animation: "Mixamo_2H_Cast_01", release: 1.3 },
      },
    },
  },
  pretre: {
    model: "characters/pretre.glb",
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
    hairColor: "#5a3a22",
    weapons: [
      { model: "weapons/dagger.glb", ...grip("r", DAGGER_HANDLE), scale: 0.35, hiddenWhilePlaying: true },
      // Le luth est porté en bandoulière dans le dos, manche au-dessus de l'épaule ; il passe entre les mains quand le
      // Barde en joue (instrument).
      {
        model: "weapons/lute.glb",
        bone: "spine_03",
        position: [0, 0.1, -0.18],
        rotation: [(13 * Math.PI) / 12, (13 * Math.PI) / 12, Math.PI / 12],
        scale: 0.6,
        instrument: true,
      },
    ],
    animations: { idle: "Idle_Loop", attacks: ["Sword_Attack"], abilities: { default: CAST_RELEASE } },
  },
};

// Noms de toutes les animations attribuées aux classes (attente, coups, compétences, incantations), et de celles
// choisies dans animation-lab.html (geste du lanceur, réaction de la cible).
export function usedAnimations(): Set<string> {
  // La roulade (toutes les classes, voir CharacterAnimator.roll).
  const names = new Set<string>(["Roll"]);
  for (const { animations: set } of Object.values(CHARACTERS)) {
    names.add(set.idle);
    const lists = [
      set.attacks,
      Object.values(set.abilities),
      Object.values(set.casts ?? {}),
      Object.values(set.castGestures ?? {}).map((gesture) => gesture.animation),
      Object.values(set.stances ?? {}),
    ];
    for (const name of lists.flat()) if (name) names.add(name);
  }
  for (const entries of Object.values(TUNING)) {
    for (const entry of Object.values(entries)) {
      for (const clip of entry.clips) names.add(clip.animation);
      if (entry.impact?.reaction) names.add(entry.impact.reaction.animation);
    }
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
  // Os des mains (droite, gauche) : les effets d'incantation se forment entre elles.
  hands: TransformNode[];
  // Os du squelette par nom (points d'accroche des effets).
  bones: Map<string, TransformNode>;
  // Personnage assemblé dans l'éditeur d'apparence : armes et accessoires par clé de placement (voir appearance.ts),
  // pour les régler à la souris.
  attachments?: { key: string; node: TransformNode }[];
  // Range les armes qui le prévoient (le bâton dans le dos) ou les remet en main.
  setStowed(stowed: boolean): void;
  // Joue de son instrument (luth entre les mains, dague cachée) ou le remet en bandoulière. À appeler à chaque image :
  // le luth suit les mains, puis revient en douceur (aussitôt avec instant).
  setPlaying(playing: boolean, instant?: boolean): void;
  dispose(): void;
}

// Gabarit du reciblage Mixamo : un corps de race des personnages du jeu, sinon le modèle du Prêtre (tous partagent le
// squelette de nos bibliothèques d'animations).
export function mixamoTemplate(): string {
  return raceBody() ?? CHARACTERS.pretre.model;
}

// Personnage assemblé (voir CharacterAssets.create) : apparence, objets, placements et couleurs des tenues ; body : corps
// déjà assemblé d'un personnage du jeu.
export type CustomCharacter = { appearance: Appearance; items: MountedItem[]; mounts: Record<string, Mount>; recolors: Recolor[]; body?: string };

// Charge une seule fois chaque fichier, puis crée autant d'instances que de joueurs.
export class CharacterAssets {
  private containers = new Map<string, Promise<AssetContainer>>();
  // Ombres portées : chaque personnage créé (et ses armes) projette son ombre.
  shadows: Shadows | null = null;
  // Attente avant tout téléchargement (jeu : l'écran de choix de classe passe d'abord, voir lobbyPriority).
  gate: Promise<void> | null = null;
  // Animations Mixamo, reciblées une fois sur un personnage modèle invisible (voir mixamo.ts).
  private mixamo: Promise<AnimationGroup[]> | null = null;
  // Éditeur d'apparence : textures de couleur (variantes, teintes), chargées une fois par fichier et par teinte, avec le
  // nombre de personnages qui s'en servent (une texture teinte est libérée quand plus personne ne l'utilise).
  private colorTextures = new Map<string, { texture: Promise<Texture>; uses: number }>();
  // Éditeur d'apparence : animations reciblées une fois par monstre (ou adaptées une fois par modèle complet), sur un
  // exemplaire caché (voir createCustom).
  private monsterAnimations = new Map<string, Promise<AnimationGroup[]>>();

  // libraries : bibliothèques d'animations à charger (la page de visualisation charge les versions complètes).
  // mixamoOnly : seules ces animations Mixamo sont chargées et reciblées (le choix de classe n'en joue que quelques-unes,
  // inutile de décoder toutes les autres pendant que le jeu charge).
  constructor(
    private scene: Scene,
    private libraries: string[] = ANIMATION_LIBRARIES,
    private mixamoOnly?: ReadonlySet<string>,
  ) {
    registerBuiltInLoaders();
  }

  // Lance le téléchargement de tout ce qui est connu, pour qu'il soit prêt à l'apparition des joueurs.
  // track : suivi du chargement (écran de chargement). Poids : un modèle compte pour 10 sons environ dans la barre de chargement.
  preload(track: <T>(task: Promise<T>, weight?: number) => Promise<T> = (task) => task) {
    for (const url of this.libraries) void track(this.load(url), 10);
    void track(this.loadMixamo(), 20);
    // Personnages des deux camps (corps et objets) ; le modèle d'une classe seulement s'il sert encore.
    for (const file of gameCharacterFiles()) void track(this.load(file), file.includes("/items/") ? 2 : 10);
    for (const [classId, def] of Object.entries(CHARACTERS)) {
      if (hasBothCamps(classId)) continue;
      void track(this.load(def.model), 10);
      for (const weapon of def.weapons) void track(this.load(weapon.model), 2);
    }
  }

  private load(url: string): Promise<AssetContainer> {
    let container = this.containers.get(url);
    if (!container) {
      // Aucune animation lancée au chargement : elles sont jouées sur les personnages, pas sur les modèles d'origine.
      const options = { pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } };
      // Un chemin absolu (commençant par /) est pris tel quel, les autres sont relatifs à public/models/.
      const gate = this.gate ?? Promise.resolve();
      container = gate.then(() => LoadAssetContainerAsync(url.startsWith("/") ? url : assetUrl(`models/${url}`), this.scene, options)).then((loaded) => {
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
      const model = await this.load(mixamoTemplate());
      const template = model.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
      const root = template.rootNodes[0] as TransformNode;
      root.setEnabled(false);
      const groups: AnimationGroup[] = [];
      // Le jeu ne charge que les animations Mixamo attribuées à une classe ; la page de visualisation, qui charge les
      // bibliothèques complètes, les prend toutes.
      const all = this.libraries !== ANIMATION_LIBRARIES;
      const used = usedAnimations();
      for (const [name, url] of Object.entries(MIXAMO_ANIMATIONS)) {
        if (this.mixamoOnly ? !this.mixamoOnly.has(name) : !all && !used.has(name)) continue;
        const group = retargetMixamo(name, await this.load(url), root);
        if (group) groups.push(group);
      }
      return groups;
    })();
    return this.mixamo;
  }

  // custom : personnage assemblé dans l'éditeur d'apparence (développement), à la place du modèle de la classe, avec
  // ses objets à accrocher (voir mountedItems) et leurs placements réglés pour ce modèle (par clé) ; ou personnage du
  // jeu construit d'après lui (GameAppearance : corps préassemblé, voir scripts/build-appearances.ts).
  async create(classId: string, parent: TransformNode, only?: ReadonlySet<string>, custom?: CustomCharacter): Promise<CharacterInstance | null> {
    const def = CHARACTERS[classId];
    if (!def) return null;
    if (custom) return this.createCustom(def, custom, parent, only);
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
    // Instrument (et sa place en bandoulière), armes cachées pendant qu'on en joue.
    // releasedAt : instant (s) où l'on a cessé de jouer ; from : position tenue au début du retour en bandoulière.
    const instruments: {
      attach: TransformNode;
      rest: Placement;
      restPosition: Vector3;
      restRotation: Quaternion;
      releasedAt: number | null;
      from: { position: Vector3; rotation: Quaternion } | null;
    }[] = [];
    const hiddenWhilePlaying: TransformNode[] = [];
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
      if (mount.instrument) {
        instruments.push({
          attach,
          rest: mount,
          restPosition: new Vector3(...mount.position),
          restRotation: Quaternion.FromEulerAngles(...mount.rotation),
          releasedAt: null,
          from: null,
        });
      }
      if (mount.hiddenWhilePlaying) hiddenWhilePlaying.push(attach);
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
    // Les petites pièces posées sur le corps (yeux, accessoires, ceintures…) ne projettent pas d'ombre : vue du soleil,
    // elles restent dans la silhouette du corps, et chacune coûterait un appel de dessin de plus à chaque image.
    this.shadows?.cast(meshes.filter((mesh) => !NO_SHADOW_PIECES.test(mesh.name)));

    return {
      root,
      set: def.animations,
      meshes,
      animations,
      weapons,
      hands: ["hand_r", "hand_l"].map((name) => bones.get(name)).filter((bone): bone is TransformNode => !!bone),
      bones,
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
      setPlaying: (playing, instant = false) => {
        const now = performance.now() / 1000;
        let busy = playing;
        for (const instrument of instruments) {
          const { attach, rest } = instrument;
          if (playing) {
            instrument.releasedAt = null;
            instrument.from = null;
            holdInstrument(attach, bones);
            continue;
          }
          // Déjà en bandoulière.
          if (!attach.rotationQuaternion) continue;
          instrument.releasedAt ??= now;
          const elapsed = now - instrument.releasedAt;
          if (!instant && elapsed < INSTRUMENT_FOLLOW) {
            holdInstrument(attach, bones);
            busy = true;
            continue;
          }
          instrument.from ??= { position: attach.position.clone(), rotation: attach.rotationQuaternion.clone() };
          const progress = instant ? 1 : Math.min(1, (elapsed - INSTRUMENT_FOLLOW) / INSTRUMENT_RETURN);
          if (progress >= 1) {
            attach.rotationQuaternion = null;
            attach.position.set(...rest.position);
            attach.rotation.set(...rest.rotation);
            instrument.releasedAt = null;
            instrument.from = null;
            continue;
          }
          const eased = progress * progress * (3 - 2 * progress);
          Vector3.LerpToRef(instrument.from.position, instrument.restPosition, eased, attach.position);
          Quaternion.SlerpToRef(instrument.from.rotation, instrument.restRotation, eased, attach.rotationQuaternion);
          busy = true;
        }
        // La dague revient en main une fois le luth rangé.
        for (const attach of hiddenWhilePlaying) attach.setEnabled(!busy);
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

  // Personnage de l'éditeur d'apparence : corps d'une race et pièces de tenue (toutes sur le même squelette), ou
  // monstre (squelette Mixamo, animations reciblées), plus ses armes et accessoires aux placements réglés. Il garde
  // les animations de sa classe ; pas d'arme rangée. Avec body (personnage du jeu), le corps est ce fichier déjà
  // assemblé et les fichiers sont relatifs à public/models/ ; sinon, ce sont ceux de l'éditeur.
  private async createCustom(
    def: CharacterDef,
    { appearance, items, mounts, recolors, body }: CustomCharacter,
    parent: TransformNode,
    only?: ReadonlySet<string>,
  ): Promise<CharacterInstance> {
    const url = body ? (file: string) => file : appearanceUrl;
    const monster = isMonster(appearance.model);
    const custom = isCustom(appearance.model);
    const pieceFiles = monster || custom ? [] : [...appearance.parts.map((p) => `parts/${p}.glb`), ...appearance.hair.map((h) => `hair/${h}.glb`)];
    // Textures de couleur réservées dès le départ : rendues si la création échoue. Pour chaque objet dont des cases de
    // la palette Hearthfold sont repeintes, sa palette repeinte.
    const colorKeys = recolors.map((recolor) => this.acquireColorTexture(recolor));
    const itemKeys = items.map((item) => {
      const cells = Object.fromEntries(
        Object.entries(item.colors ?? {})
          .filter(([zone]) => /^c\d+$/.test(zone))
          .map(([zone, color]) => [Number(zone.slice(1)), color]),
      );
      if (!item.palette || !Object.keys(cells).length) return null;
      return this.acquireColorTexture({ material: item.palette.material, texture: item.palette.texture, cells: { grid: item.palette.grid, colors: cells } });
    });
    const releaseAll = () => {
      for (const key of [...colorKeys, ...itemKeys]) if (key) this.releaseColorTexture(key);
    };
    let loaded;
    try {
      loaded = await Promise.all([
        Promise.all(colorKeys.map((key) => this.colorTextures.get(key)!.texture)),
        Promise.all(itemKeys.map((key) => (key ? this.colorTextures.get(key)!.texture : null))),
        this.load(body ?? appearanceUrl(modelFile(appearance))),
      Promise.all(this.libraries.map((url) => this.load(url))),
      this.loadMixamo(),
      Promise.all(pieceFiles.map((file) => this.load(appearanceUrl(file)))),
        Promise.all(items.map((item) => this.load(url(item.file)))),
      ]);
    } catch (error) {
      releaseAll();
      throw error;
    }
    const [textures, itemTextures, base, libraries, mixamo, pieces, held] = loaded;

    const entries = base.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
    const root = entries.rootNodes[0] as TransformNode;
    root.parent = parent;
    root.scaling.scaleInPlace(CHARACTER_SCALE);
    const nodes = new Map<string, TransformNode>();
    for (const node of root.getDescendants(false)) if (node instanceof TransformNode) nodes.set(node.name, node);
    const cleanup: (() => void)[] = [releaseAll];
    const meshes = root.getChildMeshes(false);

    // Pièces de tenue et coiffures : chacune arrive avec sa copie du squelette ; ses os suivent ceux du corps.
    for (const piece of pieces) {
      const pieceEntries = piece.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
      const pieceRoot = pieceEntries.rootNodes[0] as TransformNode;
      pieceRoot.parent = parent;
      pieceRoot.scaling.scaleInPlace(CHARACTER_SCALE);
      for (const skeleton of pieceEntries.skeletons) {
        for (const bone of skeleton.bones) {
          const node = nodes.get(bone.name);
          if (node) bone.linkTransformNode(node);
        }
      }
      meshes.push(...pieceRoot.getChildMeshes(false));
      cleanup.push(() => {
        pieceRoot.dispose(false, false);
        for (const skeleton of pieceEntries.skeletons) skeleton.dispose();
      });
    }

    // Cheveux : ceux d'une race retirés (crâne rasé, ou une autre coupe les remplace), et teinte choisie des coiffures
    // humaines et des sourcils (sur une copie des matériaux, partagés avec les autres personnages du même fichier).
    if (appearance.raceHair === false || appearance.hair.some(isHairCut)) {
      for (const mesh of meshes.filter((m) => m.name.endsWith("_Hair") && m.isDescendantOf(root))) {
        meshes.splice(meshes.indexOf(mesh), 1);
        mesh.dispose();
      }
    }
    if (appearance.hairColor) {
      const color = Color3.FromHexString(appearance.hairColor);
      const tinted = new Map<PBRMaterial, PBRMaterial>();
      for (const mesh of meshes) {
        const material = mesh.material as PBRMaterial | null;
        if (!material || !material.name.startsWith("MI_Hair")) continue;
        let copy = tinted.get(material);
        if (!copy) {
          copy = material.clone(`${material.name}-tinted`);
          copy.albedoColor = color;
          tinted.set(material, copy);
        }
        mesh.material = copy;
      }
      cleanup.push(() => {
        // Les textures des copies sont partagées avec les matériaux d'origine : seule la copie est libérée.
        for (const copy of tinted.values()) copy.dispose(false, true);
      });
    }

    // Couleurs : la texture de couleur des matériaux concernés est remplacée, sur une copie du matériau (partagé avec les
    // autres personnages du même fichier). Les textures, elles, sont partagées entre personnages.
    recolors.forEach((recolor, i) => {
      const copies = new Map<PBRMaterial, PBRMaterial>();
      for (const mesh of meshes) {
        const material = mesh.material as PBRMaterial | null;
        if (material?.name !== recolor.material) continue;
        let copy = copies.get(material);
        if (!copy) {
          copy = material.clone(`${material.name}-recolor`);
          copy.albedoTexture?.dispose();
          copy.albedoTexture = textures[i];
          copies.set(material, copy);
        }
        mesh.material = copy;
      }
      cleanup.push(() => {
        for (const copy of copies.values()) {
          copy.albedoTexture = null;
          copy.dispose(false, true);
        }
      });
    });

    // Os par nom : ceux du modèle, plus nos noms d'os pour un monstre (points d'accroche des effets).
    const bones = new Map(nodes);
    if (monster) {
      for (const [ours, mixamoName] of UAL_TO_MIXAMO) {
        const node = nodes.get(mixamoName);
        if (node && !bones.has(ours)) bones.set(ours, node);
      }
    }

    // Armes et accessoires, placés avant les animations : un placement par défaut se calcule sur la pose de repos.
    for (const node of [root, ...root.getDescendants(false)]) (node as TransformNode).computeWorldMatrix?.(true);
    const attachments: { key: string; node: TransformNode }[] = [];
    items.forEach((item, i) => {
      const fbx = item.file.endsWith(".fbx");
      // Arme en main d'un corps Quaternius (ou d'un modèle complet, même squelette) : la prise des armes du jeu (lame vers le haut du modèle, poignée au point
      // d'origine) ; sinon, posé droit au point d'accroche.
      const hand = !monster && /@(right|left)$/.test(item.key);
      const mount =
        mounts[item.key] ??
        (hand
          ? { ...grip(item.socket.bone.endsWith("r") ? "r" : "l", 0), scale: fbx ? 0.01 : 1 }
          : item.hang
            ? defaultHangMount(root, nodes, appearance.model, item.socket)
            : defaultMount(root, nodes, appearance.model, item.socket, fbx));
      const bone = mount && nodes.get(mount.bone);
      if (!mount || !bone) return;
      const attach = new TransformNode(`attach-${item.key}`, this.scene);
      if (item.hang) {
        // Cape : un cadre suit l'os en restant droit et tourné comme le personnage, avec son balancement ; le placement
        // réglé (position, rotation, taille) se fait dans ce cadre.
        const frame = new TransformNode(`hang-${item.key}`, this.scene);
        frame.parent = parent;
        attach.parent = frame;
        attach.metadata = { mountBone: bone.name };
        const observer = hangCape(this.scene, frame, root, bone);
        cleanup.push(() => {
          observer.remove();
          frame.dispose(false, false);
        });
      } else attach.parent = bone;
      attach.position.set(...mount.position);
      attach.rotation.set(...mount.rotation);
      attach.scaling.setAll(mount.scale);
      const instance = held[i].instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
      for (const node of instance.rootNodes) {
        if (node.name === "__root__" || node.name === "__fbx_root__") {
          for (const child of node.getChildren()) (child as TransformNode).parent = attach;
          node.dispose();
        } else (node as TransformNode).parent = attach;
      }
      // Paire : la pièce droite est à la racine, la gauche en enfant « _L » (décalée comme portée) ; on garde l'une
      // ou l'autre, la gauche ramenée sur son propre point d'accroche.
      if (item.part) {
        const left = attach.getDescendants(false).find((node) => node.name.endsWith("_L")) as TransformNode | undefined;
        if (item.part === "right") left?.dispose();
        else if (left) {
          const right = attach.getChildren();
          left.parent = attach;
          left.position.setAll(0);
          for (const node of right) if (node !== left) node.dispose();
        }
      }
      if (item.colors) {
        const copies = paintItem(this.scene, attach, item.colors, item.palette?.material, itemTextures[i]);
        cleanup.push(() => copies.forEach(disposePainted));
      }
      meshes.push(...attach.getChildMeshes(false));
      attachments.push({ key: item.key, node: attach });
    });

    // Instruments : pendant une animation de jeu, le luth quitte sa place (dans le dos) pour un repère qui suit les mains
    // (voir followHands), accroché au buste ; son placement « joué » s'y règle (onglet Placement, clé playKey). L'avant du
    // buste est mesuré ici, sur la pose de repos : la droite du personnage (de la paume gauche à la droite) croisée avec
    // le haut.
    const torso = bones.get("spine_03") ?? root;
    const restRightPalm = palmOf(bones, "r");
    const restLeftPalm = palmOf(bones, "l");
    const forward =
      restRightPalm && restLeftPalm
        ? Vector3.TransformNormal(Vector3.Cross(restRightPalm.subtract(restLeftPalm), Vector3.Up()), torso.getWorldMatrix().clone().invert()).normalize()
        : new Vector3(...TORSO_FORWARD);
    const players: PlayedInstrument[] = [];
    for (const item of items) {
      const node = item.playKey && attachments.find((a) => a.key === item.key)?.node;
      if (!item.playKey || !node) continue;
      const frame = new TransformNode(PLAY_FRAME, this.scene);
      frame.parent = torso;
      cleanup.push(() => frame.dispose(false, false));
      const tuned = mounts[item.playKey];
      players.push({
        node,
        frame,
        home: node.parent as TransformNode,
        rest: null,
        play: tuned
          ? { position: new Vector3(...tuned.position), rotation: Quaternion.FromEulerAngles(...tuned.rotation), scale: tuned.scale }
          : defaultPlay(node, torso),
        releasedAt: null,
        from: null,
      });
      attachments.push({ key: item.playKey, node });
    }
    // Armes tenues en main, cachées pendant qu'on joue (la main qui gratte).
    const instrumentNodes = new Set(players.map((p) => p.node));
    const hiddenWhilePlaying = attachments
      .filter((a) => /@(right|left)$/.test(a.key) && !instrumentNodes.has(a.node))
      .map((a) => a.node);

    // Animations rebranchées par nom d'os : celles de nos bibliothèques pour un corps (même squelette), celles
    // reciblées une fois pour ce monstre, ou adaptées une fois à ce modèle complet (voir customAnimationsOf).
    let sources = [...libraries.flatMap((library) => library.animationGroups), ...mixamo];
    if (monster || custom) {
      try {
        sources = await (monster ? this.monsterAnimationsOf(appearance.model, base, sources) : this.customAnimationsOf(appearance.model, base, sources));
      } catch (error) {
        // Échec : tout ce qui a déjà été créé (pièces, capes et leur balancement, objets, corps) est libéré.
        for (const { node } of attachments) node.dispose(false, false);
        for (const run of cleanup) run();
        root.dispose(false, false);
        for (const skeleton of entries.skeletons) skeleton.dispose();
        throw error;
      }
    }
    const animations = new Map<string, AnimationGroup>();
    for (const group of sources) {
      if (only && !only.has(group.name)) continue;
      const clone = group.clone(group.name, (target: { name: string }) => nodes.get(target.name) ?? null);
      clone.stop();
      animations.set(group.name, clone);
    }

    this.shadows?.cast(meshes.filter((mesh) => !NO_SHADOW_PIECES.test(mesh.name)));
    // Points d'accroche « arme » des effets : armes et accessoires tenus par un os, pas les capes (qui se balancent).
    const weapons = attachments.filter((a) => !items.find((item) => item.key === a.key)?.hang).map((a) => a.node);
    return {
      root,
      set: def.animations,
      meshes,
      animations,
      weapons,
      attachments,
      hands: ["hand_r", "hand_l"].map((name) => bones.get(name)).filter((bone): bone is TransformNode => !!bone),
      bones,
      setStowed: () => undefined,
      setPlaying: (playing, instant = false) => {
        const now = performance.now() / 1000;
        // Sans instrument, rien n'est caché.
        let busy = playing && players.length > 0;
        for (const p of players) {
          const { node, frame } = p;
          if (playing) {
            // Reprise pendant le retour : le luth est à mi-chemin, sa place reste celle relevée au départ.
            const returning = !!p.from;
            p.releasedAt = null;
            p.from = null;
            if (node.parent !== frame) {
              // Sa place dans le dos est relevée à chaque départ (elle a pu être réglée entre-temps).
              if (!returning || !p.rest) p.rest = snapshot(node);
              node.parent = frame;
              applySnapshot(node, p.play);
            }
            followHands(frame, bones, forward);
            continue;
          }
          // Déjà à sa place.
          if (node.parent !== frame && !p.from) continue;
          p.releasedAt ??= now;
          const elapsed = now - p.releasedAt;
          if (node.parent === frame) {
            if (!instant && elapsed < INSTRUMENT_FOLLOW) {
              followHands(frame, bones, forward);
              busy = true;
              continue;
            }
            // Le placement « joué » (réglé entre-temps peut-être) est gardé pour la prochaine fois ; le luth repart de là
            // où il est à l'écran, dans le repère de sa place.
            p.play = snapshot(node);
            node.rotationQuaternion ??= node.rotation.toQuaternion();
            frame.computeWorldMatrix(true);
            node.computeWorldMatrix(true);
            node.setParent(p.home);
            p.from = snapshot(node);
          }
          const rest = p.rest ?? snapshot(node);
          const progress = instant ? 1 : Math.min(1, (elapsed - INSTRUMENT_FOLLOW) / INSTRUMENT_RETURN);
          if (progress >= 1 || !p.from) {
            applySnapshot(node, rest);
            p.releasedAt = null;
            p.from = null;
            continue;
          }
          const eased = progress * progress * (3 - 2 * progress);
          Vector3.LerpToRef(p.from.position, rest.position, eased, node.position);
          node.rotationQuaternion ??= new Quaternion();
          Quaternion.SlerpToRef(p.from.rotation, rest.rotation, eased, node.rotationQuaternion);
          node.scaling.setAll(p.from.scale + (rest.scale - p.from.scale) * eased);
          busy = true;
        }
        // Les armes en main reviennent une fois le luth rangé.
        for (const node of hiddenWhilePlaying) node.setEnabled(!busy);
      },
      dispose() {
        for (const group of animations.values()) group.dispose();
        for (const { node } of attachments) node.dispose(false, false);
        for (const run of cleanup) run();
        root.dispose(false, false);
        for (const skeleton of entries.skeletons) skeleton.dispose();
      },
    };
  }

  // Réserve la texture de couleur d'un matériau (éditeur d'apparence), teinte au besoin, et rend sa clé. Mêmes réglages
  // que les textures des glTF (pas d'inversion verticale). Un échec de chargement n'est pas gardé : on réessaiera.
  private acquireColorTexture({ texture, tint, cells }: Recolor): string {
    const painted = cells
      ? Object.entries(cells.colors)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([cell, color]) => `${cell}=${color}`)
          .join(",")
      : "";
    const key = `${texture}|${tint ? `${tint.from}>${tint.color}` : ""}${painted}`;
    let entry = this.colorTextures.get(key);
    if (!entry) {
      const source = async () => (cells ? paintCells(texture, cells.grid, cells.colors) : tint ? tintImage(texture, tint.color, tint.from) : texture);
      const promise = (async () => new Texture(await source(), this.scene, false, false))();
      entry = { texture: promise, uses: 0 };
      this.colorTextures.set(key, entry);
      promise.catch(() => this.colorTextures.delete(key));
    }
    entry.uses++;
    return key;
  }

  // Rend une texture de couleur : une teinte que plus personne n'utilise est libérée (les variantes du pack restent).
  private releaseColorTexture(key: string) {
    const entry = this.colorTextures.get(key);
    if (!entry || --entry.uses > 0 || key.endsWith("|")) return;
    this.colorTextures.delete(key);
    void entry.texture.then((texture) => texture.dispose()).catch(() => undefined);
  }

  // Recible nos animations sur le squelette Mixamo d'un monstre (poses de repos différentes), une seule fois, sur un
  // exemplaire caché : les animations obtenues visent ses os par leur nom et se clonent sur chaque personnage. Les
  // déplacements d'os sont retirés (les os Mixamo n'ont pas nos proportions), sauf celui du bassin, mis à l'échelle du
  // monstre (voir scaledHipsAnimation).
  private monsterAnimationsOf(model: string, base: AssetContainer, sources: AnimationGroup[]): Promise<AnimationGroup[]> {
    let groups = this.monsterAnimations.get(model);
    if (!groups) {
      const template = base.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
      const root = template.rootNodes[0] as TransformNode;
      root.setEnabled(false);
      const present = new Set(root.getDescendants(false).map((node) => node.name));
      const names = new Map([...UAL_TO_MIXAMO].filter(([, mixamoName]) => present.has(mixamoName)));
      const avatar = new AnimatorAvatar(`avatar-${model}`, root, false, false);
      // Les os de nos personnages absents chez le monstre (doigts…) sont simplement ignorés.
      avatar.showWarnings = false;
      // Bassin : sa hauteur et ses déplacements suivent ceux de nos animations, à l'échelle du monstre (il descend au sol
      // quand on meurt) ; les positions des autres os (à nos proportions) sont retirées.
      const hips = names.get("pelvis");
      const hipsNode = hips ? root.getDescendants(false).find((node) => node.name === hips) : undefined;
      groups = Promise.resolve(
        sources.map((group) => {
          const retargeted = avatar.retargetAnimationGroup(group, { mapNodeNames: names, animationGroupName: group.name, fixRootPosition: false });
          for (const target of [...retargeted.targetedAnimations]) {
            if (target.animation.targetProperty === "position") retargeted.removeTargetedAnimation(target.animation);
          }
          const pelvis = group.targetedAnimations.find((t) => t.animation.targetProperty === "position" && (t.target as { name?: string }).name === "pelvis");
          if (pelvis && hipsNode instanceof TransformNode) {
            retargeted.addTargetedAnimation(scaledHipsAnimation(pelvis.animation, pelvis.target as TransformNode, hipsNode), hipsNode);
          }
          retargeted.stop();
          return retargeted;
        }),
      );
      this.monsterAnimations.set(model, groups);
    }
    return groups;
  }

  // Modèle complet sur notre squelette (mêmes noms et axes d'os, autres proportions) : nos animations s'y branchent
  // telles quelles pour les rotations ; les déplacements d'os sont retirés, sauf celui du bassin, mis à l'échelle du
  // modèle (voir scaledHipsAnimation). Préparées une seule fois, sur un exemplaire caché.
  private customAnimationsOf(model: string, base: AssetContainer, sources: AnimationGroup[]): Promise<AnimationGroup[]> {
    let groups = this.monsterAnimations.get(model);
    if (!groups) {
      const template = base.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
      const root = template.rootNodes[0] as TransformNode;
      root.setEnabled(false);
      const nodes = new Map<string, TransformNode>();
      for (const node of root.getDescendants(false)) if (node instanceof TransformNode) nodes.set(node.name, node);
      // Copies des animations : normalize ajoute des clés aux bornes, et les originales servent aux autres personnages.
      const adapted: AnimationGroup[] = [];
      try {
        for (const group of sources) {
          const copy = new AnimationGroup(group.name, this.scene);
          adapted.push(copy);
          for (const { animation, target } of group.targetedAnimations) {
            const name = (target as { name?: string }).name ?? "";
            const node = nodes.get(name);
            if (!node) continue;
            if (animation.targetProperty !== "position") copy.addTargetedAnimation(animation.clone(), node);
            else if (name === "pelvis") copy.addTargetedAnimation(scaledHipsAnimation(animation, target as TransformNode, node), node);
          }
          copy.normalize(group.from, group.to);
          copy.stop();
        }
      } catch (error) {
        // Échec : l'exemplaire caché et les groupes déjà faits sont libérés (rien n'est gardé, un essai suivant repart de zéro).
        for (const group of adapted) group.dispose();
        root.dispose(false, false);
        for (const skeleton of template.skeletons) skeleton.dispose();
        return Promise.reject(error);
      }
      groups = Promise.resolve(adapted);
      this.monsterAnimations.set(model, groups);
    }
    return groups;
  }
}

// Position du bassin d'une de nos animations, rapportée au bassin d'un monstre (ou d'un modèle complet) : chaque déplacement par rapport à la
// pose de repos est passé dans le repère du monde, mis à l'échelle (hauteur du bassin du monstre sur la nôtre), puis
// ramené dans le repère du parent du bassin du monstre. Les parents des deux bassins (racines des modèles) ne bougent pas
// (pour un modèle complet, l'os racine garde la rotation de nos animations, constante dans nos bibliothèques).
function scaledHipsAnimation(source: Animation, pelvis: TransformNode, hips: TransformNode): Animation {
  const sourceParent = pelvis.parent as TransformNode | null;
  const targetParent = hips.parent as TransformNode | null;
  sourceParent?.computeWorldMatrix(true);
  targetParent?.computeWorldMatrix(true);
  pelvis.computeWorldMatrix(true);
  hips.computeWorldMatrix(true);
  const ratio = hips.absolutePosition.y / (pelvis.absolutePosition.y || 1);
  const toWorld = sourceParent?.getWorldMatrix() ?? Matrix.IdentityReadOnly;
  const fromWorld = targetParent ? targetParent.getWorldMatrix().clone().invert() : Matrix.Identity();
  const sourceRest = pelvis.position.clone();
  const targetRest = hips.position.clone();
  const animation = new Animation(`${source.name}-hips`, "position", source.framePerSecond, Animation.ANIMATIONTYPE_VECTOR3, source.loopMode);
  animation.setKeys(
    source.getKeys().map((key) => {
      const delta = Vector3.TransformNormal((key.value as Vector3).subtract(sourceRest), toWorld).scaleInPlace(ratio);
      return { frame: key.frame, value: targetRest.add(Vector3.TransformNormal(delta, fromWorld)) };
    }),
  );
  return animation;
}

// Couleurs choisies d'une arme ou d'un accessoire de l'éditeur d'apparence, sur des copies de ses matériaux (partagés avec
// les autres exemplaires du même fichier) : une zone « m:<nom> » donne sa couleur au matériau de ce nom (couleur unie
// d'un FBX, ou teinte multipliée par la texture d'un glTF ; blanc : inchangé), et la palette repeinte remplace la texture du matériau de la
// palette. Rend les copies (à libérer avec disposePainted).
function paintItem(scene: Scene, attach: TransformNode, colors: Record<string, string>, paletteMaterial: string | undefined, palette: Texture | null): Material[] {
  const copies = new Map<Material, Material>();
  const copyOf = (material: Material): Material => {
    let copy = copies.get(material);
    if (copy) return copy;
    if (material instanceof MultiMaterial) {
      // Copiée seulement si un de ses sous-matériaux change.
      const subs = material.subMaterials.map((sub) => sub && copyOf(sub));
      if (subs.every((sub, i) => sub === material.subMaterials[i])) {
        copies.set(material, material);
        return material;
      }
      const multi = new MultiMaterial(`${material.name}-painted`, scene);
      multi.subMaterials = subs;
      copy = multi;
    } else {
      // Le chargeur FBX renomme les copies qu'il fait d'un matériau (couleurs de sommets, faces visibles des deux côtés).
      const name = material.name.replace(/(_CullingOff|_VertexColor)+$/, "");
      const color = colors[`m:${name}`];
      const repaint = !!palette && name === paletteMaterial;
      const clone = color || repaint ? material.clone(`${material.name}-painted`) : null;
      if (!clone) {
        copies.set(material, material);
        return material;
      }
      copy = clone;
      // Couleurs des matériaux : linéaires (celles du fichier) ; la couleur choisie est en sRGB.
      const linear = color && Color3.FromHexString(color).toLinearSpace();
      if (linear && copy instanceof StandardMaterial) copy.diffuseColor = linear;
      else if (linear) (copy as PBRMaterial).albedoColor = linear;
      if (repaint) {
        const pbr = copy as PBRMaterial;
        pbr.albedoTexture?.dispose();
        pbr.albedoTexture = palette;
        copy.metadata = { paintedPalette: true };
      }
    }
    copies.set(material, copy);
    return copy;
  };
  for (const mesh of attach.getChildMeshes(false)) if (mesh.material) mesh.material = copyOf(mesh.material);
  return [...copies].filter(([source, copy]) => source !== copy).map(([, copy]) => copy);
}

// Libère une copie de paintItem : la palette repeinte est partagée (rendue à part), les autres textures de la copie
// aussi (libérées avec elle, elles ne font que baisser le compteur de la texture d'origine).
function disposePainted(copy: Material) {
  if (copy instanceof MultiMaterial) return copy.dispose(false, false, false);
  if (copy.metadata?.paintedPalette) (copy as PBRMaterial).albedoTexture = null;
  copy.dispose(false, true);
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

// Balancement des capes : angle d'envol vers l'arrière (radians) par unité du modèle par seconde du haut de la cape vers
// l'avant (une unité vaut CHARACTER_SCALE mètres dans la scène), et de côté par unité par seconde de côté ; angles
// maximaux ; ressort amorti qui les suit (raideur, amortissement : un léger dépassement, la cape revient en se
// balançant). Au-delà de CAPE_JUMP unités par seconde, c'est un saut (animation qui reboucle, téléportation) : ignoré.
const CAPE_LIFT = 0.35;
const CAPE_SIDE = 0.25;
const CAPE_MAX_LIFT = 1;
const CAPE_MAX_SIDE = 0.4;
const CAPE_STIFFNESS = 30;
const CAPE_DAMPING = 7;
const CAPE_JUMP = 10;

// Tient une cape droite à chaque image : son cadre (enfant de parent, le support du personnage) se place à l'os, tourné
// comme le personnage mais sans suivre l'inclinaison du buste, et s'incline avec le mouvement du haut de la cape. Les
// positions sont celles de l'image précédente (un décalage invisible).
function hangCape(scene: Scene, frame: TransformNode, root: TransformNode, bone: TransformNode) {
  const swing = { lift: 0, liftSpeed: 0, side: 0, sideSpeed: 0 };
  // Objets de calcul réutilisés à chaque image.
  const last = new Vector3();
  let started = false;
  const at = new Vector3();
  const velocity = new Vector3();
  const rootScale = new Vector3();
  const rootRotation = new Quaternion();
  const inverse = new Matrix();
  const tilt = new Matrix();
  const placed = new Matrix();
  const world = new Matrix();
  frame.rotationQuaternion ??= new Quaternion();
  return scene.onBeforeRenderObservable.add(() => {
    const elapsed = scene.getEngine().getDeltaTime() / 1000;
    // Pas du ressort borné (stabilité après un à-coup) ; la vitesse, elle, se mesure sur le temps réel écoulé.
    const dt = Math.min(elapsed, 0.05);
    at.copyFrom(bone.getAbsolutePosition());
    const rootWorld = root.getWorldMatrix();
    rootWorld.decompose(rootScale, rootRotation);
    let lift = 0;
    let side = 0;
    if (started && elapsed > 0) {
      // Vitesse du haut de la cape dans le repère du personnage (z vers l'avant, x sur le côté).
      rootWorld.invertToRef(inverse);
      at.subtractToRef(last, velocity).scaleInPlace(1 / elapsed);
      Vector3.TransformNormalToRef(velocity, inverse, velocity);
      if (velocity.length() < CAPE_JUMP) {
        lift = Math.max(0, Math.min(CAPE_MAX_LIFT, velocity.z * CAPE_LIFT));
        side = Math.max(-CAPE_MAX_SIDE, Math.min(CAPE_MAX_SIDE, -velocity.x * CAPE_SIDE));
      }
    }
    last.copyFrom(at);
    started = true;
    swing.liftSpeed += ((lift - swing.lift) * CAPE_STIFFNESS - swing.liftSpeed * CAPE_DAMPING) * dt;
    swing.sideSpeed += ((side - swing.side) * CAPE_STIFFNESS - swing.sideSpeed * CAPE_DAMPING) * dt;
    swing.lift += swing.liftSpeed * dt;
    swing.side += swing.sideSpeed * dt;
    // Inclinaison dans le repère du personnage (le bas part vers l'arrière, -z), puis repère du personnage posé à l'os.
    Matrix.RotationYawPitchRollToRef(0, swing.lift, swing.side, tilt);
    Matrix.ComposeToRef(rootScale, rootRotation, at, placed);
    tilt.multiplyToRef(placed, world);
    const parent = frame.parent as TransformNode | null;
    if (parent) {
      parent.getWorldMatrix().invertToRef(inverse);
      world.multiplyToRef(inverse, world);
    }
    world.decompose(frame.scaling, frame.rotationQuaternion!, frame.position);
  });
}

// Placement par défaut d'une cape, dans son cadre (repère du personnage posé sur l'os) : le point d'accroche, un peu en
// arrière comme le prévoit le pack (6 cm derrière l'axe du corps, à l'échelle du modèle), droite, à sa taille d'origine.
function defaultHangMount(root: TransformNode, nodes: Map<string, TransformNode>, model: string, socket: DefaultSocket): Mount | null {
  const bone = nodes.get(boneName(model, socket.bone));
  const at = nodes.get(boneName(model, socket.at ?? socket.bone));
  if (!bone || !at) return null;
  const rootScale = new Vector3();
  const rootRotation = new Quaternion();
  root.getWorldMatrix().decompose(rootScale, rootRotation);
  const frame = Matrix.Compose(rootScale, rootRotation, bone.getAbsolutePosition());
  const point = Vector3.TransformCoordinates(at.getAbsolutePosition(), frame.invert());
  return { bone: bone.name, position: [point.x, point.y, point.z - 0.06], rotation: [0, 0, 0], scale: 1 };
}

// Placement par défaut d'un objet de l'éditeur d'apparence : posé au point d'accroche, droit et tourné comme le
// personnage dans sa pose de repos, à sa taille d'origine (centimètres pour un FBX).
function defaultMount(root: TransformNode, nodes: Map<string, TransformNode>, model: string, socket: DefaultSocket, fbx: boolean): Mount | null {
  const bone = nodes.get(boneName(model, socket.bone));
  const at = nodes.get(boneName(model, socket.at ?? socket.bone));
  if (!bone || !at) return null;
  const rootScale = new Vector3();
  const rootRotation = new Quaternion();
  root.getWorldMatrix().decompose(rootScale, rootRotation);
  const point = at.getAbsolutePosition().clone();
  if (socket.ground) point.y = root.getAbsolutePosition().y;
  const unit = fbx ? 0.01 : 1;
  const world = Matrix.Compose(rootScale.scale(unit), rootRotation, point);
  const local = world.multiply(bone.getWorldMatrix().clone().invert());
  const scale = new Vector3();
  const rotation = new Quaternion();
  const position = new Vector3();
  local.decompose(scale, rotation, position);
  const euler = rotation.toEulerAngles();
  return {
    bone: bone.name,
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: Math.abs(scale.x),
  };
}
