import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Rendering/outlineRenderer"; // Effet de bord : active renderOutline (contour au survol).
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { terrainHeight, type EffectKind } from "@arena/shared";
import type { PredictedBody } from "./prediction";
import type { TargetReaction } from "./abilityAnimations";
import type { PlayingAbility } from "./abilityEffects";
import { TUNING } from "./tuning";
import { CharacterAnimator, type Reaction } from "./CharacterAnimator";
import { INSTRUMENT_ANIMATIONS, hasCharacterModel, type CharacterAssets, type CharacterInstance } from "./characterAssets";

export interface EffectView {
  kind: string;
  remaining: number;
  // Durée totale (-1 = permanent).
  duration: number;
  source: string;
  // Valeur propre à l'effet (part de vitesse perdue d'un snare).
  value: number;
}

// Ce que le client lit dans l'état synchronisé par le serveur.
export interface PlayerView {
  name: string;
  isBot: boolean;
  leader: boolean;
  classId: string;
  team: number;
  x: number;
  z: number;
  facing: number;
  colorIndex: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  endurance: number;
  maxEndurance: number;
  attacking: boolean;
  lock: string;
  song: string;
  queuedAbility: string;
  comboAbility: string;
  comboTarget: string;
  charging: boolean;
  castAbility: string;
  castElapsed: number;
  castDuration: number;
  // Prédiction du déplacement : dernière commande reçue par le serveur et temps passé depuis sous cette commande.
  inputSeq: number;
  inputTime: number;
  effects: Iterable<EffectView>;
}

const BODY_HEIGHT = 1.8;
// Zone de clic : un cylindre invisible plus large que le personnage, sur toute sa hauteur (personnages agrandis à
// 2,2 m), pour le cibler sans viser pile sa silhouette.
const HITBOX_DIAMETER = 1.4;
const HITBOX_HEIGHT = 2.4;
// Épaisseur du contour au survol (unités du maillage).
const HOVER_OUTLINE_WIDTH = 0.02;
const DEAD_COLOR = new Color3(0.3, 0.3, 0.3);

// Teinte de base par équipe : bleu ou rouge, légèrement variée d'un joueur à l'autre.
const TEAM_HUES = [215, 5];

// Couleur d'un joueur : celle de son équipe, légèrement variée d'un joueur à l'autre.
function teamColor(team: number, colorIndex: number): Color3 {
  const hue = TEAM_HUES[team] + ((colorIndex % 4) - 1.5) * 8;
  return Color3.FromHSV((hue + 360) % 360, 0.65, 0.9);
}

// Lissage de la vitesse mesurée (qui sert à choisir l'animation de déplacement).
const VELOCITY_SMOOTHING = 12;

// Représentation 3D d'un joueur : un personnage animé quand sa classe a un modèle, sinon une capsule
// avec un "nez" pour l'orientation ; un anneau au sol pour son propre personnage.
export class PlayerVisual {
  // Position et orientation prédites (son propre personnage, voir MovementPredictor), sinon null : on suit le serveur.
  predicted: PredictedBody | null = null;
  readonly root: TransformNode;
  private body: Mesh;
  private nose: Mesh;
  private material: StandardMaterial;
  private aliveColor: Color3;
  private wasAlive = true;
  private team: number;
  // Zone de clic (cylindre invisible) et couleur du contour de survol (null sans survol).
  readonly hitbox: Mesh;
  private hovered: Color3 | null = null;
  // Personnage animé (chargé en arrière-plan) ; la capsule reste affichée en attendant.
  private model: CharacterInstance | null = null;
  private animator: CharacterAnimator | null = null;
  private modelClass = "";
  private loadToken = 0;
  private disposed = false;
  // Vitesse mesurée à l'écran, dans le repère du personnage.
  private lastX: number;
  private lastZ: number;
  private lastTime = performance.now();
  private forwardSpeed = 0;
  private rightSpeed = 0;

  constructor(
    scene: Scene,
    readonly state: PlayerView,
    readonly sessionId: string,
    private assets: CharacterAssets,
  ) {
    this.root = new TransformNode(`player-${sessionId}`, scene);
    this.root.position.set(state.x, 0, state.z);
    this.lastX = state.x;
    this.lastZ = state.z;

    this.team = state.team;
    this.aliveColor = teamColor(state.team, state.colorIndex);
    this.material = new StandardMaterial("playerMat", scene);
    this.material.diffuseColor = this.aliveColor;

    // Personnage provisoire (en attendant le modèle animé) : capsule et nez.
    this.body = CreateCapsule("body", { height: BODY_HEIGHT, radius: 0.5 }, scene);
    this.body.position.y = BODY_HEIGHT / 2;
    this.body.material = this.material;
    this.body.isPickable = false;
    this.body.parent = this.root;

    this.nose = CreateBox("nose", { width: 0.25, height: 0.25, depth: 0.4 }, scene);
    this.nose.position.set(0, 1.4, 0.5);
    this.nose.material = this.material;
    this.nose.isPickable = false;
    this.nose.parent = this.root;

    // Seule la zone de clic est cliquable (jamais affichée) : les métadonnées retrouvent le joueur.
    this.hitbox = CreateCylinder("hitbox", { height: HITBOX_HEIGHT, diameter: HITBOX_DIAMETER, tessellation: 12 }, scene);
    this.hitbox.position.y = HITBOX_HEIGHT / 2;
    this.hitbox.isVisible = false;
    this.hitbox.metadata = { sessionId, hitbox: true };
    this.hitbox.parent = this.root;
  }

  get isAlive(): boolean {
    return this.state.hp > 0;
  }

  hasEffect(kind: EffectKind): boolean {
    for (const effect of this.state.effects) if (effect.kind === kind) return true;
    return false;
  }

  // Temps restant d'un effet, en secondes (0 s'il est absent).
  effectRemaining(kind: EffectKind): number {
    for (const effect of this.state.effects) if (effect.kind === kind) return effect.remaining;
    return 0;
  }

  // smoothing : fraction du chemin à parcourir vers la position serveur pour cette frame. Son propre personnage,
  // prédit (predicted), est placé directement.
  update(smoothing: number) {
    if (this.predicted) {
      // Recalage net : l'animation de course ne doit pas y voir un déplacement.
      if (this.predicted.snapped) {
        this.lastX = this.predicted.x;
        this.lastZ = this.predicted.z;
      }
      this.root.position.x = this.predicted.x;
      this.root.position.z = this.predicted.z;
      this.root.rotation.y = this.predicted.facing;
    } else {
      this.root.position.x += (this.state.x - this.root.position.x) * smoothing;
      this.root.position.z += (this.state.z - this.root.position.z) * smoothing;
      // Rotation lissée par le chemin le plus court (l'orientation arrive par paliers à 20 Hz).
      const turn = this.state.facing - this.root.rotation.y;
      this.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * smoothing;
    }
    // Le personnage suit le relief.
    this.root.position.y = terrainHeight(this.root.position.x, this.root.position.z);

    // L'équipe est attribuée au lancement de la partie, après l'arrivée du joueur.
    if (this.state.team !== this.team) {
      this.team = this.state.team;
      this.aliveColor = teamColor(this.team, this.state.colorIndex);
      if (this.isAlive) this.material.diffuseColor = this.aliveColor;
    }

    if (this.isAlive !== this.wasAlive) {
      this.wasAlive = this.isAlive;
      this.applyLifeState();
    }



    if (this.state.classId !== this.modelClass) this.loadModel();
    this.updateAnimation();
  }

  // Coup d'auto-attaque porté par ce joueur.
  playAttack() {
    this.animator?.attack();
  }

  playAbility(abilityId: string) {
    this.animator?.ability(abilityId);
  }

  // Personnage animé (null tant qu'il n'est pas chargé ou si la classe n'en a pas).
  get character(): CharacterInstance | null {
    return this.model;
  }

  // Compétence réglée dont le geste est en cours (pour ses effets à particules).
  playingAbility(): PlayingAbility | null {
    return this.isAlive ? (this.animator?.playingAbility() ?? null) : null;
  }

  // Incantation interrompue : le geste du sort s'arrête.
  interruptCast() {
    this.animator?.interruptCast();
  }

  // Point entre les deux mains (où se forme un trait en incantation) ; faux si le personnage n'a pas de mains.
  handsPosition(out: Vector3): boolean {
    const hands = this.model?.hands;
    if (!hands?.length) return false;
    out.setAll(0);
    for (const hand of hands) out.addInPlace(hand.getAbsolutePosition());
    out.scaleInPlace(1 / hands.length);
    return true;
  }

  playReaction(reaction: Reaction) {
    if (this.isAlive) this.animator?.react(reaction);
  }

  playTunedReaction(reaction: TargetReaction) {
    if (this.isAlive) this.animator?.reactTuned(reaction);
  }

  // Charge le personnage animé de la classe (la classe est choisie après l'arrivée du joueur).
  private loadModel() {
    this.modelClass = this.state.classId;
    this.animator?.dispose();
    this.model?.dispose();
    this.model = null;
    this.animator = null;
    this.showCapsule(true);
    // Le contour de survol passe du modèle retiré à la capsule.
    if (this.hovered) this.setHovered(this.hovered);
    if (!hasCharacterModel(this.modelClass)) return;
    const token = ++this.loadToken;
    void this.assets.create(this.modelClass, this.root).then((model) => {
      if (!model) return;
      // Le joueur a changé de classe ou a disparu pendant le chargement.
      if (token !== this.loadToken || this.disposed) {
        model.dispose();
        return;
      }
      this.model = model;
      // Le clic passe par la zone de clic, pas par le modèle.
      for (const mesh of model.meshes) mesh.isPickable = false;
      if (this.hovered) this.setHovered(this.hovered);
      // Calage des animations de compétence réglé sur la page animation-lab.html.
      this.animator = new CharacterAnimator(model.animations, model.set, TUNING[this.modelClass]);
      this.showCapsule(false);
    });
  }

  // Contour léger quand la souris le survole (null pour l'enlever) : sur le modèle animé, ou sur la capsule.
  setHovered(color: Color3 | null) {
    const previous = this.hovered;
    this.hovered = color;
    const meshes = this.model ? this.model.meshes : [this.body, this.nose];
    // Le modèle vient de remplacer la capsule : on retire le contour de la capsule.
    if (previous && this.model) for (const mesh of [this.body, this.nose]) mesh.renderOutline = false;
    for (const mesh of meshes) {
      mesh.renderOutline = !!color;
      if (color) {
        mesh.outlineColor = color;
        mesh.outlineWidth = HOVER_OUTLINE_WIDTH;
      }
    }
  }

  // La capsule devient invisible quand le personnage animé est là.
  private showCapsule(visible: boolean) {
    this.body.visibility = visible ? 1 : 0;
    this.nose.setEnabled(visible && this.isAlive);
    this.applyLifeState();
  }

  private updateAnimation() {
    const now = performance.now();
    const dt = Math.max((now - this.lastTime) / 1000, 1e-3);
    this.lastTime = now;
    const vx = (this.root.position.x - this.lastX) / dt;
    const vz = (this.root.position.z - this.lastZ) / dt;
    this.lastX = this.root.position.x;
    this.lastZ = this.root.position.z;
    // Projection sur l'avant (sin, cos) et la droite (cos, -sin) du personnage, puis lissage.
    const facing = this.root.rotation.y;
    const forward = vx * Math.sin(facing) + vz * Math.cos(facing);
    const right = vx * Math.cos(facing) - vz * Math.sin(facing);
    const k = 1 - Math.exp(-VELOCITY_SMOOTHING * dt);
    this.forwardSpeed += (forward - this.forwardSpeed) * k;
    this.rightSpeed += (right - this.rightSpeed) * k;
    const casting = this.state.castAbility !== "";
    this.animator?.update({
      alive: this.isAlive,
      castAbility: this.isAlive ? this.state.castAbility : "",
      castElapsed: this.state.castElapsed,
      castDuration: this.state.castDuration,
      stunned: this.hasEffect("stun"),
      charging: this.state.charging,
      rampart: this.hasEffect("rampart"),
      rooted: this.hasEffect("root"),
      forward: this.forwardSpeed,
      right: this.rightSpeed,
    });
    // Le bâton passe dans le dos pendant l'incantation et le geste du sort, puis revient en main.
    this.model?.setStowed(this.isAlive && (casting || (this.animator?.performingAbility ?? false)));
    // Le Barde joue du luth : il le tient entre ses mains.
    const animator = this.animator;
    // Mort : le luth retourne aussitôt dans le dos.
    this.model?.setPlaying(this.isAlive && !!animator?.performingAbility && INSTRUMENT_ANIMATIONS.has(animator.currentAnimation), !this.isAlive);
  }

  dispose() {
    this.disposed = true;
    this.animator?.dispose();
    this.model?.dispose();
    this.root.dispose(false, true);
  }

  // Un mort est couché au sol et grisé (le personnage animé joue sa propre animation de mort).
  private applyLifeState() {
    if (this.model) return;
    const alive = this.isAlive;
    this.body.rotation.x = alive ? 0 : Math.PI / 2;
    this.body.position.y = alive ? BODY_HEIGHT / 2 : 0.5;
    this.nose.setEnabled(alive);
    this.material.diffuseColor = alive ? this.aliveColor : DEAD_COLOR;
  }
}
