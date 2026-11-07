import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import "@babylonjs/core/Culling/ray"; // Effet de bord : active scene.pick() pour le ciblage au clic.
import { Engine } from "@babylonjs/core/Engines/engine";
import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { Callbacks, type Room } from "@colyseus/sdk";
import {
  ARENA_SIZE,
  OBSTACLES,
  OBSTACLE_HEIGHT,
  TAB_TARGET_RANGE,
  distance,
  getAbility,
  hasLineOfSight,
  isFacing,
  isInMeleeRange,
  type CombatEvent,
  type CooldownEvent,
  type InterruptEvent,
} from "@arena/shared";
import { HOTBAR } from "../hotbar";
import { useHudStore, type CastFrame, type SelfFrame, type TargetFrame } from "../store";
import { KeyboardInput, type KeyAction } from "./KeyboardInput";
import { PlayerVisual, type PlayerView } from "./PlayerVisual";

// Vue isométrique : caméra en diagonale, inclinée d'environ 55° par rapport à la verticale.
const CAMERA_ALPHA = (-3 * Math.PI) / 4;
const CAMERA_BETA = 0.95;
const CAMERA_RADIUS = 32;

// Vitesse à laquelle l'affichage rattrape la position serveur (plus haut = plus réactif).
const SMOOTHING = 15;

// Fréquence de mise à jour de l'interface React (inutile de la recalculer à chaque frame).
const HUD_REFRESH_MS = 100;

const SLOT_INDEX: Partial<Record<KeyAction, number>> = { slot1: 0, slot2: 1, slot3: 2 };

export class Game {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private keyboard: KeyboardInput;
  private players = new Map<string, PlayerVisual>();
  private targetId: string | null = null;
  private targetMarker!: Mesh;
  private lastHudRefresh = 0;
  private lastHudSnapshot = "";

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
    this.createTargetMarker();
    this.bindState();
    this.bindMessages();

    this.keyboard = new KeyboardInput(
      (input) => this.room.send("input", input),
      (action) => this.handleAction(action),
    );
    this.scene.onPointerObservable.add((info) => this.handlePointer(info));

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

    // Les obstacles viennent de la même définition que celle utilisée par le serveur.
    const obstacleMat = new StandardMaterial("obstacleMat", this.scene);
    obstacleMat.diffuseColor = new Color3(0.45, 0.42, 0.38);
    for (const o of OBSTACLES) {
      const box = CreateBox(
        "obstacle",
        { width: o.halfWidth * 2, depth: o.halfDepth * 2, height: OBSTACLE_HEIGHT },
        this.scene,
      );
      box.position.set(o.x, OBSTACLE_HEIGHT / 2, o.z);
      box.material = obstacleMat;
      box.isPickable = false;
    }
  }

  // Anneau rouge affiché sous la cible actuelle.
  private createTargetMarker() {
    this.targetMarker = CreateTorus("targetMarker", { diameter: 1.9, thickness: 0.1, tessellation: 48 }, this.scene);
    const material = new StandardMaterial("targetMarkerMat", this.scene);
    material.emissiveColor = new Color3(1, 0.2, 0.2);
    material.disableLighting = true;
    this.targetMarker.material = material;
    this.targetMarker.isPickable = false;
    this.targetMarker.setEnabled(false);
  }

  private bindState() {
    const callbacks = Callbacks.get(this.room);

    callbacks.onAdd("players", (player, sessionId) => {
      const key = sessionId as string;
      this.players.set(key, new PlayerVisual(this.scene, player as PlayerView, key, key === this.room.sessionId));
      useHudStore.getState().setPlayerCount(this.players.size);
    });

    callbacks.onRemove("players", (_player, sessionId) => {
      const key = sessionId as string;
      this.players.get(key)?.dispose();
      this.players.delete(key);
      if (this.targetId === key) this.setTarget(null);
      useHudStore.getState().setPlayerCount(this.players.size);
    });
  }

  private bindMessages() {
    const hud = useHudStore.getState();
    this.room.onMessage("combat", (event: CombatEvent) => this.logCombat(event));
    this.room.onMessage("interrupt", (event: InterruptEvent) => this.logInterrupt(event));
    this.room.onMessage("cooldown", (event: CooldownEvent) => hud.startCooldown(event.abilityId, event.duration));
    this.room.onMessage("error", (event: { message: string }) => hud.flash(event.message));
  }

  private handleAction(action: KeyAction) {
    const slot = SLOT_INDEX[action];
    if (slot !== undefined) {
      const abilityId = HOTBAR[slot];
      if (abilityId) this.room.send("cast", { abilityId });
      return;
    }
    switch (action) {
      case "nextTarget":
        this.cycleTarget();
        break;
      case "clearTarget":
        this.setTarget(null);
        break;
      case "toggleAttack":
        this.room.send("toggleAttack");
        break;
      case "faceTarget":
        this.room.send("faceTarget");
        break;
      case "respawn":
        if (import.meta.env.DEV) this.room.send("respawn");
        break;
    }
  }

  // Clic gauche sur un personnage : il devient la cible.
  private handlePointer(info: PointerInfo) {
    if (info.type !== PointerEventTypes.POINTERDOWN || info.event.button !== 0) return;
    const sessionId = info.pickInfo?.pickedMesh?.metadata?.sessionId as string | undefined;
    if (sessionId && sessionId !== this.room.sessionId) this.setTarget(sessionId);
  }

  // Tab : passe à l'ennemi vivant et visible suivant, du plus proche au plus éloigné.
  private cycleTarget() {
    const self = this.players.get(this.room.sessionId);
    if (!self) return;

    const candidates = [...this.players.values()]
      .filter(
        (p) =>
          p !== self &&
          p.isAlive &&
          distance(self.state, p.state) <= TAB_TARGET_RANGE &&
          hasLineOfSight(self.state, p.state),
      )
      .sort((a, b) => distance(self.state, a.state) - distance(self.state, b.state));
    if (candidates.length === 0) return;

    const currentIndex = candidates.findIndex((p) => p.sessionId === this.targetId);
    this.setTarget(candidates[(currentIndex + 1) % candidates.length].sessionId);
  }

  private setTarget(targetId: string | null) {
    this.targetId = targetId;
    this.room.send("target", { targetId });
  }

  private nameOf(id: string): string {
    return id === this.room.sessionId ? "Vous" : (this.players.get(id)?.state.name ?? "?");
  }

  private logCombat(event: CombatEvent) {
    const { pushLog } = useHudStore.getState();
    const source = this.nameOf(event.sourceId);
    const abilityName = event.abilityId === "auto" ? "attaque" : (getAbility(event.abilityId)?.name ?? event.abilityId);
    if (event.kind === "heal") {
      const target = event.sourceId === event.targetId ? "" : ` → ${this.nameOf(event.targetId)}`;
      pushLog(`${source}${target} : ${abilityName} +${event.amount}`);
      return;
    }
    pushLog(`${source} → ${this.nameOf(event.targetId)} : ${abilityName} ${event.amount}`);
    if (event.killed) {
      pushLog(event.targetId === this.room.sessionId ? "Vous êtes mort" : `${this.nameOf(event.targetId)} est mort`);
    }
  }

  private logInterrupt(event: InterruptEvent) {
    const abilityName = getAbility(event.abilityId)?.name ?? event.abilityId;
    const cause = event.reason === "move" ? "mouvement" : "dégâts";
    useHudStore.getState().pushLog(`${this.nameOf(event.casterId)} : ${abilityName} interrompu (${cause})`);
  }

  private renderFrame() {
    const dt = this.engine.getDeltaTime() / 1000;
    // Lissage exponentiel : on rattrape la position reçue du serveur sans à-coups,
    // le serveur n'envoyant que 20 mises à jour par seconde.
    const smoothing = 1 - Math.exp(-SMOOTHING * dt);
    for (const player of this.players.values()) player.update(smoothing);

    const self = this.players.get(this.room.sessionId);
    if (self) this.camera.target.copyFrom(self.root.position);

    const target = this.targetId ? this.players.get(this.targetId) : undefined;
    this.targetMarker.setEnabled(!!target);
    if (target) this.targetMarker.position.set(target.root.position.x, 0.06, target.root.position.z);

    this.refreshHud(self, target);
    this.scene.render();
  }

  private refreshHud(self: PlayerVisual | undefined, target: PlayerVisual | undefined) {
    const now = performance.now();
    if (now - this.lastHudRefresh < HUD_REFRESH_MS) return;
    this.lastHudRefresh = now;

    const selfFrame: SelfFrame | null = self
      ? {
          name: self.state.name,
          hp: self.state.hp,
          maxHp: self.state.maxHp,
          mana: Math.floor(self.state.mana),
          maxMana: self.state.maxMana,
          endurance: Math.floor(self.state.endurance),
          maxEndurance: self.state.maxEndurance,
          attacking: self.state.attacking,
          cast: castFrame(self.state),
        }
      : null;
    const targetFrame: TargetFrame | null =
      self && target
        ? {
            name: target.state.name,
            hp: target.state.hp,
            maxHp: target.state.maxHp,
            cast: castFrame(target.state),
            distance: Math.round(distance(self.state, target.state)),
            inMeleeRange: isInMeleeRange(self.state, target.state),
            inLineOfSight: hasLineOfSight(self.state, target.state),
            facing: isFacing(self.state, target.state),
          }
        : null;

    // On ne prévient React que si quelque chose a réellement changé.
    const snapshot = JSON.stringify([selfFrame, targetFrame]);
    if (snapshot === this.lastHudSnapshot) return;
    this.lastHudSnapshot = snapshot;
    useHudStore.getState().setFrames(selfFrame, targetFrame);
  }
}

function castFrame(state: PlayerView): CastFrame | null {
  if (!state.castAbility || state.castDuration <= 0) return null;
  return {
    abilityName: getAbility(state.castAbility)?.name ?? state.castAbility,
    progress: Math.min(1, state.castElapsed / state.castDuration),
  };
}
