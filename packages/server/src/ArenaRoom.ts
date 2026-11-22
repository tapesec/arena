import { CloseCode, Room, type AuthContext, type Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import {
  CLASS_LIST,
  FULL_LOBBY_COUNTDOWN,
  LOADING_DURATION,
  LOBBY_DURATION,
  MATCH_SIZE,
  PREPARATION_DURATION,
  START_ZONES,
  TICK_RATE,
  cleanName,
  confineToZone,
  getClass,
  maxResource,
  spawnPosition,
  type ClassId,
  heroScore,
  type MatchSummary,
  type MatchPhase,
  type MoveInput,
  NO_INPUT,
  isOrderId,
} from "@arena/shared";
import { BotBrain } from "./bots/BotBrain";
import { createBotBrain } from "./bots/classBots";
import { dispatchOrder, followHumansAtStart } from "./bots/orders";
import { botToReplace, initialBotClasses, pickBotClass } from "./bots/composition";
import { Pathfinder } from "./bots/Pathfinder";
import { CombatSystem } from "./CombatSystem";
import { PlayerRuntime } from "./PlayerRuntime";
import { ArenaState, LoadingState, PlayerState } from "./state";
import { claimName, nameKey, randomName } from "./names";
import { computeTeamVisibility } from "./visibility";
import { envNumber } from "./settings";
import { ACTIVE_PLAYER_ACTIONS, ActionCounter, type RenderPerf, browserFamily, sanitizePerf, telemetry, trackRoom, untrackRoom } from "./telemetry";

const IS_DEV = process.env.NODE_ENV !== "production";

// Nombre de joueurs d'une partie (humains et bots), réductible pour tester (MATCH_SIZE=4).
const MATCH_PLAYERS = envNumber("MATCH_SIZE", MATCH_SIZE);
const TEAM_SIZE = Math.max(1, Math.floor(MATCH_PLAYERS / 2));

// Durées des phases, réductibles pour tester (en secondes).
const LOBBY_SECONDS = envNumber("LOBBY_DURATION", LOBBY_DURATION);
const FULL_LOBBY_SECONDS = envNumber("FULL_LOBBY_COUNTDOWN", FULL_LOBBY_COUNTDOWN);
const PREPARATION_SECONDS = envNumber("PREPARATION_DURATION", PREPARATION_DURATION);
const LOADING_SECONDS = envNumber("LOADING_DURATION", LOADING_DURATION);
// L'écran de chargement reste affiché au moins ce temps, même si tout le monde a déjà fini en salle d'attente.
const LOADING_MIN_SECONDS = 2;

// Une partie terminée ferme la salle après ce délai si les joueurs ne sont pas partis d'eux-mêmes.
const ENDED_ROOM_LIFETIME_MS = 2 * 60 * 1000;

// Une salle = une partie. Elle s'ouvre avec deux équipes de bots ; chaque joueur qui arrive prend la place d'un bot de
// l'équipe qui a le moins de joueurs, et choisit sa classe. La salle se verrouille au lancement : les suivants
// ouvrent une nouvelle partie. C'est la file d'attente.
export class ArenaRoom extends Room<{ state: ArenaState }> {
  maxClients = TEAM_SIZE * 2;
  state = new ArenaState();

  private combat = new CombatSystem({
    broadcast: (type, message, involved) => this.broadcastToWitnesses(type, message, involved),
    sendTo: (playerId, type, message) => this.clients.getById(playerId)?.send(type, message),
    announce: (type, message) => this.broadcast(type, message),
  });

  // Joueurs visibles par chaque équipe, recalculés à chaque tick.
  private teamVisibility = new Map<number, Set<string>>();

  messages = {
    input: (client: Client, message: unknown) => {
      const seq = (message as { seq?: unknown } | null)?.seq;
      const validSeq = typeof seq === "number" && Number.isInteger(seq) && seq >= 0 && seq <= 0xffffffff ? seq : undefined;
      const input = sanitizeInput(message);
      if (this.inMatch) this.actions.move(client.sessionId, input);
      this.combat.setInput(client.sessionId, input, validSeq);
    },
    target: (client: Client, message: unknown) => {
      const targetId = (message as { targetId?: unknown } | null)?.targetId;
      if (typeof targetId === "string") this.countAction(client.sessionId);
      this.combat.setTarget(client.sessionId, typeof targetId === "string" ? targetId : null);
    },
    toggleAttack: (client: Client) => {
      this.countAction(client.sessionId);
      this.combat.toggleAttack(client.sessionId);
    },
    faceLock: (client: Client) => this.combat.lockOnTarget(client.sessionId, "face"),
    stick: (client: Client) => this.combat.lockOnTarget(client.sessionId, "stick"),
    // Ordre aux bots de son équipe (roue de la molette) : pendant le combat, même sous contrôle, pas mort.
    order: (client: Client, message: unknown) => {
      const order = (message as { order?: unknown } | null)?.order;
      const issuer = this.combat.players.get(client.sessionId);
      if (!isOrderId(order) || this.phase !== "fighting" || !issuer?.alive) return;
      this.countAction(client.sessionId);
      const visible = this.teamVisibility.get(issuer.state.team) ?? new Set<string>();
      for (const reply of dispatchOrder(order, issuer, this.bots, this.combat.players, visible)) client.send("botReply", reply);
    },
    cast: (client: Client, message: unknown) => {
      const abilityId = (message as { abilityId?: unknown } | null)?.abilityId;
      if (typeof abilityId !== "string") return;
      this.countAction(client.sessionId);
      this.combat.useAbility(client.sessionId, abilityId);
    },
    // Avancement du chargement du client, en pourcentage. Retenu dès la salle d'attente : le client commence à
    // charger en y arrivant.
    loadProgress: (client: Client, message: unknown) => {
      const progress = (message as { progress?: unknown } | null)?.progress;
      if (typeof progress !== "number" || !Number.isFinite(progress)) return;
      const percent = Math.max(0, Math.min(100, Math.floor(progress)));
      this.loadProgress.set(client.sessionId, percent);
      const entry = this.state.loading.get(client.sessionId);
      if (entry) entry.progress = percent;
    },
    selectClass: (client: Client, message: unknown) => {
      const classId = (message as { classId?: unknown } | null)?.classId;
      const classDef = typeof classId === "string" ? getClass(classId) : undefined;
      const player = this.state.players.get(client.sessionId);
      if (this.phase !== "classSelect" || !classDef || !player) return;
      player.classId = classDef.id;
    },
    // Le chef d'équipe change la classe d'un bot de son équipe.
    setBotClass: (client: Client, message: unknown) => {
      const { botId, classId } = (message ?? {}) as { botId?: unknown; classId?: unknown };
      const leader = this.state.players.get(client.sessionId);
      const bot = typeof botId === "string" ? this.state.players.get(botId) : undefined;
      const classDef = typeof classId === "string" ? getClass(classId) : undefined;
      if (this.phase !== "classSelect" || !leader?.leader || !bot?.isBot || bot.team !== leader.team || !classDef) return;
      bot.classId = classDef.id;
    },
    // Images/s et résolution du client (télémétrie), pendant la partie : le dernier envoi est joint au résultat.
    perf: (client: Client, message: unknown) => {
      const perf = sanitizePerf(message);
      if (perf && this.inMatch) this.perf.set(client.sessionId, perf);
    },
    // En développement : lancer la partie sans attendre la fin du compte à rebours.
    forceStart: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (IS_DEV && this.phase === "classSelect" && player?.leader) this.startLoading();
    },
  };

  // Les bots n'ont pas de connexion : ils n'existent que dans l'état et le système de combat.
  private pathfinder = new Pathfinder();
  private bots: BotBrain[] = [];
  private botCount = 0;
  // La salle a déjà été pleine (compte à rebours de FULL_LOBBY_SECONDS lancé).
  private filledOnce = false;
  // Ordre d'arrivée des joueurs : le premier de chaque équipe en est le chef.
  private arrivals: string[] = [];
  // Avancement du chargement de chaque joueur, en pourcentage.
  private loadProgress = new Map<string, number>();
  // Joueurs remplacés par un bot faute d'avoir fini de charger : leur départ ne retire pas le personnage.
  private replacedByBot = new Set<string>();
  // Temps de simulation écoulé (ms), non arrondi.
  private elapsedMs = 0;
  // Début du combat (après la préparation), en temps de simulation : durée affichée sur l'écran de fin ; null avant.
  private fightStartedAt: number | null = null;

  // --- Observabilité (telemetry.ts) ---
  private actions = new ActionCounter();
  private browsers = new Map<string, { browser: string; mobile: boolean }>();
  private perf = new Map<string, RenderPerf>();
  // Début de la partie (préparation), en temps de simulation ; null tant qu'elle n'a pas commencé.
  private matchStartedAt: number | null = null;
  private humansAtStart = 0;
  private activeHumans = 0;
  // Joueurs dont le résultat est déjà enregistré (départ, remplacement par un bot).
  private reported = new Set<string>();
  // Récap de l'écran de fin : bilan de chaque joueur encore dans la partie, et le héros de l'équipe gagnante.
  private summary(winner: number): MatchSummary {
    const players = [...this.combat.players.values()].map((p) => ({
      id: p.id,
      name: p.state.name,
      team: p.state.team,
      classId: p.state.classId,
      alive: p.alive,
      ...p.stats,
    }));
    const hero = players.filter((p) => p.team === winner).sort((a, b) => heroScore(b) - heroScore(a))[0];
    return {
      seconds: this.fightStartedAt === null ? 0 : Math.round((this.elapsedMs - this.fightStartedAt) / 1000),
      players,
      heroId: hero?.id ?? null,
    };
  }

  // Arrêt du serveur (déploiement) : les départs qui suivent ne sont pas des abandons.
  private shuttingDown = false;

  private addBot(team: number, classId: ClassId): string {
    const player = new PlayerState();
    player.colorIndex = this.nextColorIndex();
    player.name = this.freshName();
    player.isBot = true;
    player.team = team;
    player.classId = classId;
    const id = `bot-${++this.botCount}`;
    this.state.players.set(id, player);
    return id;
  }

  private humans(team?: number): number {
    let count = 0;
    this.state.players.forEach((p) => (count += !p.isBot && (team === undefined || p.team === team) ? 1 : 0));
    return count;
  }

  // Le premier joueur arrivé dans chaque équipe (encore présent) en est le chef.
  private updateLeaders() {
    const leaders = new Set<string>();
    const teamsWithLeader = new Set<number>();
    for (const id of this.arrivals) {
      const team = this.state.players.get(id)?.team;
      if (team === undefined || teamsWithLeader.has(team)) continue;
      teamsWithLeader.add(team);
      leaders.add(id);
    }
    this.state.players.forEach((p, id) => (p.leader = leaders.has(id)));
  }

  private updateBots(dt: number) {
    for (const bot of this.bots) {
      const visible = this.teamVisibility.get(bot.player.state.team) ?? new Set<string>();
      bot.update(dt, { phase: this.phase, players: this.combat.players, visible });
    }
  }

  private get phase(): MatchPhase {
    return this.state.phase as MatchPhase;
  }

  // Préparation ou combat : les actions des joueurs comptent.
  private get inMatch(): boolean {
    return this.phase === "preparation" || this.phase === "fighting";
  }

  private countAction(id: string) {
    if (this.inMatch) this.actions.add(id);
  }

  // Résultat d'un joueur humain : à son départ, à son remplacement par un bot, ou à la fin de la partie.
  private reportPlayer(id: string, player: PlayerState, left: "parti" | "chargement" | "arret" | "fin", winner?: number) {
    if (this.matchStartedAt === null || this.reported.has(id)) return;
    this.reported.add(id);
    const actions = this.actions.get(id);
    const active = actions >= ACTIVE_PLAYER_ACTIONS;
    if (active) this.activeHumans++;
    telemetry("player_result", {
      room: this.roomId,
      class: player.classId,
      team: player.team,
      actions,
      // 1 ou 0 (et non true/false) : comparé tel quel par les filtres de métriques et Logs Insights.
      active: active ? 1 : 0,
      seconds: Math.round((this.elapsedMs - this.matchStartedAt) / 1000),
      won: left === "fin" && winner !== undefined && winner >= 0 ? Number(winner === player.team) : null,
      left,
      ...(this.browsers.get(id) ?? browserFamily(undefined)),
      // Absent si aucune mesure n'a été reçue pendant la partie (envoi toutes les 30 s, et au départ du joueur).
      ...this.perf.get(id),
    });
  }

  // Aucune authentification : seule la famille de navigateur est retenue, pour l'observabilité.
  onAuth(client: Client, _options: unknown, context: AuthContext) {
    this.browsers.set(client.sessionId, browserFamily(context.headers?.get?.("user-agent")));
    return true;
  }

  onCreate() {
    trackRoom(this.roomId, () => ({ humans: this.humans(), inMatch: this.inMatch }));
    this.state.matchSize = MATCH_PLAYERS;
    this.state.phaseTimeLeft = LOBBY_SECONDS;
    this.state.campSwap = Math.random() < 0.5;
    for (const team of [0, 1]) for (const classId of initialBotClasses(TEAM_SIZE)) this.addBot(team, classId);
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / TICK_RATE);
    this.setPatchRate(1000 / TICK_RATE);
  }

  onJoin(client: Client, options?: { name?: unknown }) {
    // L'équipe qui a le moins de joueurs ; le nouveau venu prend la place d'un de ses bots.
    const team = this.humans(0) <= this.humans(1) ? 0 : 1;
    const bots = [...this.state.players.entries()].filter(([, p]) => p.isBot && p.team === team);
    const replaced = bots[botToReplace(bots.map(([, p]) => p.classId as ClassId))];
    const player = new PlayerState();
    // Pseudo saisi à l'accueil, revérifié ici. Le bot remplacé est retiré avant : si le joueur a choisi son pseudo,
    // il le garde tel quel. Sans pseudo valide, un nom est tiré avant de retirer le bot (le joueur ne reprend pas
    // le sien).
    const wanted = cleanName(typeof options?.name === "string" ? options.name : "");
    const fallback = wanted ? "" : this.freshName();
    if (replaced) this.state.players.delete(replaced[0]);
    player.name = wanted ? claimName(wanted, [...this.state.players.values()]) : fallback;
    player.colorIndex = replaced?.[1].colorIndex ?? this.nextColorIndex();
    player.team = team;
    // Classe choisie d'office : la première de la liste (la plus à gauche sur l'écran de choix), qu'il peut changer.
    player.classId = CLASS_LIST[0].id;
    this.state.players.set(client.sessionId, player);
    this.arrivals.push(client.sessionId);
    this.updateLeaders();
    this.state.playerCount = this.humans();

    // Chaque client a sa propre vue de l'état ; il y voit ses coéquipiers (updateViews).
    client.view = new StateView();
    client.view.add(player);
    console.log(`[arena ${this.roomId}] ${player.name} a rejoint (${this.state.playerCount}/${MATCH_PLAYERS})`);
    telemetry("join", { room: this.roomId, ...(this.browsers.get(client.sessionId) ?? browserFamily(undefined)) });

    // Salle pleine : la partie part bientôt, le temps que le dernier arrivé choisisse sa classe.
    // Seulement la première fois : un joueur qui part et revient ne peut pas retarder la partie sans fin.
    if (this.state.playerCount >= this.maxClients && !this.filledOnce) {
      this.filledOnce = true;
      this.state.phaseTimeLeft = FULL_LOBBY_SECONDS;
    }
  }

  onLeave(client: Client) {
    this.loadProgress.delete(client.sessionId);
    this.arrivals = this.arrivals.filter((id) => id !== client.sessionId);
    // Remplacé par un bot (chargement trop long) : son personnage reste en jeu, joué par le bot.
    if (this.replacedByBot.delete(client.sessionId)) {
      this.browsers.delete(client.sessionId);
      this.perf.delete(client.sessionId);
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (player && !player.isBot && this.inMatch) this.reportPlayer(client.sessionId, player, this.shuttingDown ? "arret" : "parti");
    this.browsers.delete(client.sessionId);
    this.perf.delete(client.sessionId);
    this.combat.remove(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.state.loading.delete(client.sessionId);
    // Dans la salle d'attente, un bot reprend la place libérée, avec la classe qui manque le plus à l'équipe ;
    // pendant le chargement, avec la classe du joueur parti.
    if (player && this.phase === "classSelect") this.addBot(player.team, pickBotClass(this.teamClasses(player.team)));
    if (player && this.phase === "loading") this.addLoadingEntry(this.addBot(player.team, player.classId as ClassId));
    this.updateLeaders();
    this.state.playerCount = this.humans();
    console.log(`[arena ${this.roomId}] ${player?.name} est parti (${this.state.playerCount} joueurs)`);
    if (this.phase === "preparation" || this.phase === "fighting") this.checkForWinner();
  }

  private teamClasses(team: number): ClassId[] {
    const classes: ClassId[] = [];
    this.state.players.forEach((p) => {
      if (p.team === team && p.classId) classes.push(p.classId as ClassId);
    });
    return classes;
  }

  private takenNames(): Set<string> {
    const taken = new Set<string>();
    this.state.players.forEach((p) => taken.add(nameKey(p.name)));
    return taken;
  }

  private freshName(): string {
    return randomName(this.takenNames());
  }

  private update(dt: number) {
    this.elapsedMs += dt * 1000;
    this.state.time = Math.round(this.elapsedMs);
    switch (this.phase) {
      case "classSelect":
        if (this.countdown(dt)) this.startLoading();
        break;
      case "loading":
        if (this.countdown(dt) || (LOADING_SECONDS - this.state.phaseTimeLeft >= LOADING_MIN_SECONDS && this.everyoneLoaded())) {
          this.startPreparation();
        }
        break;
      case "preparation":
        this.updateBots(dt);
        this.combat.tick(dt);
        if (this.countdown(dt)) this.startFight();
        break;
      case "fighting":
        this.updateBots(dt);
        this.combat.tick(dt);
        this.checkForWinner();
        break;
    }
    this.updateViews();
  }

  // Décompte la phase en cours ; retourne vrai quand le temps est écoulé.
  private countdown(dt: number): boolean {
    this.state.phaseTimeLeft = Math.max(0, this.state.phaseTimeLeft - dt);
    return this.state.phaseTimeLeft === 0;
  }

  // --- Phases ---

  // Fin de la salle d'attente : la partie est verrouillée et chacun finit de charger le jeu.
  private startLoading() {
    // Plus personne ne peut rejoindre cette partie.
    void this.lock();
    this.state.phase = "loading";
    this.state.phaseTimeLeft = LOADING_SECONDS;
    // Filet de sécurité : chaque joueur a une classe dès son arrivée (la première de la liste, voir onJoin) ; une classe
    // invalide, qui ne devrait plus arriver, est remplacée par celle qui manque le plus à son équipe.
    this.state.players.forEach((player) => {
      if (!getClass(player.classId)) player.classId = pickBotClass(this.teamClasses(player.team));
    });
    this.state.players.forEach((_player, id) => this.addLoadingEntry(id));
  }

  private addLoadingEntry(id: string) {
    const player = this.state.players.get(id);
    if (!player) return;
    const entry = new LoadingState();
    entry.name = player.name;
    entry.team = player.team;
    entry.isBot = player.isBot;
    entry.progress = player.isBot ? 100 : (this.loadProgress.get(id) ?? 0);
    this.state.loading.set(id, entry);
  }

  private everyoneLoaded(): boolean {
    let loaded = true;
    this.state.loading.forEach((entry) => (loaded &&= entry.progress >= 100));
    return loaded;
  }

  private startPreparation() {
    this.state.phase = "preparation";
    this.state.phaseTimeLeft = PREPARATION_SECONDS;
    this.matchStartedAt = this.elapsedMs;
    this.humansAtStart = this.humans();
    telemetry("match_start", { room: this.roomId, humans: this.humansAtStart, bots: this.state.players.size - this.humansAtStart });

    const indexInTeam = [0, 0];
    const teamSizes = [0, 0];
    this.state.players.forEach((p) => teamSizes[p.team]++);
    this.state.alive0 = teamSizes[0];
    this.state.alive1 = teamSizes[1];
    this.state.teamSize = Math.max(teamSizes[0], teamSizes[1]);

    this.state.players.forEach((player, id) => {
      const classDef = getClass(player.classId)!;
      player.hp = player.maxHp = classDef.maxHp;
      if (classDef.resource === "mana") player.mana = player.maxMana = maxResource("mana");
      else player.endurance = player.maxEndurance = maxResource("endurance");

      const zone = START_ZONES[player.team];
      const spawn = spawnPosition(zone, indexInTeam[player.team]++, teamSizes[player.team]);
      player.x = spawn.x;
      player.z = spawn.z;
      // Tourné vers le centre de l'arène.
      player.facing = Math.atan2(-zone.x, -zone.z);

      const runtime = new PlayerRuntime(id, player, classDef);
      this.combat.add(runtime);
      if (player.isBot) this.bots.push(createBotBrain(runtime, this.combat, this.pathfinder));
    });

    // Pendant la préparation, chacun reste dans la zone de départ de son équipe.
    this.combat.confine = (runtime, pos) => confineToZone(pos, START_ZONES[runtime.state.team]);
  }

  private startFight() {
    this.state.phase = "fighting";
    this.state.phaseTimeLeft = 0;
    this.fightStartedAt = this.elapsedMs;
    this.combat.confine = null;
    this.replaceUnloadedPlayers();
    followHumansAtStart(this.bots, this.combat.players);
    // L'écran de chargement ne sert plus : sans filtre, il montrerait encore les pseudos adverses.
    this.state.loading.clear();
  }

  // Un joueur qui n'a toujours pas fini de charger au début du combat est remplacé par un bot : son personnage, sous
  // un nom de bot, est joué par le serveur, et le joueur est renvoyé à l'accueil.
  private replaceUnloadedPlayers() {
    for (const client of [...this.clients]) {
      const id = client.sessionId;
      const player = this.state.players.get(id);
      const runtime = this.combat.players.get(id);
      if (!player || !runtime || player.isBot || (this.loadProgress.get(id) ?? 0) >= 100) continue;
      console.log(`[arena ${this.roomId}] ${player.name} n'a pas fini de charger : un bot prend sa place`);
      this.reportPlayer(id, player, "chargement");
      player.isBot = true;
      player.leader = false;
      // Le chef suivant de son équipe est désigné après la boucle.
      this.arrivals = this.arrivals.filter((arrival) => arrival !== id);
      player.name = this.freshName();
      this.combat.setInput(id, NO_INPUT);
      this.bots.push(createBotBrain(runtime, this.combat, this.pathfinder));
      this.replacedByBot.add(id);
      client.send("replacedByBot");
      // Départ voulu : le client ne tente pas de se reconnecter.
      client.leave(CloseCode.CONSENTED);
    }
    this.state.playerCount = this.humans();
    this.updateLeaders();
  }

  // La partie se termine quand une équipe n'a plus aucun joueur vivant (ou plus aucun joueur).
  private checkForWinner() {
    const alive = [0, 0];
    this.state.players.forEach((p) => {
      // Avant la préparation, les points de vie ne sont pas encore attribués : on compte les présents.
      if (this.phase === "classSelect" || p.hp > 0) alive[p.team]++;
    });
    this.state.alive0 = alive[0];
    this.state.alive1 = alive[1];
    if (alive[0] > 0 && alive[1] > 0) return;
    this.endMatch(alive[0] > 0 ? 0 : alive[1] > 0 ? 1 : -1);
  }

  private endMatch(winner: number) {
    this.state.phase = "ended";
    this.state.winner = winner;
    this.state.phaseTimeLeft = 0;
    // Fin de partie : tout le monde voit tout le monde.
    for (const client of this.clients) {
      this.state.players.forEach((p) => client.view?.add(p));
    }
    this.clock.setTimeout(() => this.disconnect(), ENDED_ROOM_LIFETIME_MS);
    this.broadcast("summary", this.summary(winner));
    console.log(`[arena ${this.roomId}] fin de partie, vainqueur : équipe ${winner + 1}`);
    if (this.matchStartedAt === null) return;
    this.state.players.forEach((player, id) => {
      if (!player.isBot) this.reportPlayer(id, player, "fin", winner);
    });
    telemetry("match_end", {
      room: this.roomId,
      winner,
      seconds: Math.round((this.elapsedMs - this.matchStartedAt) / 1000),
      humans_start: this.humansAtStart,
      active_humans: this.activeHumans,
      reason: "fin",
    });
  }

  // Arrêt du serveur (déploiement) : comportement par défaut (déconnexion de tous), après avoir noté la raison.
  onBeforeShutdown() {
    this.shuttingDown = true;
    super.onBeforeShutdown();
  }

  onDispose() {
    untrackRoom(this.roomId);
    // Partie commencée mais jamais terminée : abandonnée par tous les humains (les bots restent en vie) ou interrompue
    // par l'arrêt du serveur.
    if (this.matchStartedAt !== null && this.phase !== "ended") {
      telemetry("match_end", {
        room: this.roomId,
        winner: null,
        reason: this.shuttingDown ? "arret" : "abandon",
        seconds: Math.round((this.elapsedMs - this.matchStartedAt) / 1000),
        humans_start: this.humansAtStart,
        active_humans: this.activeHumans,
      });
    }
  }

  // --- Brouillard de guerre ---

  // Ajoute ou retire de la vue de chaque client les joueurs que son équipe voit.
  private updateViews() {
    if (this.phase === "ended") return;
    const units: { id: string; team: number; x: number; z: number; alive: boolean }[] = [];
    this.state.players.forEach((p, id) => units.push({ id, team: p.team, x: p.x, z: p.z, alive: p.hp > 0 }));

    // Pendant le choix des classes et le chargement, les positions ne sont pas encore définies : on ne voit que ses
    // alliés.
    this.teamVisibility =
      this.phase === "classSelect" || this.phase === "loading"
        ? computeTeamVisibility(units.map((u) => ({ ...u, alive: false })))
        : computeTeamVisibility(units);

    for (const client of this.clients) {
      const self = this.state.players.get(client.sessionId);
      const view = client.view;
      if (!self || !view) continue;
      const spectator = this.isSpectator(self);
      const seen = this.teamVisibility.get(self.team);
      this.state.players.forEach((p, id) => {
        const shouldSee = spectator || (seen?.has(id) ?? false);
        if (shouldSee && !view.has(p)) view.add(p);
        else if (!shouldSee && view.has(p)) view.remove(p);
      });
    }
  }

  // Un événement de combat n'est envoyé qu'aux équipes qui voient l'un des joueurs concernés
  // (et à tous les spectateurs).
  private broadcastToWitnesses(type: string, message: unknown, involved: string[]) {
    for (const client of this.clients) {
      const self = this.state.players.get(client.sessionId);
      if (!self) continue;
      const seen = this.teamVisibility.get(self.team);
      if (this.isSpectator(self) || involved.some((id) => seen?.has(id))) client.send(type, message);
    }
  }

  // Un joueur mort pendant le combat devient spectateur : il voit toute l'arène, sans brouillard de guerre.
  private isSpectator(player: PlayerState): boolean {
    return this.phase === "fighting" && player.hp <= 0;
  }

  private nextColorIndex(): number {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.colorIndex));
    let index = 0;
    while (used.has(index)) index++;
    return index;
  }
}

// Ne jamais faire confiance au client : on reconstruit un input propre.
function sanitizeInput(message: unknown): MoveInput {
  const raw = (message ?? {}) as Partial<Record<keyof MoveInput, unknown>>;
  return {
    up: raw.up === true,
    down: raw.down === true,
    left: raw.left === true,
    right: raw.right === true,
    steer: raw.steer === true,
    yaw: typeof raw.yaw === "number" && Number.isFinite(raw.yaw) ? raw.yaw : undefined,
  };
}
