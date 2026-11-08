import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { terrainHeight, type EffectKind } from "@arena/shared";
import { CharacterAnimator } from "./CharacterAnimator";
import { hasCharacterModel, type CharacterAssets, type CharacterInstance } from "./characterAssets";
import { ABILITY_FX } from "./spellFx";

export interface EffectView {
  kind: string;
  remaining: number;
  source: string;
}

// Ce que le client lit dans l'état synchronisé par le serveur.
export interface PlayerView {
  name: string;
  isBot: boolean;
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
  songActive: boolean;
  castAbility: string;
  castElapsed: number;
  castDuration: number;
  effects: Iterable<EffectView>;
}

const BODY_HEIGHT = 1.8;
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
  readonly root: TransformNode;
  private body: Mesh;
  private nose: Mesh;
  private material: StandardMaterial;
  private aliveColor: Color3;
  private wasAlive = true;
  private team: number;
  // Anneau de glace au sol, visible tant que le personnage est root.
  private rootRing: Mesh;
  // Lueur au sol pendant une incantation, à la couleur du sort.
  private castRing: Mesh;
  private castMaterial: StandardMaterial;
  private castingAbility = "";
  // Sphère translucide tant que la Bulle de l'Arcaniste est active.
  private bubble: Mesh;
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
    isLocal: boolean,
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

    // Les métadonnées permettent de retrouver le joueur quand on clique sur le maillage.
    this.body = CreateCapsule("body", { height: BODY_HEIGHT, radius: 0.5 }, scene);
    this.body.position.y = BODY_HEIGHT / 2;
    this.body.material = this.material;
    this.body.metadata = { sessionId };
    this.body.parent = this.root;

    this.nose = CreateBox("nose", { width: 0.25, height: 0.25, depth: 0.4 }, scene);
    this.nose.position.set(0, 1.4, 0.5);
    this.nose.material = this.material;
    this.nose.metadata = { sessionId };
    this.nose.parent = this.root;

    this.rootRing = CreateTorus("rootRing", { diameter: 1.4, thickness: 0.25, tessellation: 32 }, scene);
    this.rootRing.position.y = 0.15;
    const iceMat = new StandardMaterial("iceMat", scene);
    iceMat.emissiveColor = new Color3(0.45, 0.8, 1);
    iceMat.disableLighting = true;
    iceMat.alpha = 0.75;
    this.rootRing.material = iceMat;
    this.rootRing.isPickable = false;
    this.rootRing.parent = this.root;
    this.rootRing.setEnabled(false);

    this.castRing = CreateTorus("castRing", { diameter: 1.9, thickness: 0.12, tessellation: 48 }, scene);
    this.castRing.position.y = 0.08;
    this.castMaterial = new StandardMaterial("castMat", scene);
    this.castMaterial.disableLighting = true;
    this.castRing.material = this.castMaterial;
    this.castRing.isPickable = false;
    this.castRing.parent = this.root;
    this.castRing.setEnabled(false);

    this.bubble = CreateSphere("bubble", { diameter: 2.2, segments: 16 }, scene);
    this.bubble.position.y = BODY_HEIGHT / 2;
    const bubbleMat = new StandardMaterial("bubbleMat", scene);
    bubbleMat.emissiveColor = new Color3(0.6, 0.45, 1);
    bubbleMat.disableLighting = true;
    bubbleMat.alpha = 0.18;
    this.bubble.material = bubbleMat;
    this.bubble.isPickable = false;
    this.bubble.parent = this.root;
    this.bubble.setEnabled(false);

    if (isLocal) {
      const ring = CreateTorus("ring", { diameter: 1.6, thickness: 0.08, tessellation: 48 }, scene);
      ring.position.y = 0.05;
      const ringMat = new StandardMaterial("ringMat", scene);
      // Blanc, pour ne pas se confondre avec la lueur dorée des incantations sacrées.
      ringMat.emissiveColor = new Color3(0.95, 0.95, 0.95);
      ringMat.disableLighting = true;
      ring.material = ringMat;
      ring.isPickable = false;
      ring.parent = this.root;
    }
  }

  get isAlive(): boolean {
    return this.state.hp > 0;
  }

  hasEffect(kind: EffectKind): boolean {
    for (const effect of this.state.effects) if (effect.kind === kind) return true;
    return false;
  }

  // smoothing : fraction du chemin à parcourir vers la position serveur pour cette frame.
  update(smoothing: number) {
    this.root.position.x += (this.state.x - this.root.position.x) * smoothing;
    this.root.position.z += (this.state.z - this.root.position.z) * smoothing;
    // Le personnage suit le relief.
    this.root.position.y = terrainHeight(this.root.position.x, this.root.position.z);
    // Rotation lissée par le chemin le plus court (l'orientation arrive par paliers à 20 Hz).
    const turn = this.state.facing - this.root.rotation.y;
    this.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * smoothing;

    // L'équipe est attribuée au lancement de la partie, après l'arrivée du joueur.
    if (this.state.team !== this.team) {
      this.team = this.state.team;
      this.aliveColor = teamColor(this.team, this.state.colorIndex);
      if (this.isAlive) this.material.diffuseColor = this.aliveColor;
      this.model?.setTeam(this.team);
    }

    if (this.isAlive !== this.wasAlive) {
      this.wasAlive = this.isAlive;
      this.applyLifeState();
    }

    const rooted = this.isAlive && this.hasEffect("root");
    if (rooted !== this.rootRing.isEnabled()) this.rootRing.setEnabled(rooted);

    const shielded = this.isAlive && this.hasEffect("bubble");
    if (shielded !== this.bubble.isEnabled()) this.bubble.setEnabled(shielded);

    this.updateCastRing();
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

  // Charge le personnage animé de la classe (la classe est choisie après l'arrivée du joueur).
  private loadModel() {
    this.modelClass = this.state.classId;
    this.animator?.dispose();
    this.model?.dispose();
    this.model = null;
    this.animator = null;
    this.showCapsule(true);
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
      model.setTeam(this.team);
      // Cliquer sur le personnage le cible, comme la capsule.
      for (const mesh of model.meshes) {
        mesh.metadata = { sessionId: this.sessionId };
        mesh.isPickable = true;
      }
      this.animator = new CharacterAnimator(model.animations, model.set);
      this.showCapsule(false);
    });
  }

  // La capsule reste cliquable mais devient invisible quand le personnage animé est là.
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
    this.animator?.update({
      alive: this.isAlive,
      casting: this.state.castAbility !== "",
      forward: this.forwardSpeed,
      right: this.rightSpeed,
    });
  }

  // La lueur d'incantation pulse, et prend la couleur du sort en cours.
  private updateCastRing() {
    const ability = this.isAlive ? this.state.castAbility : "";
    if (ability !== this.castingAbility) {
      this.castingAbility = ability;
      this.castRing.setEnabled(ability !== "");
      const color = ABILITY_FX[ability]?.color;
      if (color) this.castMaterial.emissiveColor = color;
    }
    if (ability) {
      const pulse = 1 + 0.12 * Math.sin(performance.now() / 120);
      this.castRing.scaling.set(pulse, 1, pulse);
    }
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
