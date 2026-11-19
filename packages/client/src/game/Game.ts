import "@babylonjs/core/Culling/ray"; // Effet de bord : active scene.pick() pour le ciblage au clic.
import { Engine } from "@babylonjs/core/Engines/engine";
import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
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
  isMagic,
  NEAR_SIGHT_FACTOR,
  type AbilityDef,
  MELEE_RANGE,
  positionRelativeTo,
  inputToDirection,
  isInMeleeRange,
  NO_INPUT,
  START_ZONES,
  confineToZone,
  type ClassId,
  type AbilityUsedEvent,
  type CombatEvent,
  type CooldownEvent,
  type SwingEvent,
  type EffectCategory,
  type EffectKind,
  type GameErrorMessage,
  type InterruptEvent,
  type MatchPhase,
  type MoveInput,
  ORDERS,
  orderAvailable,
  type BotReplyMessage,
  type OrderSituation,
  type OrderId,
} from "@arena/shared";
import {
  useHudStore,
  type CastFrame,
  type EffectFrame,
  type GroupMemberFrame,
  type MatchFrame,
  type SelfFrame,
  type TargetFrame,
  type LoadingFrame,
  type TeammateFrame,
} from "../store";
import { CameraController } from "./CameraController";
import { WorldOverlay, type StatusIndicator } from "./WorldOverlay";
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
import { errorText } from "../abilityBar";
import { abilityName, className, effectLabel, t, type TextKey } from "../i18n";
import { KeyboardInput, type KeyAction } from "./KeyboardInput";
import { OrderWheel } from "./OrderWheel";
import { MAGNET_RADIUS, bestCandidate, rankEnemies, type EnemyCandidate, type EnemyRanking, type TargetCandidate } from "./targeting";
import { CharacterAssets } from "./characterAssets";
import { LoadingTracker } from "./loading";
import { lobbyReady, waitForLobby } from "./lobbyPriority";
import { MovementPredictor, VelocityTracker } from "./prediction";
import { TUNING } from "./tuning";
import { MUSIC } from "./commonSounds";
import { PlayerVisual, type PlayerView } from "./PlayerVisual";
import { RenderScale } from "./renderScale";

// Textes flottants des événements de combat : contrôles et affaiblissements affichés (nom de l'effet), et
// issues d'un coup. Pas de texte pour l'Oubli : la cible ne doit pas le voir venir.
const FLOATING_EFFECTS = new Set(["mez", "stun", "root", "nearSight", "silenced", "poisoned", "gangrene", "armorBroken"]);
const INFO_LABELS: Partial<Record<CombatEvent["kind"], TextKey>> = {
  blocked: "float.blocked",
  evaded: "float.evaded",
  absorbed: "float.absorbed",
  intercepted: "float.intercepted",
  immune: "float.immune",
  taunt: "float.taunted",
};

// Provocation : durée de l'effet, et durée d'affichage des points d'exclamation au-dessus de la cible.
const TAUNT_DURATION = getAbility("taunt")?.effects.find((e) => e.type === "taunt")?.duration ?? 6;
const TAUNT_MARK_DURATION = 2.5;

// Vitesse à laquelle l'affichage rattrape la position serveur (plus haut = plus réactif).
const SMOOTHING = 15;

// Fréquence de mise à jour de l'interface React (inutile de la recalculer à chaque frame).
const HUD_REFRESH_MS = 100;
// Mesure de l'aller-retour avec le serveur (affiché à côté du son).
const PING_INTERVAL_MS = 2000;
const PERF_REPORT_MS = 30_000;
// Attente maximale de l'écran de choix avant de lancer le préchargement du jeu (voir lobbyPriority).
const LOBBY_PRIORITY_MAX_MS = 10_000;

// Quand la caméra tourne pendant un déplacement, on renvoie la direction au plus 20 fois par seconde.
const YAW_RESEND_MS = 50;
const YAW_RESEND_THRESHOLD = 0.02;

// En développement, ?lag=150 dans l'adresse retarde l'envoi des déplacements (en ms) : simule un joueur éloigné pour
// essayer la prédiction.
const DEV_INPUT_LAG = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("lag")) || 0 : 0;

// Contour des personnages survolés à la souris : rouge pour un ennemi, bleu pour un allié (comme leurs pseudos).
const HOVER_ENEMY = new Color3(1, 0.36, 0.32);
const HOVER_ALLY = new Color3(0.61, 0.78, 1);
// Point visé par l'aimant : le milieu du corps.
const BODY_CENTER = new Vector3(0, 1.1, 0);

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
  private orderWheel: OrderWheel;
  // Dernières touches de déplacement et orientation de caméra envoyées au serveur.
  private moveKeys: MoveInput = NO_INPUT;
  private sentYaw = 0;
  private lastMoveSent = 0;
  // Point suivi par la caméra en mode spectateur (null quand on suit son personnage).
  private spectatorFocus: Vector3 | null = null;
  private players = new Map<string, PlayerVisual>();
  private characterAssets: CharacterAssets;
  private targetId: string | null = null;
  // Cible ennemie vivante à l'image précédente : sa mort déclenche un nouveau ciblage (voir retargetAfterDeath).
  private aliveEnemyTarget: string | null = null;
  private targetMarker!: Mesh;
  private lastHudRefresh = 0;
  private lastHudSnapshot = "";
  // Chargement du jeu, suivi pour l'écran de chargement ; dernier pourcentage envoyé au serveur.
  private loading: LoadingTracker;
  private sentLoadPercent = -1;
  private pingTimer: ReturnType<typeof setInterval>;
  private perfTimer: ReturnType<typeof setInterval>;
  // Prédiction du déplacement de son propre personnage.
  private predictor = new MovementPredictor();
  private targetVelocity = new VelocityTracker();
  // Instant d'envoi de la mesure en cours (null si elle a répondu) ; jeu arrêté (réponses ignorées).
  private pingSentAt: number | null = null;
  private disposed = false;
  // Personnage survolé par la souris (contour), et souris au-dessus du canvas.
  private hoveredId: string | null = null;
  private hoveredColor: Color3 | null = null;
  private pointerInside = false;

  constructor(
    private canvas: HTMLCanvasElement,
    overlayElement: HTMLElement,
    private room: Room,
  ) {
    this.engine = new Engine(canvas, true);
    this.renderScale = new RenderScale(this.engine, () => {
      const phase = (this.room.state as { phase?: MatchPhase }).phase;
      return phase === "preparation" || phase === "fighting";
    });
    this.scene = new Scene(this.engine);
    // Le chargement commence dès la salle d'attente ; le serveur attend que chacun ait fini avant la préparation.
    this.loading = new LoadingTracker(() => this.sendLoadProgress());

    this.camera = new CameraController(this.scene, canvas, () => {
      if (!this.isSpectating) this.sendMove();
    });
    this.overlay = new WorldOverlay(overlayElement, this.scene);
    this.spellEffects = new SpellEffects(this.scene);
    this.village = new Village(this.scene);
    // Le chargement attend que l'écran de choix ait affiché ses personnages (voir lobbyPriority) : préchargement, mais
    // aussi les personnages des joueurs déjà connus (bots, coéquipiers), qui passent par les mêmes fichiers. L'attente
    // compte dans le chargement : la barre n'atteint pas 100 % avant que le reste soit lancé (le serveur croirait sinon
    // que le joueur a fini).
    const lobbyFirst = waitForLobby(LOBBY_PRIORITY_MAX_MS);
    this.characterAssets = new CharacterAssets(this.scene);
    this.characterAssets.gate = lobbyFirst;
    void this.loading.track(
      lobbyFirst.then(() => {
        if (this.disposed) return;
        const track = <T>(task: Promise<T>, weight?: number) => this.loading.track(task, weight);
        // Chaque lancement à part : une erreur dans l'un ne doit pas empêcher de déclarer les suivants (la barre
        // atteindrait sinon 100 % sans eux).
        const launches = [
          () => this.characterAssets.preload(track),
          () => audio.preloadGame(soundRecipes(TUNING), [MUSIC.match], track),
          // Les obstacles (même définition que celle du serveur) sont habillés en hameau.
          () => void track(this.village.load(), 10),
          () => void track(new Nature(this.scene).load(), 10),
        ];
        for (const launch of launches) {
          try {
            launch();
          } catch (error) {
            console.error(error);
          }
        }
      }),
    );
    this.fog = new FogOfWar(this.scene);
    this.gameAudio = new GameAudio(this.camera, this.room.sessionId);
    // Les pistes de sons des compétences réglées passent par l'audio du jeu (spatialisé).
    this.spellEffects.scenery.sounds = this.gameAudio.sink;

    this.createEnvironment();
    this.createTargetMarker();
    this.bindState();
    this.bindMessages();
    this.sendLoadProgress();

    this.keyboard = new KeyboardInput(
      (keys) => {
        this.moveKeys = keys;
        // En mode spectateur, les touches déplacent la caméra, pas le personnage.
        if (!this.isSpectating) this.sendMove();
      },
      (action) => this.handleAction(action),
    );
    this.scene.onPointerObservable.add((info) => this.handlePointer(info));
    // Survol et clic sont calculés par le jeu (zones de clic seulement, voir playerUnderPointer) : pas de lancer de
    // rayon automatique, et le jeu gère lui-même le curseur.
    this.scene.skipPointerMovePicking = true;
    this.scene.skipPointerDownPicking = true;
    this.scene.doNotHandleCursors = true;
    canvas.addEventListener("pointerenter", this.handlePointerEnter);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.orderWheel = new OrderWheel(canvas, () => this.orderWheelItems(), (order) => this.giveOrder(order));

    // Commandes accessibles depuis l'interface React (choix de classe, lancement anticipé).
    useHudStore.getState().setActions({
      selectClass: (classId) => this.room.send("selectClass", { classId }),
      forceStart: () => this.room.send("forceStart"),
      setBotClass: (botId, classId) => this.room.send("setBotClass", { botId, classId }),
      selectTarget: (playerId) => this.setTarget(playerId),
      selectSelf: () => this.setTarget(this.room.sessionId),
      castAbility: (abilityId) => this.castAbility(abilityId),
    });

    // Accès à la scène depuis la console du navigateur, en développement uniquement.
    // En développement : scène et joueurs accessibles depuis la console du navigateur.
    if (import.meta.env.DEV) {
      Object.assign(window, { scene: this.scene, players: this.players, characterAssets: this.characterAssets, village: this.village, audio, spellEffects: this.spellEffects });
    }

    this.measurePing();
    this.pingTimer = setInterval(() => this.measurePing(), PING_INTERVAL_MS);
    // Images/s et résolution, pour la télémétrie : le serveur garde le dernier envoi et le joint au résultat du joueur.
    this.perfTimer = setInterval(() => this.sendPerf(), PERF_REPORT_MS);

    this.engine.runRenderLoop(() => this.renderFrame());
    window.addEventListener("resize", this.handleResize);
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.pingTimer);
    clearInterval(this.perfTimer);
    useHudStore.getState().setActions(null);
    window.removeEventListener("resize", this.handleResize);
    this.canvas.removeEventListener("pointerenter", this.handlePointerEnter);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.keyboard.dispose();
    this.orderWheel.dispose();
    this.camera.dispose();
    this.overlay.dispose();
    this.spellEffects.dispose();
    this.fog.dispose();
    this.shadows?.dispose();
    this.gameAudio.dispose();
    this.sendPerf();
    this.room.leave();
    this.renderScale.dispose();
    this.engine.dispose();
  }

  private renderScale: RenderScale;
  private sendPerf() {
    const stats = this.renderScale.stats();
    if (stats) this.room.send("perf", stats);
  }
  private handleResize = () => this.engine.resize();
  private handlePointerEnter = () => (this.pointerInside = true);
  private handlePointerLeave = () => (this.pointerInside = false);

  // Une mesure à la fois : tant que la précédente n'a pas répondu, on affiche le temps déjà écoulé (le SDK ne garde
  // qu'un envoi en mémoire, une nouvelle mesure ferait passer une réponse tardive pour une réponse rapide).
  // Connexion perdue : plus de chiffre.
  private measurePing() {
    const hud = useHudStore.getState();
    if (!this.room.connection.isOpen) {
      hud.setPing(null);
      return;
    }
    if (this.pingSentAt !== null) {
      hud.setPing(Math.max(hud.ping ?? 0, Math.round(performance.now() - this.pingSentAt)));
      return;
    }
    this.pingSentAt = performance.now();
    this.room.ping((ms) => {
      this.pingSentAt = null;
      if (!this.disposed) useHudStore.getState().setPing(ms);
    });
  }

  // Envoie l'avancement du chargement au serveur, à chaque point de pourcentage gagné.
  private sendLoadProgress() {
    const percent = Math.floor(this.loading.progress * 100);
    if (percent === this.sentLoadPercent) return;
    this.sentLoadPercent = percent;
    this.room.send("loadProgress", { progress: percent });
  }

  // Touches de déplacement, plus l'état du clic droit : maintenu, le personnage s'oriente comme la caméra.
  private sendMove() {
    // Tant que le jeu charge (écran de chargement), le joueur ne voit pas son personnage : pas de commandes.
    if (this.loading.progress < 1) return;
    this.sentYaw = this.camera.yaw;
    this.lastMoveSent = performance.now();
    const input: MoveInput = { ...this.moveKeys, steer: this.camera.steering, yaw: this.sentYaw };
    const message = { ...input, seq: this.predictor.send(input) };
    if (DEV_INPUT_LAG > 0) setTimeout(() => this.room.send("input", message), DEV_INPUT_LAG);
    else this.room.send("input", message);
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
        new PlayerVisual(this.scene, player as PlayerView, key, this.characterAssets),
      );
    });

    callbacks.onRemove("players", (_player, sessionId) => {
      const key = sessionId as string;
      this.players.get(key)?.dispose();
      this.overlay.removePlayer(key);
      this.players.delete(key);
      if (this.targetId === key) this.setTarget(null);
      if (this.hoveredId === key) {
        this.hoveredId = null;
        this.hoveredColor = null;
      }
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
      this.spellEffects.targets.onCombat(event);
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
      if (event.kind === "resurrect") {
        const target = this.players.get(event.targetId);
        if (target) this.spellEffects.revived(event.abilityId, target.root);
      }
    });
    this.room.onMessage("interrupt", (event: InterruptEvent) => {
      hud.pushLog(formatInterrupt(event, nameOf, this.room.sessionId));
      const caster = this.players.get(event.casterId);
      if (caster) this.overlay.addText(caster.root, t("float.interrupted"), "info");
      caster?.interruptCast();
    });
    this.room.onMessage("ability", (event: AbilityUsedEvent) => {
      this.players.get(event.casterId)?.playAbility(event.abilityId);
      // L'Arcaniste lance sa bulle : elle se montre un instant.
      if (event.abilityId === "bubble") this.spellEffects.statuses.bubbleWasApplied(event.casterId);
      this.spellEffects.play(event.abilityId, this.players.get(event.casterId)?.root, this.players.get(event.targetId)?.root);
      this.spellEffects.targets.onAbility(event.casterId, event.abilityId, event.targetId, this.players);
      this.gameAudio.onAbility(event.abilityId, this.players.get(event.casterId), this.players.get(event.targetId));
    });
    this.room.onMessage("cooldown", (event: CooldownEvent) => {
      hud.startCooldown(event.abilityId, event.duration);
      this.gameAudio.onCooldown(event.duration);
    });
    this.room.onMessage("swing", (event: SwingEvent) => hud.startSwing(event.remaining, event.struck));
    this.room.onMessage("error", (event: GameErrorMessage) => hud.flash(errorText(event.code, event.abilityId)));
    // Réponse d'un bot à un ordre : une bulle au-dessus de sa tête.
    this.room.onMessage("botReply", (message: BotReplyMessage) => {
      const bot = this.players.get(message.botId);
      if (bot) this.overlay.say(bot.sessionId, bot.root, t(`reply.${message.reply}` satisfies TextKey));
    });
    // Chargement trop long : un bot a pris notre place, le serveur nous déconnecte. Le jeu s'arrête derrière l'écran.
    this.room.onMessage("replacedByBot", () => {
      this.disposed = true;
      clearInterval(this.pingTimer);
      clearInterval(this.perfTimer);
      this.renderScale.dispose();
      hud.setPing(null);
      this.engine.stopRenderLoop();
      this.keyboard.dispose();
      this.orderWheel.dispose();
      hud.setStatus("replaced");
    });
  }

  // Indicateur au-dessus de la tête. Le stun est montré en 3D (étoiles autour de la tête, voir StatusFx) ; le mez
  // garde ses « Zzz » ; une cible provoquée porte des points d'exclamation rouges pendant les premières secondes ;
  // Near sight : deux yeux fermés tant que dure l'effet ; Rempart : une tour au-dessus des joueurs protégés, bleue
  // dans son camp, rouge chez l'adversaire. Un mez ou une provocation dont les effets sont réglés (page de réglage)
  // a son propre affichage.
  private indicatorOf(player: PlayerVisual): StatusIndicator | null {
    if (!player.isAlive) return null;
    const own = (kind: string) => this.spellEffects.targets.hasTunedStatus(player.sessionId, kind);
    const enemy = !!this.self && player.state.team !== this.self.state.team;
    const taunted = player.effectRemaining("taunted") > TAUNT_DURATION - TAUNT_MARK_DURATION;
    if (player.hasEffect("mez")) return own("mez") ? null : "mez";
    if (taunted) return own("taunted") ? null : "taunt";
    if (player.hasEffect("nearSight")) return "nearSight";
    if (player.hasEffect("meleeImmune")) return enemy ? "rampartEnemy" : "rampartAlly";
    return null;
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
    // Réaction réglée pour l'impact de la compétence (jouée à l'impact par TargetVisuals).
    if (event.kind === "damage" && this.spellEffects.targets.handlesReaction(event.targetId, event.abilityId)) return;
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
    const delay = isProjectile(event.abilityId) && event.sourceId !== event.targetId ? PROJECTILE_TRAVEL_TIME : 0;
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
        this.overlay.addText(anchor, t("float.resurrected"), "heal");
        break;
      case "cc":
      case "debuff": {
        if (FLOATING_EFFECTS.has(event.detail ?? "")) this.overlay.addText(anchor, effectLabel(event.detail!), "control", false, delay);
        break;
      }
      default:
        if (INFO_LABELS[event.kind]) this.overlay.addText(anchor, t(INFO_LABELS[event.kind]!), "info", false, delay);
    }
  }

  // Ordres de la roue (molette) : pendant le combat, vivant (même sous contrôle). Un ordre impossible sur le moment
  // est grisé (aucun bot pour l'exécuter, pas de cible, déjà à pleine vie…).
  private orderWheelItems() {
    const self = this.self;
    const phase = (this.room.state as { phase: MatchPhase }).phase;
    if (!self || !self.isAlive || phase !== "fighting" || this.loading.progress < 1) return null;
    const kinds = (p: PlayerVisual) => new Set([...p.state.effects].map((e) => e.kind));
    const state = self.state;
    const selfEffects = kinds(self);
    const target = this.targetId ? this.players.get(this.targetId) : undefined;
    const situation: OrderSituation = {
      issuer: {
        classId: state.classId as ClassId,
        hurt: state.hp < state.maxHp,
        mezzed: selfEffects.has("mez"),
        resourceFull: state.maxMana > 0 ? state.mana >= state.maxMana : state.endurance >= state.maxEndurance,
        effects: selfEffects,
      },
      hasEnemyTarget: !!target && target.isAlive && target.state.team !== state.team,
      bots: [...this.players.values()]
        .filter((p) => p.state.isBot && p.isAlive && p.state.team === state.team)
        .map((p) => {
          const effects = kinds(p);
          return {
            classId: p.state.classId as ClassId,
            mana: p.state.mana,
            song: p.state.song,
            incapacitated: effects.has("mez") || effects.has("stun") || effects.has("rampart"),
          };
        }),
    };
    return ORDERS.map((id) => ({ id, label: this.orderLabel(id), enabled: orderAvailable(id, situation) }));
  }

  // « J'ai besoin de mana » ou « d'endurance », selon la ressource de sa classe.
  private orderLabel(order: OrderId): string {
    if (order !== "resource") return t(`order.${order}`);
    return t(getClass(this.self?.state.classId ?? "")?.resource === "endurance" ? "order.resourceEndurance" : "order.resourceMana");
  }

  // Envoie l'ordre aux bots et l'affiche dans une bulle au-dessus de son personnage. La roue a pu rester ouverte
  // pendant que la situation changeait (mort, fin du combat, bot tombé) : on revérifie.
  private giveOrder(order: OrderId) {
    if (!this.orderWheelItems()?.find((item) => item.id === order)?.enabled) return;
    this.room.send("order", { order });
    const self = this.self;
    if (self) this.overlay.say(self.sessionId, self.root, this.orderLabel(order));
  }

  private get self(): PlayerVisual | undefined {
    return this.players.get(this.room.sessionId);
  }

  private handleAction(action: KeyAction) {
    if (this.loading.progress < 1) return;
    if (action.startsWith("group")) {
      const member = this.groupMembers()[Number(action.slice(5)) - 1];
      if (member) this.setTarget(member.sessionId);
      return;
    }
    if (action.startsWith("slot")) {
      const slot = Number(action.slice(4)) - 1;
      const abilityId = this.self && getClass(this.self.state.classId)?.abilities[slot];
      if (abilityId) this.castAbility(abilityId);
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
    const sessionId = this.playerUnderPointer();
    if (sessionId) this.setTarget(sessionId);
  }

  // Personnage visé par la souris : parmi ceux dont la zone de clic est sous le curseur, sinon (aimant) parmi ceux
  // dont le milieu du corps est à moins de MAGNET_RADIUS pixels du curseur. Jamais soi-même (F1 le fait) : son
  // personnage est toujours au milieu de l'écran et masquerait ce qui est derrière lui, un corps à ressusciter par
  // exemple. Priorité : vivant, puis ennemi, puis le plus proche.
  private playerUnderPointer(): string | null {
    const self = this.self;
    const x = this.scene.pointerX;
    const y = this.scene.pointerY;
    const describe = (player: PlayerVisual, distance: number): TargetCandidate => ({
      id: player.sessionId,
      alive: player.isAlive,
      enemy: !!self && player.state.team !== self.state.team,
      distance,
    });
    const hits = this.scene.multiPick(x, y, (mesh) => mesh.metadata?.hitbox === true && mesh.isEnabled()) ?? [];
    const touched: TargetCandidate[] = [];
    for (const hit of hits) {
      const player = this.players.get(hit.pickedMesh?.metadata?.sessionId);
      if (player && player !== self && !touched.some((c) => c.id === player.sessionId)) touched.push(describe(player, hit.distance));
    }
    if (touched.length > 0) return bestCandidate(touched);

    const near: TargetCandidate[] = [];
    for (const player of this.players.values()) {
      if (player === self || !player.root.isEnabled()) continue;
      const screen = this.toScreen(player.root.position.add(BODY_CENTER));
      if (!screen) continue;
      const distance = Math.hypot(screen.x - x, screen.y - y);
      if (distance <= MAGNET_RADIUS) near.push(describe(player, distance));
    }
    return bestCandidate(near);
  }

  // Position à l'écran (pixels CSS du canvas, comme scene.pointerX) d'un point du monde, ou null hors champ.
  private toScreen(point: Vector3): { x: number; y: number } | null {
    const camera = this.scene.activeCamera;
    if (!camera) return null;
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const projected = Vector3.Project(point, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), camera.viewport.toGlobal(width, height));
    if (projected.z < 0 || projected.z > 1) return null;
    return { x: (projected.x * this.canvas.clientWidth) / width, y: (projected.y * this.canvas.clientHeight) / height };
  }

  // Contour léger sur le personnage que la souris vise (celui qu'un clic ciblerait), et curseur en main. Pas pendant
  // qu'on oriente la caméra (clic droit) ni pendant la roue des ordres.
  private updateHover() {
    const active = this.pointerInside && !this.camera.steering && !useHudStore.getState().orderWheel;
    const id = active ? this.playerUnderPointer() : null;
    const player = id ? this.players.get(id) : undefined;
    const enemy = !!player && !!this.self && player.state.team !== this.self.state.team;
    const color = player ? (enemy ? HOVER_ENEMY : HOVER_ALLY) : null;
    // Même personnage, même couleur (l'équipe peut changer au lancement de la partie) : rien à refaire.
    if (id !== this.hoveredId || color !== this.hoveredColor) {
      if (this.hoveredId) this.players.get(this.hoveredId)?.setHovered(null);
      player?.setHovered(color);
      this.hoveredId = id;
      this.hoveredColor = color;
    }
    const cursor = player ? "pointer" : "";
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  // Tab : passe à l'ennemi vivant et visible suivant : ceux en ligne de vue d'abord, du plus proche au plus éloigné,
  // puis ceux cachés par un obstacle.
  private cycleTarget() {
    const candidates = rankEnemies(this.enemyCandidates());
    if (candidates.length === 0) return;
    const currentIndex = candidates.indexOf(this.targetId ?? "");
    this.setTarget(candidates[(currentIndex + 1) % candidates.length]);
  }

  // Touche de la barre ou clic sur une case : ciblage automatique si besoin, puis lancement.
  private castAbility(abilityId: string) {
    this.autoTarget(abilityId);
    this.room.send("cast", { abilityId });
  }

  // Ennemis vivants que l'équipe voit (le serveur n'envoie pas les autres), à moins de TAB_TARGET_RANGE. range et
  // minRange : portées de la compétence à lancer (range 0 : sans objet).
  private enemyCandidates(range = 0, minRange = 0): EnemyCandidate[] {
    const self = this.self;
    if (!self) return [];
    const candidates: EnemyCandidate[] = [];
    for (const p of this.players.values()) {
      if (p.state.team === self.state.team || !p.isAlive) continue;
      const d = distance(self.state, p.state);
      if (d > TAB_TARGET_RANGE) continue;
      candidates.push({
        id: p.sessionId,
        distance: d,
        lineOfSight: hasLineOfSight(self.state, p.state),
        inRange: (range <= 0 || d <= range) && d >= minRange,
        inFront: isFacing(self.state, p.state),
        controlled: p.hasEffect("mez") || p.hasEffect("root"),
      });
    }
    return candidates;
  }

  // Meilleur ennemi selon ranking, ou null.
  private bestEnemy(ranking: EnemyRanking, range = 0, minRange = 0): string | null {
    return rankEnemies(this.enemyCandidates(range, minRange), ranking)[0] ?? null;
  }

  // Compétence dirigée contre un ennemi lancée sans ennemi vivant en cible : le jeu en choisit un (en ligne de vue,
  // libre de mez et de root, à portée, devant soi, le plus proche). Une cible ennemie choisie par le joueur est gardée,
  // même hors de vue : il voit alors pourquoi le sort refuse. Rien ne change si la compétence ne peut pas partir de
  // toute façon (mort, contrôlé, en recharge, sans ressource, déjà en incantation) : la cible du joueur est gardée.
  private autoTarget(abilityId: string) {
    const ability = getAbility(abilityId);
    const self = this.self;
    if (!ability || !self || ability.target !== "enemy" || !this.canStart(ability)) return;
    const current = this.targetId ? this.players.get(this.targetId) : undefined;
    if (current && current.isAlive && current.state.team !== self.state.team) return;
    // Near sight : la portée des sorts est réduite (comme sur le serveur).
    const nearSight = isMagic(ability) && self.hasEffect("nearSight") ? NEAR_SIGHT_FACTOR : 1;
    const range = ability.melee ? MELEE_RANGE : ability.range * nearSight;
    const best = this.bestEnemy({ preferFree: true, preferInRange: true, preferFront: true }, range, ability.minRange ?? 0);
    if (best) this.setTarget(best);
  }

  // Vrai si rien chez le joueur n'empêche la compétence de partir (la cible mise à part).
  private canStart(ability: AbilityDef): boolean {
    const self = this.self;
    if (!self?.isAlive || self.state.castAbility) return false;
    if (self.hasEffect("mez") || self.hasEffect("stun") || self.hasEffect("rampart")) return false;
    if (isMagic(ability) && self.hasEffect("silenced")) return false;
    if (self.state[ability.resource] < ability.cost) return false;
    return (useHudStore.getState().cooldownEnds[ability.id] ?? 0) <= performance.now();
  }

  // Cible ennemie qui meurt sous les yeux du joueur : une autre est choisie aussitôt, de préférence ni mez ni root
  // (sinon n'importe laquelle). Seulement au moment de la mort : un corps ennemi ciblé ensuite au clic reste ciblé, et
  // sans candidat la cible morte reste (la prochaine compétence offensive en choisira une).
  private retargetAfterDeath() {
    const self = this.self;
    const target = this.targetId ? this.players.get(this.targetId) : undefined;
    const enemy = !!self && !!target && target.state.team !== self.state.team;
    if (enemy && target!.isAlive) {
      this.aliveEnemyTarget = target!.sessionId;
      return;
    }
    const died = enemy && this.aliveEnemyTarget === target!.sessionId;
    this.aliveEnemyTarget = null;
    if (!died || !self!.isAlive) return;
    const best = this.bestEnemy({ preferFree: true, preferFront: true });
    if (best) this.setTarget(best);
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
    return id === this.room.sessionId ? t("log.you") : (this.players.get(id)?.state.name ?? "?");
  }

  private renderFrame() {
    const dt = this.engine.getDeltaTime() / 1000;
    // Lissage exponentiel : on rattrape la position reçue du serveur sans à-coups,
    // le serveur n'envoyant que 20 mises à jour par seconde.
    const smoothing = 1 - Math.exp(-SMOOTHING * dt);
    this.predictSelf(dt);
    for (const player of this.players.values()) {
      player.update(smoothing);
      const enemy = !!this.self && player.state.team !== this.self.state.team;
      const classId = player.state.classId as ClassId | "";
      // Un allié se reconnaît à son pseudo, un ennemi à sa classe.
      const label = enemy ? (classId ? className(classId) : "") : player.state.name;
      this.overlay.setBadge(player.sessionId, player.root, classId, label, enemy ? "enemy" : "ally", player.isAlive);
    }
    this.retargetAfterDeath();
    this.overlay.update(dt);
    this.orderWheel.update();
    this.updateHover();
    this.spellEffects.update(dt);
    // Les effets d'état réglés d'abord : ils décident si les particules d'état du code sont jouées.
    this.spellEffects.targets.update(dt, this.players, this.self?.state.team ?? null);
    this.spellEffects.statuses.update(dt, this.players.values(), this.self?.state.team ?? null);
    // Marques, objets et affichages 2D après les effets qui les déplacent (sinon ils suivent avec une image de retard).
    this.spellEffects.updateScenery(dt);
    // Indicateurs au-dessus des têtes, après les effets réglés (un état réglé a son propre affichage).
    for (const player of this.players.values()) this.overlay.setIndicator(player.sessionId, player.root, this.indicatorOf(player));
    if (this.self) this.village.camps.setLocalTeam(this.self.state.team);
    this.shadows?.update(this.camera.camera.target);
    this.village.update(dt, this.camera.camera, this.self ? this.self.root.position.add(VILLAGE_FOCUS_HEIGHT) : null);
    const match = this.room.state as { phase: MatchPhase; phaseTimeLeft: number; winner: number };
    // Arrivée après le choix de classe (pas d'écran de choix) : le préchargement n'a rien à attendre.
    if (match.phase && match.phase !== "classSelect") lobbyReady();
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

  // Son personnage bouge tout de suite, sans attendre le serveur (voir MovementPredictor) : en préparation et en combat,
  // vivant, hors charge (le serveur la mène seul).
  private predictSelf(dt: number) {
    const self = this.self;
    if (!self) return;
    const phase = (this.room.state as { phase: MatchPhase }).phase;
    const active =
      (phase === "preparation" || phase === "fighting") &&
      self.isAlive &&
      !self.state.charging &&
      !this.isSpectating &&
      this.loading.progress >= 1;
    const target = this.targetId && this.targetId !== this.room.sessionId ? this.players.get(this.targetId) : undefined;
    const zone = START_ZONES[self.state.team];
    const root = self.root;
    self.predicted = this.predictor.update(
      dt,
      self.state,
      {
        target: target ? target.state : null,
        targetVelocity: this.targetVelocity.update(
          target ? target.sessionId : null,
          target ? target.state : null,
          (this.room.state as { time: number }).time,
        ),
        targetAlive: !!target?.isAlive,
        confine: phase === "preparation" && zone ? (pos) => confineToZone(pos, zone) : null,
      },
      active,
      { x: root.position.x, z: root.position.z, facing: root.rotation.y },
    );
    // Reprise (fin de charge…) : les touches tenues sont renvoyées pour être prédites.
    if (this.predictor.takeRestart()) this.sendMove();
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
    const nameOf = (id: string) => this.players.get(id)?.state.name ?? "";

    const selfFrame: SelfFrame | null = self
      ? {
          ...unitFrame(self.state, nameOf),
          classId: self.state.classId as ClassId,
          mana: Math.floor(self.state.mana),
          maxMana: self.state.maxMana,
          endurance: Math.floor(self.state.endurance),
          maxEndurance: self.state.maxEndurance,
          attacking: self.state.attacking,
          lock: self.state.lock,
          song: self.state.song,
          queuedAbility: self.state.queuedAbility,
          // Le combo ne part que sur la cible de son ouverture.
          comboAbility: target && self.state.comboTarget === target.sessionId ? self.state.comboAbility : "",
          charging: self.state.charging,
        }
      : null;
    const targetFrame: TargetFrame | null =
      self && target
        ? {
            ...unitFrame(target.state, nameOf),
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
          effects: sortAfflictionsFirst(effectFrames(p.state, nameOf, true)),
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
            id: p.sessionId,
            name: p.state.name,
            classId: p.state.classId as ClassId | "",
            isSelf: p === self,
            isBot: p.state.isBot,
            leader: p.state.leader,
          }))
          // Soi-même, puis les autres joueurs, puis les bots.
          .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || Number(a.isBot) - Number(b.isBot))
      : [];

    // Écran de chargement : tous les joueurs de la partie (le serveur les envoie tous, sans leur classe). Le sien est
    // pris du suivi local, plus à jour.
    const loadingState = (this.room.state as { loading?: Map<string, { name: string; team: number; isBot: boolean; progress: number }> })
      .loading;
    const loading: LoadingFrame[] = loadingState
      ? [...loadingState.entries()].map(([id, entry]) => ({
          id,
          name: entry.name,
          team: entry.team,
          isBot: entry.isBot,
          isSelf: id === this.room.sessionId,
          progress: id === this.room.sessionId ? this.sentLoadPercent : entry.progress,
        }))
      : [];
    const loaded = this.loading.progress >= 1;

    // On ne prévient React que si quelque chose a réellement changé.
    const snapshot = JSON.stringify([selfFrame, targetFrame, group, matchFrame, teammates, loading, loaded]);
    if (snapshot === this.lastHudSnapshot) return;
    this.lastHudSnapshot = snapshot;
    const hud = useHudStore.getState();
    hud.setFrames(selfFrame, targetFrame, group);
    hud.setMatch(matchFrame, teammates);
    hud.setLoading(loading, loaded);
  }
}

// Sons des pistes de compétence réglées (animationTuning.json), à charger avant la partie.
function soundRecipes(tuning: unknown): Set<string> {
  const recipes = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const item = value as { type?: unknown; recipe?: unknown };
      if (item.type === "sound" && typeof item.recipe === "string") recipes.add(item.recipe);
      Object.values(value).forEach(visit);
    }
  };
  visit(tuning);
  return recipes;
}

function unitFrame(state: PlayerView, nameOf: (id: string) => string) {
  return {
    name: state.name,
    className: state.classId ? className(state.classId) : "",
    hp: state.hp,
    maxHp: state.maxHp,
    cast: castFrame(state),
    effects: effectFrames(state, nameOf),
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
    abilityName: abilityName(state.castAbility),
    progress: Math.min(1, state.castElapsed / state.castDuration),
  };
}

// Durée restante à la seconde, au dixième dans les dernières secondes (compte à rebours) : le HUD n'est pas redessiné
// à chaque rafraîchissement. coarse : toujours à la seconde (fenêtre de groupe, sans chiffre).
const FINE_COUNTDOWN = 3;
function roundRemaining(remaining: number, coarse: boolean): number {
  if (coarse || remaining >= FINE_COUNTDOWN) return Math.ceil(remaining);
  return Math.max(0.1, Math.ceil(remaining * 10) / 10);
}

function effectFrames(state: PlayerView, nameOf: (id: string) => string, coarse = false): EffectFrame[] {
  return [...state.effects].map((e) => ({
    kind: e.kind as EffectKind,
    remaining: e.remaining === PERMANENT ? null : roundRemaining(e.remaining, coarse),
    duration: e.remaining === PERMANENT || !(e.duration > 0) ? null : e.duration,
    sourceId: e.source,
    source: nameOf(e.source),
  }));
}
