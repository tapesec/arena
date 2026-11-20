import { Engine } from "@babylonjs/core/Engines/engine";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer";
import { CHARACTERS, CharacterAssets, hasCharacterModel, type CharacterInstance } from "./characterAssets";
import { gameCharacter } from "./gameAppearances";
import { lobbyReady } from "./lobbyPriority";

// Choix de la classe (salle d'attente) : les personnages des classes alignés côte à côte, en 3D, avec l'apparence du
// camp du joueur. Chacun occupe une colonne de même largeur que la colonne HTML (nom et compétences) placée dessous :
// la caméra orthographique couvre exactement la largeur du canvas, divisée en autant de colonnes que de classes.
// La classe choisie a son socle allumé en doré et joue un petit geste ; les autres sont assombries (lueur comprise).

// Hauteur de scène visible (m) : un personnage et son arme tiennent dedans, pieds compris.
const VISIBLE_HEIGHT = 2.6;
// Point visé par la caméra (m) : le milieu du personnage, un peu au-dessus pour garder le socle en bas.
const TARGET_Y = 1.05;
// Socle de la classe choisie : doré, comme le cadre de son nom (il ne prend plus la couleur de l'équipe).
const CHOSEN_COLOR = Color3.FromHexString("#ffc94d");
// Lueur autour de la silhouette des personnages.
const GLOW_COLOR = new Color3(1, 0.82, 0.45);
// Assombrissement des classes non choisies (0 : aucun), et de celle survolée.
const DIMMED = 0.5;
const DIMMED_HOVER = 0.2;

interface Slot {
  classId: string;
  holder: TransformNode;
  pedestal: Mesh;
  instance: CharacterInstance | null;
  idle?: AnimationGroup;
  gesture?: AnimationGroup;
}

export class ClassLineup {
  private engine: Engine;
  private scene: Scene;
  private camera: FreeCamera;
  private assets: CharacterAssets;
  private slots: Slot[];
  private selected = "";
  private hovered = -1;
  private disposed = false;
  private pedestalOff: StandardMaterial;
  private pedestalOn: StandardMaterial;
  private observer: ResizeObserver;
  // Lueur dorée autour des personnages.
  private glow: HighlightLayer;

  constructor(
    canvas: HTMLCanvasElement,
    classIds: string[],
    private team: number,
    // Appelé quand tous les personnages sont chargés.
    private onReady?: () => void,
  ) {
    // Rendu à la densité de l'écran (net sur un écran Retina).
    this.engine = new Engine(canvas, true, { alpha: true }, true);
    this.scene = new Scene(this.engine);
    // Fond transparent : celui de la page passe derrière les personnages.
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    new HemisphericLight("sky", new Vector3(0, 1, 0.3), this.scene).intensity = 0.95;
    const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.8), this.scene);
    sun.intensity = 1.5;
    // Mise en valeur sur le fond de l'écran (décidé le 2026-11-20) : un contre-jour chaud et une lueur dorée autour de
    // la silhouette des personnages.
    const rim = new DirectionalLight("rim", new Vector3(0.25, -0.35, 1), this.scene);
    rim.intensity = 2.6;
    rim.diffuse = new Color3(1, 0.93, 0.8);
    rim.specular = new Color3(1, 0.93, 0.8);
    // Taille du flou en pixels de rendu : divisée par le niveau de mise à l'échelle (0,5 sur un écran Retina), pour que le
    // halo ait la même épaisseur à l'écran quelle que soit la densité.
    const blur = 1.2 / this.engine.getHardwareScalingLevel();
    this.glow = new HighlightLayer("glow", this.scene, { blurHorizontalSize: blur, blurVerticalSize: blur });
    this.glow.outerGlow = true;
    this.glow.innerGlow = false;
    // Caméra orthographique légèrement plongeante, face aux personnages (elle regarde vers -z).
    this.camera = new FreeCamera("camera", new Vector3(0, TARGET_Y + 4, 40), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.setTarget(new Vector3(0, TARGET_Y, 0));
    this.camera.minZ = 1;

    this.pedestalOff = new StandardMaterial("pedestal-off", this.scene);
    this.pedestalOff.diffuseColor = new Color3(0.2, 0.22, 0.26);
    this.pedestalOff.specularColor = Color3.Black();
    this.pedestalOn = new StandardMaterial("pedestal-on", this.scene);
    this.pedestalOn.diffuseColor = CHOSEN_COLOR.scale(0.5);
    this.pedestalOn.emissiveColor = CHOSEN_COLOR.scale(0.8);
    this.pedestalOn.specularColor = Color3.Black();

    // Seules les animations jouées ici (attente et geste de chaque classe) sont chargées : le jeu charge le reste dans
    // sa propre scène, une fois cet écran prêt (voir lobbyPriority).
    const played = new Set(classIds.filter(hasCharacterModel).flatMap((id) => [CHARACTERS[id].animations.idle, ...CHARACTERS[id].animations.attacks.slice(0, 1)]));
    this.assets = new CharacterAssets(this.scene, undefined, played);
    this.slots = classIds.map((classId) => {
      const holder = new TransformNode(`lineup-${classId}`, this.scene);
      const pedestal = CreateDisc(`lineup-pedestal-${classId}`, { radius: 0.55, tessellation: 40 }, this.scene);
      pedestal.rotation.x = Math.PI / 2;
      pedestal.position.y = 0.01;
      pedestal.parent = holder;
      pedestal.material = this.pedestalOff;
      pedestal.isPickable = false;
      return { classId, holder, pedestal, instance: null };
    });
    this.layout();
    void this.load();

    this.engine.runRenderLoop(() => this.scene.render());
    // Le canvas suit la largeur de sa colonne (fenêtre redimensionnée, liste d'équipe qui passe dessous...).
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
  }

  // Charge les personnages tous en même temps (les fichiers communs, bibliothèques d'animations, ne sont chargés qu'une
  // fois), dans l'apparence du camp du joueur ; chacun apparaît dès qu'il est prêt. Une fois tous affichés, le jeu peut
  // lancer son propre préchargement (voir lobbyPriority).
  private async load() {
    await Promise.all(this.slots.map((slot) => this.loadSlot(slot)));
    // Écran déjà fermé : dispose a déjà levé l'attente ; ne pas libérer celle d'un jeu suivant.
    if (this.disposed) return;
    this.onReady?.();
    lobbyReady();
  }

  private async loadSlot(slot: Slot) {
    if (!hasCharacterModel(slot.classId)) return;
    const set = CHARACTERS[slot.classId].animations;
    const idleName = set.idle;
    const gestureName = set.attacks[0];
    const only = new Set([idleName, ...(gestureName ? [gestureName] : [])]);
    let instance: CharacterInstance | null = null;
    try {
      instance = await this.assets.create(slot.classId, slot.holder, only, gameCharacter(slot.classId, this.team));
    } catch {
      // Un modèle qui manque ne doit pas empêcher de choisir sa classe : la colonne reste vide. (Un chargement qui
      // se termine après la fermeture de l'écran échoue aussi ici, la scène n'existant plus : c'est voulu.)
    }
    if (this.disposed) {
      instance?.dispose();
      return;
    }
    if (!instance) return;
    slot.instance = instance;
    slot.idle = instance.animations.get(idleName);
    slot.gesture = gestureName ? instance.animations.get(gestureName) : undefined;
    slot.idle?.start(true);
    this.applyLook(slot);
    // Choisie avant d'avoir fini de charger : elle fait son geste maintenant.
    if (slot.classId === this.selected) this.playGesture(slot);
  }

  private resize = () => {
    this.engine.resize();
    this.layout();
  };

  // Cadrage : la hauteur visible est fixe ; la largeur suit le format du canvas, et chaque personnage se place au
  // milieu de sa colonne.
  private layout() {
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const halfHeight = VISIBLE_HEIGHT / 2;
    const halfWidth = halfHeight * aspect;
    this.camera.orthoTop = halfHeight;
    this.camera.orthoBottom = -halfHeight;
    this.camera.orthoLeft = -halfWidth;
    this.camera.orthoRight = halfWidth;
    const column = (2 * halfWidth) / Math.max(1, this.slots.length);
    this.slots.forEach((slot, i) => {
      // La caméra regarde vers -z : la gauche de l'écran est du côté des x positifs.
      slot.holder.position.set(halfWidth - column * (i + 0.5), 0, 0);
    });
  }

  // Classe choisie : son socle s'allume et elle joue un geste, puis reprend sa pose d'attente.
  setSelected(classId: string) {
    if (classId === this.selected) return;
    this.selected = classId;
    for (const slot of this.slots) {
      this.applyLook(slot);
      if (slot.classId === classId) this.playGesture(slot);
    }
  }

  // Colonne survolée (-1 : aucune) : elle s'éclaire un peu.
  setHovered(index: number) {
    if (index === this.hovered) return;
    this.hovered = index;
    for (const slot of this.slots) this.applyLook(slot);
  }

  private playGesture(slot: Slot) {
    const { idle, gesture } = slot;
    if (!idle || !gesture) return;
    // Arrêter un geste encore en cours déclencherait sa fin, donc la reprise de l'attente : on retire d'abord ce
    // retour, sinon attente et geste joueraient ensemble sur les mêmes os.
    gesture.onAnimationGroupEndObservable.clear();
    gesture.stop(true);
    idle.stop(true);
    gesture.start(false);
    gesture.onAnimationGroupEndObservable.addOnce(() => {
      if (!this.disposed) idle.start(true);
    });
  }

  private applyLook(slot: Slot) {
    const index = this.slots.indexOf(slot);
    const chosen = slot.classId === this.selected;
    slot.pedestal.material = chosen ? this.pedestalOn : this.pedestalOff;
    // Avant qu'une classe soit choisie, personne n'est assombri.
    const dim = !this.selected || chosen ? 0 : index === this.hovered ? DIMMED_HOVER : DIMMED;
    for (const mesh of slot.instance?.meshes ?? []) {
      mesh.renderOverlay = dim > 0;
      mesh.overlayColor = Color3.Black();
      mesh.overlayAlpha = dim;
      // La lueur s'atténue avec l'assombrissement (ajouter un maillage déjà présent ne fait que changer sa couleur).
      if (mesh.getTotalVertices() > 0) this.glow.addMesh(mesh as Mesh, GLOW_COLOR.scale(1 - dim));
    }
  }

  dispose() {
    this.disposed = true;
    // Écran quitté avant la fin du chargement : le jeu n'a plus à attendre.
    lobbyReady();
    this.observer.disconnect();
    for (const slot of this.slots) slot.instance?.dispose();
    this.engine.dispose();
  }
}
