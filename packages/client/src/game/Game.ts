import "@babylonjs/core/Culling/ray"; // Effet de bord : active scene.pick() pour le ciblage au clic.
import { Engine } from "@babylonjs/core/Engines/engine";
import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateDashedLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
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
  facingTowards,
  isMagic,
  isOffensive,
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
  type KillEvent,
  type MatchSummary,
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
import { WorldOverlay, type StatusIndicator, type TargetMark } from "./WorldOverlay";
import { createGround, createLights, createSky } from "./environment";
import { COMMON_SOUND_CHOICES, audio } from "../audio/AudioManager";
import { Nature } from "./nature";
import { Shadows } from "./shadows";
import { Village } from "./village";
import { FogOfWar, type FogWatcher } from "./FogOfWar";
import { SpellEffects } from "./SpellEffects";
import { GameAudio } from "./GameAudio";
import { PROJECTILE_TRAVEL_TIME, isProjectile } from "./spellFx";
import { errorText } from "../abilityBar";
import { abilityName, className, effectLabel, t, type TextKey } from "../i18n";
import { KeyboardInput, type KeyAction } from "./KeyboardInput";
import { OrderWheel } from "./OrderWheel";
import { DOT_STRENGTH, HitGlow, hitDirection, hitStrength } from "./HitGlow";
import { TargetPointer, edgePoint } from "./TargetPointer";
import { MAGNET_RADIUS, bestCandidate, rankEnemies, type EnemyCandidate, type EnemyRanking, type TargetCandidate } from "./targeting";
import { CharacterAssets } from "./characterAssets";
import { LoadingTracker } from "./loading";
import { lobbyReady, waitForLobby } from "./lobbyPriority";
import { MovementPredictor, VelocityTracker } from "./prediction";
import { TUNING } from "./tuning";
import { MUSIC } from "./commonSounds";
import { campOf } from "./gameAppearances";
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
// Anneau de la cible : rouge pour un ennemi, vert pour un allié (décidé le 2026-11-20), gris quand un obstacle la cache ;
// pointillé de ligne de vue, à mi-jambe.
const TARGET_MARKER_COLOR = new Color3(1, 0.2, 0.2);
const TARGET_MARKER_ALLY = new Color3(0.3, 0.95, 0.4);
const SELF_MARKER_COLOR = new Color3(1, 0.8, 0.3);
const TARGET_MARKER_BLOCKED = new Color3(0.45, 0.45, 0.45);
const SIGHT_LINE_COLOR = new Color3(1, 0.25, 0.25);
const SIGHT_LINE_ALLY = new Color3(0.3, 0.95, 0.4);
const SIGHT_LINE_HEIGHT = new Vector3(0, 0.5, 0);
// Cadrage de combat (décidé le 2026-11-19) : avec un ennemi visé à moins de FRAMING_RANGE mètres, la caméra vise un
// point décalé du joueur vers lui (FRAMING_SHARE de l'écart, FRAMING_MAX_OFFSET mètres au plus), pour garder les deux
// à l'écran ; le décalage s'installe et disparaît en douceur (FRAMING_RATE).
const FRAMING_RANGE = 30;
const FRAMING_SHARE = 0.35;
const FRAMING_MAX_OFFSET = 8;
const FRAMING_RATE = 3;
const FRAMING_FADE = 6;

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
  // Dernière commande de déplacement envoyée.
  private sentInput: MoveInput = NO_INPUT;
  // Ennemi visé au lancement de l'incantation en cours (mode moderne : le personnage lui fait face).
  private castTargetId: string | null = null;
  // Mode moderne : caméra placée une fois dans le dos du personnage (voir updateCamera).
  private cameraPlaced = false;
  // Changement de mode de déplacement en pleine partie : la commande est renvoyée aussitôt.
  private unsubscribeMovementMode = useHudStore.subscribe((state, previous) => {
    if (state.movementMode !== previous.movementMode && !this.isSpectating) this.sendMove();
  });
  private lastMoveSent = 0;
  // Point suivi par la caméra en mode spectateur (null quand on suit son personnage).
  private spectatorFocus: Vector3 | null = null;
  private players = new Map<string, PlayerVisual>();
  private characterAssets: CharacterAssets;
  private targetId: string | null = null;
  // Cible ennemie vivante à l'image précédente : sa mort déclenche un nouveau ciblage (voir retargetAfterDeath).
  private aliveEnemyTarget: string | null = null;
  private targetMarker!: Mesh;
  // Anneau doré permanent sous son propre personnage (pour le repérer dans la mêlée).
  private selfMarker!: Mesh;
  private targetMarkerMaterial!: StandardMaterial;
  // Cible cachée par un obstacle : pointillé (rouge ou vert) du joueur à la cible (voir updateTargetMarker).
  private sightLine: LinesMesh | null = null;
  private sightLineDashes = 0;
  // Flèche au bord de l'écran vers la cible hors champ.
  private targetPointer: TargetPointer;
  private hitGlow: HitGlow;
  // Cadrage de combat : décalage actuel du point visé par la caméra par rapport au joueur.
  private framingOffset = new Vector3();
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
    this.targetPointer = new TargetPointer(overlayElement);
    this.hitGlow = new HitGlow(overlayElement);
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
          // Avec les sons communs remplacés (annonce d'élimination…), pour qu'ils partent à l'heure dès la première fois.
          () => audio.preloadGame(new Set([...soundRecipes(TUNING), ...Object.values(COMMON_SOUND_CHOICES).map((c) => c.recipe).filter(Boolean)]), [MUSIC.match], track),
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
      roll: () => this.handleAction("roll"),
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
    this.unsubscribeMovementMode();
    this.targetPointer.dispose();
    this.hitGlow.dispose();
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

  // Envoie la commande de déplacement (voir moveInput).
  private sendMove() {
    // Tant que le jeu charge (écran de chargement), le joueur ne voit pas son personnage : pas de commandes.
    if (this.loading.progress < 1) return;
    const input = this.moveInput();
    this.sentInput = input;
    this.sentYaw = input.yaw ?? this.camera.yaw;
    this.lastMoveSent = performance.now();
    const message = { ...input, seq: this.predictor.send(input) };
    if (DEV_INPUT_LAG > 0) setTimeout(() => this.room.send("input", message), DEV_INPUT_LAG);
    else this.room.send("input", message);
  }

  private get modernMovement(): boolean {
    return useHudStore.getState().movementMode === "modern";
  }

  // Commande de déplacement.
  // - Mode classique (DAoC) : touches de déplacement, plus l'état du clic droit : maintenu, le personnage s'oriente
  //   comme la caméra.
  // - Mode moderne : les touches font courir dans les directions de l'écran (haut, bas, gauche, droite et diagonales,
  //   à pleine vitesse), le personnage tourné dans le sens de sa course ; la caméra ne le suit plus dans son dos (clic
  //   droit pour la tourner). À l'arrêt, pendant une incantation ou une attaque, il fait face à sa cible ennemie.
  //   Le serveur ne connaît que le mode classique : on lui envoie « avancer, orienté dans telle direction ».
  private moveInput(): MoveInput {
    if (!this.modernMovement) return { ...this.moveKeys, steer: this.camera.steering, yaw: this.camera.yaw };
    const dir = inputToDirection({ ...this.moveKeys, yaw: this.camera.yaw });
    if (dir.x !== 0 || dir.z !== 0) return { ...NO_INPUT, up: true, steer: true, yaw: Math.atan2(dir.x, dir.z) };
    const self = this.self;
    if (!self) return NO_INPUT;
    // En incantation : la cible du début du sort ; en attaque : la cible actuelle.
    const casting = self.state.castAbility !== "";
    const targetId = casting ? this.castTargetId : self.state.attacking ? this.targetId : null;
    const target = targetId ? this.players.get(targetId) : undefined;
    if (target?.isAlive && target.state.team !== self.state.team) {
      return { ...NO_INPUT, steer: true, yaw: facingTowards(self.state, target.state) };
    }
    return NO_INPUT;
  }

  // Mode moderne : la commande change sans que le joueur touche au clavier (caméra tournée pendant la course, cible
  // qui se déplace, attaque lancée) : on la renvoie, sans dépasser une commande toutes les YAW_RESEND_MS.
  private resendMoveIfChanged() {
    const next = this.moveInput();
    const sent = this.sentInput;
    const sameKeys = next.up === sent.up && next.down === sent.down && next.left === sent.left && next.right === sent.right && !!next.steer === !!sent.steer;
    if (!sameKeys) return this.sendMove();
    const yaw = next.yaw ?? this.sentYaw;
    const turned = Math.abs(Math.atan2(Math.sin(yaw - this.sentYaw), Math.cos(yaw - this.sentYaw)));
    if (next.steer && turned > YAW_RESEND_THRESHOLD && performance.now() - this.lastMoveSent > YAW_RESEND_MS) this.sendMove();
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
      this.camera.follow(self.root.position.add(this.updateFraming(self, dt)));
      if (this.modernMovement) {
        // La caméra ne suit pas l'orientation : on la place une fois dans le dos du personnage à son apparition
        // (tourné vers le centre de l'arène, pour les deux équipes).
        if (!this.cameraPlaced) this.camera.faceTowards(self.root.rotation.y);
        this.cameraPlaced = true;
        this.resendMoveIfChanged();
        return;
      }
      // Clic droit : la souris oriente la caméra et le personnage suit. Sinon, la caméra se place dans son dos.
      if (this.camera.steering) this.resendMoveIfCameraTurned();
      else this.camera.followFacing(self.root.rotation.y, dt);
      return;
    }
    // Le cadrage de combat ne sert plus : le point libre part de là où regardait la caméra (pas de saut), et le
    // décalage est oublié (pas de retour vers l'ancienne cible à la résurrection).
    if (!this.spectatorFocus) {
      this.spectatorFocus = this.camera.camera.target.clone();
      this.framingOffset.setAll(0);
    }
    const dir = inputToDirection({ ...this.moveKeys, yaw: this.camera.yaw });
    const limit = ARENA_SIZE / 2;
    this.spectatorFocus.x = Math.max(-limit, Math.min(limit, this.spectatorFocus.x + dir.x * SPECTATOR_SPEED * dt));
    this.spectatorFocus.z = Math.max(-limit, Math.min(limit, this.spectatorFocus.z + dir.z * SPECTATOR_SPEED * dt));
    this.spectatorFocus.y = terrainHeight(this.spectatorFocus.x, this.spectatorFocus.z);
    this.camera.follow(this.spectatorFocus);
  }

  // Cadrage de combat : décalage vers l'ennemi visé proche (voir FRAMING_*), lissé.
  private updateFraming(self: PlayerVisual, dt: number): Vector3 {
    const target = this.targetId ? this.players.get(this.targetId) : undefined;
    const goal = new Vector3();
    if (target && target.isAlive && target.root.isEnabled() && target.state.team !== self.state.team) {
      const dx = target.root.position.x - self.root.position.x;
      const dz = target.root.position.z - self.root.position.z;
      const length = Math.hypot(dx, dz);
      if (length <= FRAMING_RANGE && length > 0) {
        // Le décalage s'efface progressivement sur les 6 derniers mètres, pour ne pas sauter à la limite.
        const fade = Math.min(1, (FRAMING_RANGE - length) / FRAMING_FADE);
        const offset = Math.min(length * FRAMING_SHARE, FRAMING_MAX_OFFSET) * fade;
        goal.set((dx / length) * offset, 0, (dz / length) * offset);
      }
    }
    this.framingOffset.addInPlace(goal.subtract(this.framingOffset).scale(1 - Math.exp(-FRAMING_RATE * dt)));
    return this.framingOffset;
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

  // Anneau (rouge, vert ou gris) affiché sous la cible actuelle.
  private createTargetMarker() {
    this.targetMarker = CreateTorus("targetMarker", { diameter: 1.9, thickness: 0.16, tessellation: 48 }, this.scene);
    const material = new StandardMaterial("targetMarkerMat", this.scene);
    material.emissiveColor = TARGET_MARKER_COLOR;
    material.disableLighting = true;
    this.targetMarker.material = material;
    this.targetMarkerMaterial = material;

    this.selfMarker = CreateTorus("selfMarker", { diameter: 1.5, thickness: 0.16, tessellation: 48 }, this.scene);
    const selfMaterial = new StandardMaterial("selfMarkerMat", this.scene);
    selfMaterial.emissiveColor = SELF_MARKER_COLOR;
    selfMaterial.disableLighting = true;
    this.selfMarker.material = selfMaterial;
    this.selfMarker.isPickable = false;
    this.selfMarker.setEnabled(false);
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

  // Coup reçu : lueur rouge au bord de l'écran, du côté de l'attaquant pour un coup de mêlée qu'on voit venir, tout
  // autour sinon (sort, dégât sur la durée, attaquant caché) ; un sort à projectile s'allume à son arrivée.
  private showHitGlow(event: CombatEvent) {
    const self = this.self;
    if (!self || !event.amount) return;
    const source = event.melee ? this.players.get(event.sourceId) : undefined;
    const relative = source && source !== self ? hitDirection(source.root.position.subtract(self.root.position), this.camera.yaw) : null;
    const delay = isProjectile(event.abilityId) && event.sourceId !== event.targetId ? PROJECTILE_TRAVEL_TIME : 0;
    this.hitGlow.hit(relative, event.dot ? DOT_STRENGTH : hitStrength(event.amount, self.state.maxHp), delay * 1000);
  }

  private bindMessages() {
    const hud = useHudStore.getState();
    this.room.onMessage("combat", (event: CombatEvent) => {
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
      if (event.kind === "damage" && event.targetId === this.room.sessionId) this.showHitGlow(event);
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
    this.room.onMessage("kill", (event: KillEvent) => {
      const myTeam = this.self?.state.team;
      if (myTeam === undefined) return;
      hud.addKill({
        victimName: event.victimName,
        victimAlly: event.victimTeam === myTeam,
        victimClass: event.victimClass,
        killerName: event.killerName,
        killerAlly: event.killerTeam === myTeam,
        abilityId: event.abilityId,
        ...(event.lastStanding && { lastStanding: { name: event.lastStanding, ally: event.victimTeam === myTeam } }),
      });
    });
    this.room.onMessage("summary", (summary: MatchSummary) => hud.setSummary({ ...summary, selfId: this.room.sessionId }));
    this.room.onMessage("interrupt", (event: InterruptEvent) => {
      const caster = this.players.get(event.casterId);
      if (caster) this.overlay.addText(caster.root, t("float.interrupted"), "info");
      caster?.interruptCast();
    });
    this.room.onMessage("ability", (event: AbilityUsedEvent) => {
      this.players.get(event.casterId)?.playAbility(event.abilityId);
      // L'Arcaniste lance sa bulle : elle se montre un instant.
      if (event.abilityId === "bubble") this.spellEffects.statuses.bubbleWasApplied(event.casterId);
      const casterPlayer = this.players.get(event.casterId);
      const targetPlayer = this.players.get(event.targetId);
      const myTeam = this.self?.state.team;
      // Repère des sorts ennemis : leurs zones, et leurs sorts (pas les coups de mêlée) qui atteignent un allié.
      const enemyCaster = !!casterPlayer && myTeam !== undefined && casterPlayer.state.team !== myTeam;
      const ability = getAbility(event.abilityId);
      const mark = {
        // Seules les zones offensives : un Soin de groupe ou un Cri de ralliement ennemi ne menace personne.
        enemyZone: enemyCaster && !!ability && isOffensive(ability),
        enemyHit: enemyCaster && !!ability && isMagic(ability) && targetPlayer?.state.team === myTeam,
      };
      this.spellEffects.play(event.abilityId, casterPlayer?.root, targetPlayer?.root, undefined, mark);
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
      case "roll":
        this.room.send("roll");
        break;
      case "toggleAttack":
        this.steerTowardsTarget();
        this.room.send("toggleAttack");
        this.restoreModernMove();
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
    const ability = getAbility(abilityId);
    if (ability?.target === "enemy") this.steerTowardsTarget();
    // Mode moderne : le personnage fera face à cette cible pendant toute l'incantation, même après un Tab (le serveur
    // vérifie à la fin qu'il fait face à la cible du début). Pas pour un sort sur un allié.
    if (ability && ability.castTime > 0) this.castTargetId = ability.target === "enemy" ? this.targetId : null;
    this.room.send("cast", { abilityId });
    this.restoreModernMove();
  }

  // Mode moderne : le serveur vient de tourner le personnage vers l'ennemi visé, et avec lui la direction de course
  // (une commande « steer » impose l'orientation). On renvoie aussitôt la commande : la compétence instantanée est
  // déjà partie face à l'ennemi, et le personnage reprend sa course (on peut ainsi tirer en fuyant).
  private restoreModernMove() {
    if (this.modernMovement && !this.isSpectating) this.sendMove();
  }

  // Le serveur tourne le personnage vers l'ennemi visé (compétence ou attaque). Clic droit tenu, c'est la caméra qui
  // oriente le personnage : on la tourne d'abord vers la cible, sinon elle le ramènerait aussitôt dans l'autre sens.
  private steerTowardsTarget() {
    const self = this.self;
    const target = this.targetId ? this.players.get(this.targetId) : undefined;
    // Mode moderne : moveInput tourne déjà le personnage vers sa cible pendant l'incantation ou l'attaque.
    if (this.modernMovement || !this.camera.steering || !self || !target?.isAlive || target.state.team === self.state.team) return;
    if (isFacing(self.state, target.state)) return;
    this.camera.faceTowards(facingTowards(self.state, target.state));
    this.sendMove();
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
    if (!best) return;
    this.setTarget(best);
    // La première fois, en combat : comment choisir soi-même sa cible.
    if ((this.room.state as { phase: MatchPhase }).phase === "fighting") useHudStore.getState().showHint("autoTarget", t("hint.autoTarget"));
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

  private renderFrame() {
    const dt = this.engine.getDeltaTime() / 1000;
    // Lissage exponentiel : on rattrape la position reçue du serveur sans à-coups,
    // le serveur n'envoyant que 20 mises à jour par seconde.
    const smoothing = 1 - Math.exp(-SMOOTHING * dt);
    this.predictSelf(dt);
    const currentTarget = this.targetId ? this.players.get(this.targetId) : undefined;
    const targetBlocked = this.targetBlocked(this.self, currentTarget);
    const campSwap = (this.room.state as { campSwap: boolean }).campSwap;
    for (const player of this.players.values()) {
      player.update(smoothing, campSwap, this.self?.state.team ?? null);
      const enemy = !!this.self && player.state.team !== this.self.state.team;
      const classId = player.state.classId as ClassId | "";
      // Un allié se reconnaît à son pseudo, un ennemi à sa classe.
      const label = enemy ? (classId ? className(classId) : "") : player.state.name;
      const side = enemy ? "enemy" : player === this.self ? "self" : "ally";
      this.overlay.setBadge(player.sessionId, player.root, classId, label, side, player.isAlive, player.sessionId === this.targetId ? this.targetMark(player, targetBlocked) : null);
      // Incantation d'un ennemi, sous son nom (la sienne et celle d'un allié se lisent dans les cadres).
      const casting = enemy && player.isAlive ? player.state.castAbility : "";
      this.overlay.setCast(player.sessionId, player.root, casting, player.state.castElapsed, player.state.castDuration);
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
    this.selfMarker.setEnabled(!!self && self.isAlive);
    // Assez haut pour ne pas s'enfoncer dans le sol (épaisseur 0,16 m).
    if (self) this.selfMarker.position.set(self.root.position.x, self.root.position.y + 0.08, self.root.position.z);
    this.updateTargetMarker(self, target, targetBlocked);
    this.updateTargetPointer(self, target);

    this.refreshHud(self, target);
    this.scene.render();
  }

  // Marque de la cible au-dessus de son pseudo (même couleur que son anneau).
  // Se cibler soi-même : pas de chevron de cible, le chevron doré du joueur reste.
  private targetMark(target: PlayerVisual, blocked: boolean): TargetMark | null {
    const self = this.self;
    if (target === self) return null;
    if (blocked) return "blocked";
    return self && target.state.team !== self.state.team ? "enemy" : "ally";
  }

  // Ligne de vue coupée entre le joueur (vivant) et sa cible (vivante) : calculée une fois par image.
  private targetBlocked(self: PlayerVisual | undefined, target: PlayerVisual | undefined): boolean {
    return (
      !!self &&
      self.isAlive &&
      !!target &&
      target !== self &&
      target.isAlive &&
      target.root.isEnabled() &&
      !hasLineOfSight(self.state, target.state)
    );
  }

  // Anneau sous la cible ; si un obstacle la cache (ligne de vue coupée), l'anneau passe en gris et un pointillé
  // la relie au joueur : il voit pourquoi ses sorts refusent et qu'il doit contourner (décidé le 2026-11-19).
  private updateTargetMarker(self: PlayerVisual | undefined, target: PlayerVisual | undefined, blocked: boolean) {
    this.targetMarker.setEnabled(!!target);
    if (target) this.targetMarker.position.set(target.root.position.x, target.root.position.y + 0.06, target.root.position.z);
    const enemy = !!self && !!target && target.state.team !== self.state.team;
    this.targetMarkerMaterial.emissiveColor = blocked ? TARGET_MARKER_BLOCKED : enemy ? TARGET_MARKER_COLOR : TARGET_MARKER_ALLY;
    if (!blocked) {
      this.sightLine?.setEnabled(false);
      return;
    }
    const points = [self!.root.position.add(SIGHT_LINE_HEIGHT), target!.root.position.add(SIGHT_LINE_HEIGHT)];
    // Un tiret tous les 0,8 m environ, arrondi par paliers de 5 : le maillage n'est recréé que de loin en loin.
    const dashNb = Math.max(5, Math.round(Vector3.Distance(points[0], points[1]) / 4) * 5);
    // Le nombre de tirets fixe la taille du maillage : on le recrée quand il change, sinon on le met à jour.
    if (this.sightLine && this.sightLineDashes === dashNb) {
      CreateDashedLines("sightLine", { points, dashNb, instance: this.sightLine });
    } else {
      this.sightLine?.dispose();
      this.sightLine = CreateDashedLines("sightLine", { points, dashNb, dashSize: 3, gapSize: 2, updatable: true }, this.scene);
      this.sightLine.isPickable = false;
      // Mis à jour sans recalculer son volume englobant : toujours dessiné (sinon éliminé hors de sa place d'origine).
      this.sightLine.alwaysSelectAsActiveMesh = true;
      this.sightLineDashes = dashNb;
    }
    // Rouge pour un ennemi, vert pour un allié (comme l'anneau et la flèche au bord de l'écran).
    this.sightLine.color = target!.state.team !== self!.state.team ? SIGHT_LINE_COLOR : SIGHT_LINE_ALLY;
    this.sightLine.setEnabled(true);
  }

  // Cible hors champ : flèche au bord de l'écran dans sa direction, avec sa distance.
  private updateTargetPointer(self: PlayerVisual | undefined, target: PlayerVisual | undefined) {
    const camera = this.scene.activeCamera;
    if (!self || !self.isAlive || !target || target === self || !target.root.isEnabled() || !camera) {
      this.targetPointer.update(null, false, 0);
      return;
    }
    // La caméra vient de bouger (follow) : matrices de cette image, pas de la précédente.
    this.scene.updateTransformMatrix(true);
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const projected = Vector3.Project(
      target.root.position.add(BODY_CENTER),
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(width, height),
    );
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    const point = edgePoint(
      (projected.x * cssWidth) / width,
      (projected.y * cssHeight) / height,
      projected.z < 0 || projected.z > 1,
      cssWidth,
      cssHeight,
    );
    this.targetPointer.update(point, target.state.team !== self.state.team, distance(self.state, target.state));
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
      !self.state.rolling &&
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
          rolling: self.state.rolling,
          rooted: self.hasEffect("root") || self.hasEffect("halted"),
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
      campSwap: boolean;
      alive0: number;
      alive1: number;
      teamSize: number;
    };
    const myTeam = self?.state.team ?? 0;
    const matchFrame: MatchFrame = {
      phase: state.phase,
      timeLeft: Math.ceil(state.phaseTimeLeft),
      playerCount: state.playerCount,
      matchSize: state.matchSize,
      team: myTeam,
      alliesAlive: myTeam === 0 ? state.alive0 : state.alive1,
      enemiesAlive: myTeam === 0 ? state.alive1 : state.alive0,
      teamSize: state.teamSize,
      camp: campOf(myTeam, state.campSwap),
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
