import "@babylonjs/core/Culling/ray"; // Effet de bord : active scene.pick() pour le ciblage au clic.
import { Engine } from "@babylonjs/core/Engines/engine";
import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { Callbacks, type Room } from "@colyseus/sdk";
import {
  ARENA_SIZE,
  EFFECTS,
  PERMANENT,
  SPELL_RANGE,
  TAB_TARGET_RANGE,
  terrainHeight,
  distance,
  getAbility,
  getClass,
  hasLineOfSight,
  isFacing,
  positionRelativeTo,
  inputToDirection,
  isInMeleeRange,
  NO_INPUT,
  type ClassId,
  type AbilityUsedEvent,
  type CombatEvent,
  type CooldownEvent,
  type SwingEvent,
  type EffectCategory,
  type EffectKind,
  type InterruptEvent,
  type MatchPhase,
  type MoveInput,
} from "@arena/shared";
import {
  useHudStore,
  type CastFrame,
  type EffectFrame,
  type GroupMemberFrame,
  type MatchFrame,
  type SelfFrame,
  type TargetFrame,
  type TeammateFrame,
} from "../store";
import { CameraController } from "./CameraController";
import { WorldOverlay } from "./WorldOverlay";
import { createGround, createLights, createSky } from "./environment";
import { audio } from "../audio/AudioManager";
import { Nature } from "./nature";
import { Shadows } from "./shadows";
import { Village } from "./village";
import { FogOfWar, type FogWatcher } from "./FogOfWar";
import { SpellEffects } from "./SpellEffects";
import { GameAudio } from "./GameAudio";
import { PROJECTILE_TRAVEL_TIME, isProjectile } from "./spellFx";
import { formatCombatEvent, formatInterrupt } from "./combatLog";
import { KeyboardInput, type KeyAction } from "./KeyboardInput";
import { CharacterAssets } from "./characterAssets";
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

// Vitesse de la caméra libre en mode spectateur, en mètres par seconde.
const SPECTATOR_SPEED = 18;

// Identifiant donné par le serveur aux coups d'auto-attaque dans les événements de combat.
const AUTO_ATTACK_ID = "auto";
// Issues possibles d'un coup d'auto-attaque (le coup est porté, qu'il touche ou non).
const SWING_EVENTS = new Set<CombatEvent["kind"]>(["damage", "blocked", "evaded", "absorbed", "intercepted"]);
// Point visé pour savoir si une maison cache le joueur : le milieu de son corps.
const VILLAGE_FOCUS_HEIGHT = new Vector3(0, 1.2, 0);
// Au-delà de ces dégâts (ou sur un critique), la réaction est plus marquée.
const HEAVY_HIT = 200;

export class Game {
  private engine: Engine;
  private scene: Scene;
  private camera: CameraController;
  private overlay: WorldOverlay;
  private spellEffects: SpellEffects;
  private village: Village;
  private shadows: Shadows | null = null;
  private fog: FogOfWar;
  private gameAudio: GameAudio;
  private keyboard: KeyboardInput;
  // Dernières touches de déplacement et orientation de caméra envoyées au serveur.
  private moveKeys: MoveInput = NO_INPUT;
  private sentYaw = 0;
  private lastMoveSent = 0;
  // Point suivi par la caméra en mode spectateur (null quand on suit son personnage).
  private spectatorFocus: Vector3 | null = null;
  private players = new Map<string, PlayerVisual>();
  private characterAssets: CharacterAssets;
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

    this.camera = new CameraController(this.scene, canvas, () => {
      if (!this.isSpectating) this.sendMove();
    });
    this.overlay = new WorldOverlay(overlayElement, this.scene);
    this.spellEffects = new SpellEffects(this.scene);
    this.village = new Village(this.scene);
    this.characterAssets = new CharacterAssets(this.scene);
    this.characterAssets.preload();
    this.fog = new FogOfWar(this.scene);
    this.gameAudio = new GameAudio(this.camera, this.room.sessionId);

    this.createEnvironment();
    this.createTargetMarker();
    this.bindState();
    this.bindMessages();

    this.keyboard = new KeyboardInput(
      (keys) => {
        this.moveKeys = keys;
        // En mode spectateur, les touches déplacent la caméra, pas le personnage.
        if (!this.isSpectating) this.sendMove();
      },
      (action) => this.handleAction(action),
    );
    this.scene.onPointerObservable.add((info) => this.handlePointer(info));

    // Commandes accessibles depuis l'interface React (choix de classe, lancement anticipé).
    useHudStore.getState().setActions({
      selectClass: (classId) => this.room.send("selectClass", { classId }),
      forceStart: () => this.room.send("forceStart"),
      addBots: () => this.room.send("addBots"),
      selectTarget: (playerId) => this.setTarget(playerId),
      castAbility: (abilityId) => this.room.send("cast", { abilityId }),
    });

    // Accès à la scène depuis la console du navigateur, en développement uniquement.
    // En développement : scène et joueurs accessibles depuis la console du navigateur.
    if (import.meta.env.DEV) {
      Object.assign(window, { scene: this.scene, players: this.players, characterAssets: this.characterAssets, village: this.village, audio, spellEffects: this.spellEffects });
    }

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
    this.fog.dispose();
    this.shadows?.dispose();
    this.gameAudio.dispose();
    this.room.leave();
    this.engine.dispose();
  }

  private handleResize = () => this.engine.resize();

  // Touches de déplacement, plus l'état du clic droit : maintenu, le personnage s'oriente comme la caméra.
  private sendMove() {
    this.sentYaw = this.camera.yaw;
    this.lastMoveSent = performance.now();
    this.room.send("input", { ...this.moveKeys, steer: this.camera.steering, yaw: this.sentYaw });
  }

  // Mort pendant le combat : la caméra devient libre et le brouillard de guerre disparaît (côté serveur).
  private get isSpectating(): boolean {
    const self = this.self;
    return !!self && !self.isAlive && (this.room.state as { phase: MatchPhase }).phase === "fighting";
  }

  // Suit son personnage, ou en mode spectateur un point que l'on déplace avec ZQSD.
  private updateCamera(dt: number) {
    const self = this.self;
    if (!self) return;
    if (!this.isSpectating) {
      // Retour à la vie (Résurrection) : la caméra revient sur le personnage et les touches lui sont rendues.
      if (this.spectatorFocus) {
        this.spectatorFocus = null;
        this.sendMove();
      }
      this.camera.follow(self.root.position);
      // Clic droit : la souris oriente la caméra et le personnage suit. Sinon, la caméra se place dans son dos.
      if (this.camera.steering) this.resendMoveIfCameraTurned();
      else this.camera.followFacing(self.root.rotation.y, dt);
      return;
    }
    this.spectatorFocus ??= self.root.position.clone();
    const dir = inputToDirection({ ...this.moveKeys, yaw: this.camera.yaw });
    const limit = ARENA_SIZE / 2;
    this.spectatorFocus.x = Math.max(-limit, Math.min(limit, this.spectatorFocus.x + dir.x * SPECTATOR_SPEED * dt));
    this.spectatorFocus.z = Math.max(-limit, Math.min(limit, this.spectatorFocus.z + dir.z * SPECTATOR_SPEED * dt));
    this.spectatorFocus.y = terrainHeight(this.spectatorFocus.x, this.spectatorFocus.z);
    this.camera.follow(this.spectatorFocus);
  }

  // Clic droit maintenu : quand la souris tourne la caméra, le personnage doit tourner aussi.
  private resendMoveIfCameraTurned() {
    const turned = Math.abs(Math.atan2(Math.sin(this.camera.yaw - this.sentYaw), Math.cos(this.camera.yaw - this.sentYaw)));
    if (turned > YAW_RESEND_THRESHOLD && performance.now() - this.lastMoveSent > YAW_RESEND_MS) this.sendMove();
  }

  private createEnvironment() {
    this.shadows = new Shadows(createLights(this.scene));
    this.characterAssets.shadows = this.shadows;
    this.village.shadows = this.shadows;
    createSky(this.scene);
    this.shadows.receive([createGround(this.scene)]);

    // Les obstacles (même définition que celle du serveur) sont habillés en hameau.
    void this.village.load();
    void new Nature(this.scene).load();

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
      this.players.set(
        key,
        new PlayerVisual(this.scene, player as PlayerView, key, key === this.room.sessionId, this.characterAssets),
      );
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
      this.gameAudio.onCombat(event, this.players.get(event.sourceId), this.players.get(event.targetId));
      // Auto-attaque : le personnage qui frappe joue son coup.
      if (event.abilityId === AUTO_ATTACK_ID && SWING_EVENTS.has(event.kind)) {
        this.players.get(event.sourceId)?.playAttack();
      }
      this.playReaction(event);
      // La bulle de l'Arcaniste absorbe un coup : elle éclate.
      if (event.kind === "absorbed") {
        const target = this.players.get(event.targetId);
        if (target) this.spellEffects.bubblePop(target.root);
      }
      if (event.kind === "damage") {
        const target = this.players.get(event.targetId);
        // Coup critique : gerbe d'étincelles dorées ; sort de feu : la cible brûle un instant.
        if (target && event.crit) this.spellEffects.critHit(target.root);
        if (target) this.spellEffects.magicHit(event.abilityId, target.root);
      }
    });
    this.room.onMessage("interrupt", (event: InterruptEvent) => {
      hud.pushLog(formatInterrupt(event, nameOf));
      this.gameAudio.onInterrupt(event);
      const caster = this.players.get(event.casterId);
      if (caster) this.overlay.addText(caster.root, "Interrompu", "info");
    });
    this.room.onMessage("ability", (event: AbilityUsedEvent) => {
      this.players.get(event.casterId)?.playAbility(event.abilityId);
      // L'Arcaniste lance sa bulle : elle se montre un instant.
      if (event.abilityId === "bubble") this.spellEffects.statuses.bubbleWasApplied(event.casterId);
      this.spellEffects.play(event.abilityId, this.players.get(event.casterId)?.root, this.players.get(event.targetId)?.root);
      this.gameAudio.onAbility(event.abilityId, this.players.get(event.casterId), this.players.get(event.targetId));
    });
    this.room.onMessage("cooldown", (event: CooldownEvent) => {
      hud.startCooldown(event.abilityId, event.duration);
      this.gameAudio.onCooldown(event.duration);
    });
    this.room.onMessage("swing", (event: SwingEvent) => hud.startSwing(event.remaining, event.struck));
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
  // Le personnage touché réagit : léger recul, coup marqué, projection quand il est stun, parade quand il bloque.
  private playReaction(event: CombatEvent) {
    if (event.kind === "damage" && event.amount) {
      const heavy = event.crit || event.amount >= HEAVY_HIT;
      this.players.get(event.targetId)?.playReaction(heavy ? "heavy" : "light");
    } else if (event.kind === "cc" && event.detail === "stun") {
      this.players.get(event.targetId)?.playReaction("stun");
    } else if (event.kind === "blocked" && event.detail) {
      // detail : celui qui a bloqué (la cible elle-même, ou le Gardien qui la protège).
      this.players.get(event.detail)?.playReaction("block");
    }
  }

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
    if (action.startsWith("group")) {
      const member = this.groupMembers()[Number(action.slice(5)) - 1];
      if (member) this.setTarget(member.sessionId);
      return;
    }
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
      case "faceLock":
        this.room.send("faceLock");
        break;
      case "stick":
        this.room.send("stick");
        break;
      case "resetCamera":
        this.camera.reset(this.isSpectating ? undefined : this.self?.root.rotation.y);
        // En mode spectateur, V ramène aussi la caméra sur son corps.
        if (this.spectatorFocus && this.self) this.spectatorFocus.copyFrom(this.self.root.position);
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

  // Coéquipiers hors soi-même, dans un ordre stable (celui d'arrivée dans la partie).
  private groupMembers(): PlayerVisual[] {
    const self = this.self;
    if (!self) return [];
    return [...this.players.values()].filter((p) => p !== self && p.state.team === self.state.team);
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
      // Le stun est montré en 3D (étoiles autour de la tête, voir StatusFx) ; le mez garde ses « Zzz ».
      const control = player.isAlive && player.hasEffect("mez") ? "mez" : null;
      this.overlay.setIndicator(player.sessionId, player.root, control);
      const classId = player.state.classId as ClassId | "";
      const enemy = !!this.self && player.state.team !== this.self.state.team;
      // Un allié se reconnaît à son pseudo, un ennemi à sa classe.
      const label = enemy ? (getClass(classId)?.name ?? "") : player.state.name;
      this.overlay.setBadge(player.sessionId, player.root, classId, label, enemy ? "enemy" : "ally", player.isAlive);
      // Comme les textes, les tenues dépendent du point de vue : alliés en bleu, ennemis en rouge.
      player.setOutfitColor(enemy ? 1 : 0);
    }
    this.overlay.update(dt);
    this.spellEffects.update(dt);
    this.spellEffects.statuses.update(dt, this.players.values());
    if (this.self) this.village.camps.setLocalTeam(this.self.state.team);
    this.shadows?.update(this.camera.camera.target);
    this.village.update(dt, this.camera.camera, this.self ? this.self.root.position.add(VILLAGE_FOCUS_HEIGHT) : null);
    const match = this.room.state as { phase: MatchPhase; phaseTimeLeft: number; winner: number };
    this.gameAudio.update(dt, this.players.values(), this.self, match.phase, match.phaseTimeLeft, match.winner);
    this.spellEffects.updateGuardLinks(this.guardLinks());

    const self = this.self;
    this.updateCamera(dt);
    this.updateFog(dt, self, match.phase);

    const target = this.targetId ? this.players.get(this.targetId) : undefined;
    this.targetMarker.setEnabled(!!target);
    if (target) this.targetMarker.position.set(target.root.position.x, target.root.position.y + 0.06, target.root.position.z);

    this.refreshHud(self, target);
    this.scene.render();
  }

  // Le brouillard s'affiche quand le serveur l'applique : en préparation et en combat, sauf en spectateur.
  private updateFog(dt: number, self: PlayerVisual | undefined, phase: MatchPhase) {
    const active = !!self && (phase === "preparation" || phase === "fighting") && !this.isSpectating;
    this.fog.setEnabled(active);
    if (!active) return;
    const watchers: FogWatcher[] = [];
    for (const player of this.players.values()) {
      if (player.isAlive && player.state.team === self.state.team) {
        watchers.push({ id: player.sessionId, x: player.state.x, z: player.state.z });
      }
    }
    this.fog.update(dt, watchers);
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
          lock: self.state.lock,
          songActive: self.state.songActive,
          queuedAbility: self.state.queuedAbility,
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
            position: positionRelativeTo(target.state, self.state),
          }
        : null;

    const group: GroupMemberFrame[] = self
      ? this.groupMembers().map((p) => ({
          id: p.sessionId,
          name: p.state.name,
          classId: p.state.classId as ClassId | "",
          hp: p.state.hp,
          maxHp: p.state.maxHp,
          mana: Math.floor(p.state.mana),
          maxMana: p.state.maxMana,
          endurance: Math.floor(p.state.endurance),
          maxEndurance: p.state.maxEndurance,
          casting: castFrame(p.state)?.abilityName ?? null,
          effects: sortAfflictionsFirst(effectFrames(p.state)),
          inRange: distance(self.state, p.state) <= SPELL_RANGE && hasLineOfSight(self.state, p.state),
          isTarget: p === target,
        }))
      : [];

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
    const snapshot = JSON.stringify([selfFrame, targetFrame, group, matchFrame, teammates]);
    if (snapshot === this.lastHudSnapshot) return;
    this.lastHudSnapshot = snapshot;
    const hud = useHudStore.getState();
    hud.setFrames(selfFrame, targetFrame, group);
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

// Les afflictions d'abord (ce qu'il faut purifier), puis les buffs, puis les immunités.
const CATEGORY_ORDER: Record<EffectCategory, number> = { control: 0, debuff: 1, buff: 2, immunity: 3 };

function sortAfflictionsFirst(effects: EffectFrame[]): EffectFrame[] {
  return effects.sort((a, b) => CATEGORY_ORDER[EFFECTS[a.kind].category] - CATEGORY_ORDER[EFFECTS[b.kind].category]);
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
