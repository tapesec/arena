import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { EffectKind } from "@arena/shared";

export interface EffectView {
  kind: string;
  remaining: number;
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

// Lueur appliquée au personnage selon le contrôle subi, du plus au moins grave.
const CONTROL_GLOW: [EffectKind, Color3][] = [
  ["stun", new Color3(0.6, 0.55, 0)],
  ["mez", new Color3(0.45, 0.1, 0.6)],
  ["root", new Color3(0, 0.35, 0.6)],
];

// Représentation 3D d'un joueur : une capsule, un "nez" pour l'orientation,
// et un anneau au sol pour son propre personnage.
export class PlayerVisual {
  readonly root: TransformNode;
  private body: Mesh;
  private nose: Mesh;
  private material: StandardMaterial;
  private aliveColor: Color3;
  private wasAlive = true;
  private team: number;
  private currentGlow: Color3 | null = null;

  constructor(
    scene: Scene,
    readonly state: PlayerView,
    readonly sessionId: string,
    isLocal: boolean,
  ) {
    this.root = new TransformNode(`player-${sessionId}`, scene);
    this.root.position.set(state.x, 0, state.z);

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

    if (isLocal) {
      const ring = CreateTorus("ring", { diameter: 1.6, thickness: 0.08, tessellation: 48 }, scene);
      ring.position.y = 0.05;
      const ringMat = new StandardMaterial("ringMat", scene);
      ringMat.emissiveColor = new Color3(1, 0.85, 0.3);
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
    this.root.rotation.y = this.state.facing;

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

    const glow = CONTROL_GLOW.find(([kind]) => this.hasEffect(kind))?.[1] ?? null;
    if (glow !== this.currentGlow) {
      this.currentGlow = glow;
      this.material.emissiveColor = glow ?? Color3.Black();
    }
  }

  dispose() {
    this.root.dispose(false, true);
  }

  // Un mort est couché au sol et grisé.
  private applyLifeState() {
    const alive = this.isAlive;
    this.body.rotation.x = alive ? 0 : Math.PI / 2;
    this.body.position.y = alive ? BODY_HEIGHT / 2 : 0.5;
    this.nose.setEnabled(alive);
    this.material.diffuseColor = alive ? this.aliveColor : DEAD_COLOR;
  }
}
