import "@babylonjs/core/Culling/ray"; // Effet de bord : active scene.pick() pour le ciblage au clic.
import { Engine } from "@babylonjs/core/Engines/engine";
import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { Callbacks, type Room } from "@colyseus/sdk";
import {
  ARENA_SIZE,
  OBSTACLES,
  OBSTACLE_HEIGHT,
  PERMANENT,
  START_ZONES,
  TAB_TARGET_RANGE,
  distance,
  getAbility,
  getClass,
  hasLineOfSight,
  isFacing,
  isInMeleeRange,
  NO_INPUT,
  type ClassId,
  type AbilityUsedEvent,
  type CombatEvent,
  type CooldownEvent,
  type EffectKind,
  type InterruptEvent,
  type MatchPhase,
  type MoveInput,
} from "@arena/shared";
import {
  useHudStore,
  type CastFrame,
  type EffectFrame,
  type MatchFrame,
  type SelfFrame,
  type TargetFrame,
  type TeammateFrame,
} from "../store";
import { CameraController } from "./CameraController";
import { WorldOverlay } from "./WorldOverlay";
import { SpellEffects } from "./SpellEffects";
import { PROJECTILE_TRAVEL_TIME, isProjectile } from "./spellFx";
import { formatCombatEvent, formatInterrupt } from "./combatLog";
import { KeyboardInput, type KeyAction } from "./KeyboardInput";
import { PlayerVisual, type PlayerView } from "./PlayerVisual";

// Textes flottants des événements de combat.
const CONTROL_LABELS: Record<string, string> = { mez: "Mez", stun: "Stun", root: "Root" };
const INFO_LABELS: Partial<Record<CombatEvent["kind"], string>> = {
  blocked: "Bloqué",
  evaded: "Esquivé",
  absorbed: "Absorbé",
  intercepted: "Interception",
  immune: "Immunisé",
};

// Vitesse à laquelle l'affichage rattrape la position serveur (plus haut = plus réactif).
const SMOOTHING = 15;

// Fréquence de mise à jour de l'interface React (inutile de la recalculer à chaque frame).
const HUD_REFRESH_MS = 100;

// Quand la caméra tourne pendant un déplacement, on renvoie la direction au plus 20 fois par seconde.
const YAW_RESEND_MS = 50;
const YAW_RESEND_THRESHOLD = 0.02;

export class Game {
  private engine: Engine;
  private scene: Scene;
  private camera: CameraController;
  private overlay: WorldOverlay;
  private spellEffects: SpellEffects;
  private keyboard: KeyboardInput;
  // Dernières touches de déplacement et orientation de caméra envoyées au serveur.
  private moveKeys: MoveInput = NO_INPUT;
  private sentYaw = 0;
  private lastMoveSent = 0;
  private players = new Map<string, PlayerVisual>();
  private targetId: string | null = null;
  private targetMarker!: Mesh;
  private lastHudRefresh = 0;
  private lastHudSnapshot = "";

  constructor(
    canvas: HTMLCanvasElement,
    overlayElement: HTMLElement,
    private room: Room,
  ) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.07, 0.08, 0.1, 1);

    this.camera = new CameraController(this.scene, canvas);
    this.overlay = new WorldOverlay(overlayElement, this.scene);
    this.spellEffects = new SpellEffects(this.scene);

    this.createEnvironment();
    this.createTargetMarker();
    this.bindState();
    this.bindMessages();

    this.keyboard = new KeyboardInput(
      (keys) => {
        this.moveKeys = keys;
        this.sendMove();
      },
      (action) => this.handleAction(action),
    );
    this.scene.onPointerObservable.add((info) => this.handlePointer(info));

    // Commandes accessibles depuis l'interface React (choix de classe, lancement anticipé).
    useHudStore.getState().setActions({
      selectClass: (classId) => this.room.send("selectClass", { classId }),
      forceStart: () => this.room.send("forceStart"),
      addBots: () => this.room.send("addBots"),
    });

    // Accès à la scène depuis la console du navigateur, en développement uniquement.
    if (import.meta.env.DEV) (window as unknown as { scene: Scene }).scene = this.scene;

    this.engine.runRenderLoop(() => this.renderFrame());
    window.addEventListener("resize", this.handleResize);
  }

  dispose() {
    useHudStore.getState().setActions(null);
    window.removeEventListener("resize", this.handleResize);
    this.keyboard.dispose();
    this.camera.dispose();
    this.overlay.dispose();
    this.spellEffects.dispose();
    this.room.leave();
    this.engine.dispose();
  }

  private handleResize = () => this.engine.resize();

  // Le serveur convertit les touches en direction selon l'orientation de la caméra : on la joint aux touches.
  private sendMove() {
    this.sentYaw = this.camera.yaw;
    this.lastMoveSent = performance.now();
    this.room.send("input", { ...this.moveKeys, yaw: this.sentYaw });
  }

  // Si la caméra tourne pendant qu'on se déplace, la direction de marche change : on prévient le serveur.
  private resendMoveIfCameraTurned() {
    const k = this.moveKeys;
    if (!(k.up || k.down || k.left || k.right)) return;
    const turned = Math.abs(Math.atan2(Math.sin(this.camera.yaw - this.sentYaw), Math.cos(this.camera.yaw - this.sentYaw)));
    if (turned > YAW_RESEND_THRESHOLD && performance.now() - this.lastMoveSent > YAW_RESEND_MS) this.sendMove();
  }

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

    // Zones de départ, à la couleur de chaque équipe.
    START_ZONES.forEach((zone, team) => {
      const disc = CreateDisc(`startZone${team}`, { radius: zone.radius, tessellation: 64 }, this.scene);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(zone.x, 0.02, zone.z);
      const material = new StandardMaterial(`startZoneMat${team}`, this.scene);
      material.diffuseColor = team === 0 ? new Color3(0.2, 0.35, 0.7) : new Color3(0.7, 0.2, 0.2);
      material.alpha = 0.35;
      disc.material = material;
      disc.isPickable = false;
    });
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
    });

    callbacks.onRemove("players", (_player, sessionId) => {
      const key = sessionId as string;
      this.players.get(key)?.dispose();
      this.overlay.removePlayer(key);
      this.players.delete(key);
      if (this.targetId === key) this.setTarget(null);
    });
  }

  private bindMessages() {
    const hud = useHudStore.getState();
    const nameOf = (id: string) => this.nameOf(id);
    this.room.onMessage("combat", (event: CombatEvent) => {
      for (const line of formatCombatEvent(event, nameOf, this.room.sessionId)) hud.pushLog(line);
      this.showCombatText(event);
    });
    this.room.onMessage("interrupt", (event: InterruptEvent) => {
      hud.pushLog(formatInterrupt(event, nameOf));
      const caster = this.players.get(event.casterId);
      if (caster) this.overlay.addText(caster.root, "Interrompu", "info");
    });
    this.room.onMessage("ability", (event: AbilityUsedEvent) => {
      this.spellEffects.play(event.abilityId, this.players.get(event.casterId)?.root, this.players.get(event.targetId)?.root);
    });
    this.room.onMessage("cooldown", (event: CooldownEvent) => hud.startCooldown(event.abilityId, event.duration));
    this.room.onMessage("error", (event: { message: string }) => hud.flash(event.message));
  }

  // Joueurs gardés et leur Gardien, tous deux vivants et visibles : id du protégé → [protégé, Gardien].
  private guardLinks(): Map<string, [TransformNode, TransformNode]> {
    const links = new Map<string, [TransformNode, TransformNode]>();
    for (const player of this.players.values()) {
      if (!player.isAlive) continue;
      for (const effect of player.state.effects) {
        if (effect.kind !== "guarded") continue;
        const guardian = this.players.get(effect.source);
        if (guardian?.isAlive) links.set(player.sessionId, [player.root, guardian.root]);
      }
    }
    return links;
  }

  // Texte flottant au-dessus de la cible d'un événement de combat.
  private showCombatText(event: CombatEvent) {
    const target = this.players.get(event.targetId);
    if (!target) return;
    const anchor = target.root;
    // Le texte d'un sort à projectile attend que le projectile arrive.
    const delay = isProjectile(event.abilityId) ? PROJECTILE_TRAVEL_TIME : 0;
    switch (event.kind) {
      case "damage": {
        // Rouge quand ça touche son équipe, clair quand ça touche l'adversaire.
        const ally = target.state.team === this.self?.state.team;
        this.overlay.addText(anchor, `-${event.amount}`, ally ? "damageTaken" : "damageDealt", event.crit, delay);
        break;
      }
      case "heal":
        if (event.amount) this.overlay.addText(anchor, `+${event.amount}`, "heal", false, delay);
        break;
      case "resurrect":
        this.overlay.addText(anchor, "Ressuscité", "heal");
        break;
      case "cc":
        this.overlay.addText(anchor, CONTROL_LABELS[event.detail ?? ""] ?? "", "control", false, delay);
        break;
      default:
        if (INFO_LABELS[event.kind]) this.overlay.addText(anchor, INFO_LABELS[event.kind]!, "info", false, delay);
    }
  }

  private get self(): PlayerVisual | undefined {
    return this.players.get(this.room.sessionId);
  }

  private handleAction(action: KeyAction) {
    if (action.startsWith("slot")) {
      const slot = Number(action.slice(4)) - 1;
      const abilityId = this.self && getClass(this.self.state.classId)?.abilities[slot];
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
      case "targetSelf":
        this.setTarget(this.room.sessionId);
        break;
      case "toggleAttack":
        this.room.send("toggleAttack");
        break;
      case "faceTarget":
        this.room.send("faceTarget");
        break;
      case "resetCamera":
        this.camera.reset();
        break;
    }
  }

  // Clic gauche sur un personnage (allié, ennemi ou mort) : il devient la cible.
  private handlePointer(info: PointerInfo) {
    if (info.type !== PointerEventTypes.POINTERDOWN || info.event.button !== 0) return;
    const sessionId = info.pickInfo?.pickedMesh?.metadata?.sessionId as string | undefined;
    if (sessionId) this.setTarget(sessionId);
  }

  // Tab : passe à l'ennemi vivant et visible suivant, du plus proche au plus éloigné.
  private cycleTarget() {
    const self = this.self;
    if (!self) return;

    const candidates = [...this.players.values()]
      .filter(
        (p) =>
          p.state.team !== self.state.team &&
          p.isAlive &&
          distance(self.state, p.state) <= TAB_TARGET_RANGE &&
          hasLineOfSight(self.state, p.state),
      )
      .sort((a, b) => distance(self.state, a.state) - distance(self.state, b.state));
    if (candidates.length === 0) return;

    const currentIndex = candidates.findIndex((p) => p.sessionId === this.targetId);
    this.setTarget(candidates[(currentIndex + 1) % candidates.length].sessionId);
  }

  // Le serveur ignore une cible sur soi-même : sans cible, soins et buffs s'appliquent au lanceur.
  private setTarget(targetId: string | null) {
    this.targetId = targetId;
    this.room.send("target", { targetId: targetId === this.room.sessionId ? null : targetId });
  }

  private nameOf(id: string): string {
    return id === this.room.sessionId ? "Vous" : (this.players.get(id)?.state.name ?? "?");
  }

  private renderFrame() {
    const dt = this.engine.getDeltaTime() / 1000;
    // Lissage exponentiel : on rattrape la position reçue du serveur sans à-coups,
    // le serveur n'envoyant que 20 mises à jour par seconde.
    const smoothing = 1 - Math.exp(-SMOOTHING * dt);
    for (const player of this.players.values()) {
      player.update(smoothing);
      const control = !player.isAlive ? null : player.hasEffect("stun") ? "stun" : player.hasEffect("mez") ? "mez" : null;
      this.overlay.setIndicator(player.sessionId, player.root, control);
    }
    this.overlay.update(dt);
    this.spellEffects.update(dt);
    this.spellEffects.updateGuardLinks(this.guardLinks());

    const self = this.self;
    if (self) this.camera.follow(self.root.position);
    this.resendMoveIfCameraTurned();

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
          ...unitFrame(self.state),
          classId: self.state.classId as ClassId,
          mana: Math.floor(self.state.mana),
          maxMana: self.state.maxMana,
          endurance: Math.floor(self.state.endurance),
          maxEndurance: self.state.maxEndurance,
          attacking: self.state.attacking,
          songActive: self.state.songActive,
        }
      : null;
    const targetFrame: TargetFrame | null =
      self && target
        ? {
            ...unitFrame(target.state),
            isSelf: target === self,
            isAlly: target.state.team === self.state.team,
            distance: Math.round(distance(self.state, target.state)),
            inMeleeRange: isInMeleeRange(self.state, target.state),
            inLineOfSight: hasLineOfSight(self.state, target.state),
            facing: isFacing(self.state, target.state),
          }
        : null;

    const state = this.room.state as {
      phase: MatchPhase;
      phaseTimeLeft: number;
      playerCount: number;
      matchSize: number;
      winner: number;
    };
    const matchFrame: MatchFrame = {
      phase: state.phase,
      timeLeft: Math.ceil(state.phaseTimeLeft),
      playerCount: state.playerCount,
      matchSize: state.matchSize,
      team: self?.state.team ?? 0,
      winner: state.winner,
    };
    // Le serveur ne nous envoie que nos coéquipiers pendant le choix des classes.
    const teammates: TeammateFrame[] = self
      ? [...this.players.values()]
          .filter((p) => p.state.team === self.state.team)
          .map((p) => ({
            name: p.state.name,
            classId: p.state.classId as ClassId | "",
            isSelf: p === self,
            isBot: p.state.isBot,
          }))
      : [];

    // On ne prévient React que si quelque chose a réellement changé.
    const snapshot = JSON.stringify([selfFrame, targetFrame, matchFrame, teammates]);
    if (snapshot === this.lastHudSnapshot) return;
    this.lastHudSnapshot = snapshot;
    const hud = useHudStore.getState();
    hud.setFrames(selfFrame, targetFrame);
    hud.setMatch(matchFrame, teammates);
  }
}

function unitFrame(state: PlayerView) {
  return {
    name: state.name,
    className: getClass(state.classId)?.name ?? "",
    hp: state.hp,
    maxHp: state.maxHp,
    cast: castFrame(state),
    effects: effectFrames(state),
  };
}

function castFrame(state: PlayerView): CastFrame | null {
  if (!state.castAbility || state.castDuration <= 0) return null;
  return {
    abilityName: getAbility(state.castAbility)?.name ?? state.castAbility,
    progress: Math.min(1, state.castElapsed / state.castDuration),
  };
}

function effectFrames(state: PlayerView): EffectFrame[] {
  return [...state.effects].map((e) => ({
    kind: e.kind as EffectKind,
    remaining: e.remaining === PERMANENT ? null : Math.ceil(e.remaining),
  }));
}
