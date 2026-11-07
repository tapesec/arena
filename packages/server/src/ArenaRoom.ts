import { Room, type Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import {
  CLASS_LIST,
  CLASS_SELECT_DURATION,
  MATCH_SIZE,
  PREPARATION_DURATION,
  START_ZONES,
  TICK_RATE,
  confineToZone,
  getClass,
  maxResource,
  spawnPosition,
  type ClassId,
  type MatchPhase,
  type MoveInput,
} from "@arena/shared";
import { BotBrain } from "./bots/BotBrain";
import { pickBotClass } from "./bots/composition";
import { Pathfinder } from "./bots/Pathfinder";
import { CombatSystem } from "./CombatSystem";
import { PlayerRuntime } from "./PlayerRuntime";
import { ArenaState, PlayerState } from "./state";
import { computeTeamVisibility } from "./visibility";

const IS_DEV = process.env.NODE_ENV !== "production";

// Nombre de joueurs attendus pour lancer une partie, réductible pour tester (MATCH_SIZE=2).
const MATCH_PLAYERS = Number(process.env.MATCH_SIZE ?? MATCH_SIZE);

// Durées des phases, réductibles pour tester (en secondes).
const CLASS_SELECT_SECONDS = Number(process.env.CLASS_SELECT_DURATION ?? CLASS_SELECT_DURATION);
const PREPARATION_SECONDS = Number(process.env.PREPARATION_DURATION ?? PREPARATION_DURATION);

// En développement, un joueur peut lancer la partie avant qu'elle soit complète.
const MIN_PLAYERS_FORCED_START = 2;

// Une partie terminée ferme la salle après ce délai si les joueurs ne sont pas partis d'eux-mêmes.
const ENDED_ROOM_LIFETIME_MS = 2 * 60 * 1000;

// Une salle = une partie. Les joueurs y attendent, puis la salle se verrouille au lancement :
// les suivants ouvrent une nouvelle partie. C'est la file d'attente.
export class ArenaRoom extends Room<{ state: ArenaState }> {
  maxClients = MATCH_PLAYERS;
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
    faceTarget: (client: Client) => this.combat.faceTarget(client.sessionId),
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
      // Tous les joueurs humains ont choisi : inutile d'attendre la fin du chrono.
      let everyoneChose = true;
      this.state.players.forEach((p) => (everyoneChose &&= p.isBot || p.classId !== ""));
      if (everyoneChose) this.startPreparation();
    },
    forceStart: () => {
      if (IS_DEV && this.phase === "waiting" && this.state.players.size >= MIN_PLAYERS_FORCED_START) {
        this.startClassSelect();
      }
    },
    // Complète la partie avec des bots et la lance.
    addBots: () => {
      if (!IS_DEV || this.phase !== "waiting") return;
      while (this.state.players.size < MATCH_PLAYERS) this.addBot();
      this.startClassSelect();
    },
  };

  // Les bots n'ont pas de connexion : ils n'existent que dans l'état et le système de combat.
  private pathfinder = new Pathfinder();
  private bots: BotBrain[] = [];
  private botCount = 0;

  private addBot() {
    const player = new PlayerState();
    player.colorIndex = this.nextColorIndex();
    player.name = `Bot ${++this.botCount}`;
    player.isBot = true;
    this.state.players.set(`bot-${this.botCount}`, player);
    this.state.playerCount = this.state.players.size;
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
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / TICK_RATE);
    this.setPatchRate(1000 / TICK_RATE);
  }

  onJoin(client: Client) {
    const player = new PlayerState();
    player.colorIndex = this.nextColorIndex();
    player.name = `Joueur ${player.colorIndex + 1}`;
    this.state.players.set(client.sessionId, player);
    this.state.playerCount = this.state.players.size;

    // Chaque client a sa propre vue de l'état ; au départ, il ne voit que lui-même.
    client.view = new StateView();
    client.view.add(player);
    console.log(`[arena ${this.roomId}] ${player.name} a rejoint (${this.state.playerCount}/${MATCH_PLAYERS})`);

    if (this.state.playerCount >= MATCH_PLAYERS) this.startClassSelect();
  }

  onLeave(client: Client) {
    const name = this.state.players.get(client.sessionId)?.name;
    this.combat.remove(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.state.playerCount = this.state.players.size;
    console.log(`[arena ${this.roomId}] ${name} est parti (${this.state.playerCount} joueurs)`);
    if (this.phase !== "waiting" && this.phase !== "ended") this.checkForWinner();
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
    if (this.phase !== "waiting") this.updateViews();
  }

  // Décompte la phase en cours ; retourne vrai quand le temps est écoulé.
  private countdown(dt: number): boolean {
    this.state.phaseTimeLeft = Math.max(0, this.state.phaseTimeLeft - dt);
    return this.state.phaseTimeLeft === 0;
  }

  // --- Phases ---

  private startClassSelect() {
    // Plus personne ne peut rejoindre cette partie.
    void this.lock();
    this.state.phase = "classSelect";
    this.state.phaseTimeLeft = CLASS_SELECT_SECONDS;

    // Équipes tirées au hasard, en alternant pour qu'elles soient équilibrées.
    const ids = shuffle([...this.state.players.keys()]);
    ids.forEach((id, index) => (this.state.players.get(id)!.team = index % 2));
  }

  private startPreparation() {
    this.state.phase = "preparation";
    this.state.phaseTimeLeft = PREPARATION_SECONDS;

    const indexInTeam = [0, 0];
    const teamSizes = [0, 0];
    this.state.players.forEach((p) => teamSizes[p.team]++);

    // Classe tirée au hasard pour les joueurs qui n'ont pas choisi à temps.
    this.state.players.forEach((player) => {
      if (!player.isBot && !getClass(player.classId)) {
        player.classId = CLASS_LIST[Math.floor(Math.random() * CLASS_LIST.length)].id;
      }
    });
    // Les bots choisissent ensuite, pour compléter la composition de leur équipe.
    this.state.players.forEach((player) => {
      if (!player.isBot) return;
      const teamClasses: ClassId[] = [];
      this.state.players.forEach((p) => {
        if (p.team === player.team && p.classId) teamClasses.push(p.classId as ClassId);
      });
      player.classId = pickBotClass(teamClasses);
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
      if (player.isBot) this.bots.push(new BotBrain(runtime, this.combat, this.pathfinder));
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
      const seen = this.teamVisibility.get(self.team);
      this.state.players.forEach((p, id) => {
        const shouldSee = seen?.has(id) ?? false;
        if (shouldSee && !view.has(p)) view.add(p);
        else if (!shouldSee && view.has(p)) view.remove(p);
      });
    }
  }

  // Un événement de combat n'est envoyé qu'aux équipes qui voient l'un des joueurs concernés.
  private broadcastToWitnesses(type: string, message: unknown, involved: string[]) {
    for (const client of this.clients) {
      const team = this.state.players.get(client.sessionId)?.team;
      const seen = team === undefined ? undefined : this.teamVisibility.get(team);
      if (involved.some((id) => seen?.has(id))) client.send(type, message);
    }
  }

  private nextColorIndex(): number {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.colorIndex));
    let index = 0;
    while (used.has(index)) index++;
    return index;
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Ne jamais faire confiance au client : on reconstruit un input propre.
function sanitizeInput(message: unknown): MoveInput {
  const raw = (message ?? {}) as Partial<Record<keyof MoveInput, unknown>>;
  return {
    up: raw.up === true,
    down: raw.down === true,
    left: raw.left === true,
    right: raw.right === true,
  };
}
