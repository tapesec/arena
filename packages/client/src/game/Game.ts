import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { Callbacks, type Room } from "@colyseus/sdk";
import { ARENA_SIZE } from "@arena/shared";
import { useHudStore } from "../store";
import { KeyboardInput } from "./KeyboardInput";

// Ce que le client lit dans l'état synchronisé par le serveur.
interface PlayerView {
  x: number;
  z: number;
  facing: number;
  colorIndex: number;
}

interface PlayerEntity {
  state: PlayerView;
  root: TransformNode;
}

// Vue isométrique : caméra en diagonale, inclinée d'environ 55° par rapport à la verticale.
const CAMERA_ALPHA = (-3 * Math.PI) / 4;
const CAMERA_BETA = 0.95;
const CAMERA_RADIUS = 32;

// Vitesse à laquelle l'affichage rattrape la position serveur (plus haut = plus réactif).
const SMOOTHING = 15;

export class Game {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private keyboard: KeyboardInput;
  private players = new Map<string, PlayerEntity>();

  constructor(
    canvas: HTMLCanvasElement,
    private room: Room,
  ) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.07, 0.08, 0.1, 1);

    this.camera = new ArcRotateCamera("camera", CAMERA_ALPHA, CAMERA_BETA, CAMERA_RADIUS, Vector3.Zero(), this.scene);
    this.camera.fov = 0.6;

    this.createEnvironment();
    this.bindState();

    this.keyboard = new KeyboardInput((input) => this.room.send("input", input));

    // Accès à la scène depuis la console du navigateur, en développement uniquement.
    if (import.meta.env.DEV) (window as unknown as { scene: Scene }).scene = this.scene;

    this.engine.runRenderLoop(() => this.renderFrame());
    window.addEventListener("resize", this.handleResize);
  }

  dispose() {
    window.removeEventListener("resize", this.handleResize);
    this.keyboard.dispose();
    this.room.leave();
    this.engine.dispose();
  }

  private handleResize = () => this.engine.resize();

  private createEnvironment() {
    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.6;
    const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.3), this.scene);
    sun.intensity = 0.7;

    const ground = CreateGround("ground", { width: ARENA_SIZE, height: ARENA_SIZE }, this.scene);
    const grid = new GridMaterial("grid", this.scene);
    grid.mainColor = new Color3(0.16, 0.18, 0.2);
    grid.lineColor = new Color3(0.35, 0.4, 0.45);
    grid.gridRatio = 2;
    grid.majorUnitFrequency = 5;
    ground.material = grid;
  }

  private bindState() {
    const callbacks = Callbacks.get(this.room);

    callbacks.onAdd("players", (player, sessionId) => {
      const key = sessionId as string;
      this.players.set(key, this.createPlayer(player as PlayerView, key === this.room.sessionId));
      useHudStore.getState().setPlayerCount(this.players.size);
    });

    callbacks.onRemove("players", (_player, sessionId) => {
      const key = sessionId as string;
      this.players.get(key)?.root.dispose();
      this.players.delete(key);
      useHudStore.getState().setPlayerCount(this.players.size);
    });
  }

  private createPlayer(state: PlayerView, isLocal: boolean): PlayerEntity {
    const root = new TransformNode("player", this.scene);
    root.position.set(state.x, 0, state.z);

    const material = new StandardMaterial("playerMat", this.scene);
    material.diffuseColor = Color3.FromHSV((state.colorIndex * 360) / 16, 0.6, 0.9);

    const body = CreateCapsule("body", { height: 1.8, radius: 0.5 }, this.scene);
    body.position.y = 0.9;
    body.material = material;
    body.parent = root;

    // Petit "nez" pour voir dans quelle direction regarde le personnage.
    const nose = CreateBox("nose", { width: 0.25, height: 0.25, depth: 0.4 }, this.scene);
    nose.position.set(0, 1.4, 0.5);
    nose.material = material;
    nose.parent = root;

    if (isLocal) {
      // Anneau au sol pour repérer son propre personnage.
      const ring = CreateTorus("ring", { diameter: 1.6, thickness: 0.08, tessellation: 48 }, this.scene);
      ring.position.y = 0.05;
      const ringMat = new StandardMaterial("ringMat", this.scene);
      ringMat.emissiveColor = new Color3(1, 0.85, 0.3);
      ringMat.disableLighting = true;
      ring.material = ringMat;
      ring.parent = root;
    }

    return { state, root };
  }

  private renderFrame() {
    const dt = this.engine.getDeltaTime() / 1000;
    // Lissage exponentiel : on rattrape la position reçue du serveur sans à-coups,
    // le serveur n'envoyant que 20 mises à jour par seconde.
    const t = 1 - Math.exp(-SMOOTHING * dt);

    for (const { state, root } of this.players.values()) {
      root.position.x += (state.x - root.position.x) * t;
      root.position.z += (state.z - root.position.z) * t;
      root.rotation.y = state.facing;
    }

    const local = this.players.get(this.room.sessionId);
    if (local) this.camera.target.copyFrom(local.root.position);

    this.scene.render();
  }
}
