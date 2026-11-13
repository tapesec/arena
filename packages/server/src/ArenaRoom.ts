import { Room, type Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import {
  FULL_LOBBY_COUNTDOWN,
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
  type MatchPhase,
  type MoveInput,
} from "@arena/shared";
import { BotBrain } from "./bots/BotBrain";
import { createBotBrain } from "./bots/classBots";
import { botToReplace, initialBotClasses, pickBotClass } from "./bots/composition";
import { Pathfinder } from "./bots/Pathfinder";
import { CombatSystem } from "./CombatSystem";
import { PlayerRuntime } from "./PlayerRuntime";
import { ArenaState, PlayerState } from "./state";
import { claimName, nameKey, randomName } from "./names";
import { computeTeamVisibility } from "./visibility";

const IS_DEV = process.env.NODE_ENV !== "production";

// Nombre de joueurs d'une partie (humains et bots), réductible pour tester (MATCH_SIZE=4).
const MATCH_PLAYERS = Number(process.env.MATCH_SIZE ?? MATCH_SIZE);
const TEAM_SIZE = Math.max(1, Math.floor(MATCH_PLAYERS / 2));

// Durées des phases, réductibles pour tester (en secondes).
const LOBBY_SECONDS = Number(process.env.LOBBY_DURATION ?? LOBBY_DURATION);
const FULL_LOBBY_SECONDS = Number(process.env.FULL_LOBBY_COUNTDOWN ?? FULL_LOBBY_COUNTDOWN);
const PREPARATION_SECONDS = Number(process.env.PREPARATION_DURATION ?? PREPARATION_DURATION);

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
  });

  // Joueurs visibles par chaque équipe, recalculés à chaque tick.
  private teamVisibility = new Map<number, Set<string>>();

  messages = {
    input: (client: Client, message: unknown) => {
      this.combat.setInput(client.sessionId, sanitizeInput(message));
    },
    target: (client: Client, message: unknown) => {
      const targetId = (message as { targetId?: unknown } | null)?.targetId;
      this.combat.setTarget(client.sessionId, typeof targetId === "string" ? targetId : null);
    },
    toggleAttack: (client: Client) => this.combat.toggleAttack(client.sessionId),
    faceLock: (client: Client) => this.combat.lockOnTarget(client.sessionId, "face"),
    stick: (client: Client) => this.combat.lockOnTarget(client.sessionId, "stick"),
    cast: (client: Client, message: unknown) => {
      const abilityId = (message as { abilityId?: unknown } | null)?.abilityId;
      if (typeof abilityId === "string") this.combat.useAbility(client.sessionId, abilityId);
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
    // En développement : lancer la partie sans attendre la fin du compte à rebours.
    forceStart: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (IS_DEV && this.phase === "classSelect" && player?.leader) this.startPreparation();
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

  private addBot(team: number, classId: ClassId) {
    const player = new PlayerState();
    player.colorIndex = this.nextColorIndex();
    player.name = this.freshName();
    player.isBot = true;
    player.team = team;
    player.classId = classId;
    this.state.players.set(`bot-${++this.botCount}`, player);
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

  onCreate() {
    this.state.matchSize = MATCH_PLAYERS;
    this.state.phaseTimeLeft = LOBBY_SECONDS;
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
    this.state.players.set(client.sessionId, player);
    this.arrivals.push(client.sessionId);
    this.updateLeaders();
    this.state.playerCount = this.humans();

    // Chaque client a sa propre vue de l'état ; il y voit ses coéquipiers (updateViews).
    client.view = new StateView();
    client.view.add(player);
    console.log(`[arena ${this.roomId}] ${player.name} a rejoint (${this.state.playerCount}/${MATCH_PLAYERS})`);

    // Salle pleine : la partie part bientôt, le temps que le dernier arrivé choisisse sa classe.
    // Seulement la première fois : un joueur qui part et revient ne peut pas retarder la partie sans fin.
    if (this.state.playerCount >= this.maxClients && !this.filledOnce) {
      this.filledOnce = true;
      this.state.phaseTimeLeft = FULL_LOBBY_SECONDS;
    }
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    this.combat.remove(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.arrivals = this.arrivals.filter((id) => id !== client.sessionId);
    // Dans la salle d'attente, un bot reprend la place libérée, avec la classe qui manque le plus à l'équipe.
    if (player && this.phase === "classSelect") this.addBot(player.team, pickBotClass(this.teamClasses(player.team)));
    this.updateLeaders();
    this.state.playerCount = this.humans();
    console.log(`[arena ${this.roomId}] ${player?.name} est parti (${this.state.playerCount} joueurs)`);
    if (this.phase !== "classSelect" && this.phase !== "ended") this.checkForWinner();
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
    switch (this.phase) {
      case "classSelect":
        if (this.countdown(dt)) this.startPreparation();
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

  private startPreparation() {
    // Plus personne ne peut rejoindre cette partie.
    void this.lock();
    this.state.phase = "preparation";
    this.state.phaseTimeLeft = PREPARATION_SECONDS;

    const indexInTeam = [0, 0];
    const teamSizes = [0, 0];
    this.state.players.forEach((p) => teamSizes[p.team]++);

    // Les joueurs qui n'ont pas choisi à temps prennent la classe qui manque le plus à leur équipe.
    this.state.players.forEach((player) => {
      if (!getClass(player.classId)) player.classId = pickBotClass(this.teamClasses(player.team));
    });

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
    this.combat.confine = null;
  }

  // La partie se termine quand une équipe n'a plus aucun joueur vivant (ou plus aucun joueur).
  private checkForWinner() {
    const alive = [0, 0];
    this.state.players.forEach((p) => {
      // Avant la préparation, les points de vie ne sont pas encore attribués : on compte les présents.
      if (this.phase === "classSelect" || p.hp > 0) alive[p.team]++;
    });
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
    console.log(`[arena ${this.roomId}] fin de partie, vainqueur : équipe ${winner + 1}`);
  }

  // --- Brouillard de guerre ---

  // Ajoute ou retire de la vue de chaque client les joueurs que son équipe voit.
  private updateViews() {
    if (this.phase === "ended") return;
    const units: { id: string; team: number; x: number; z: number; alive: boolean }[] = [];
    this.state.players.forEach((p, id) => units.push({ id, team: p.team, x: p.x, z: p.z, alive: p.hp > 0 }));

    // Pendant le choix des classes, les positions ne sont pas encore définies : on ne voit que ses alliés.
    this.teamVisibility =
      this.phase === "classSelect"
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
