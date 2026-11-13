import {
  PERMANENT,
  isIncapacitated,
  normalizeAngle,
  lockReleased,
  simulateMovement,
  type MoveInput,
  type MovementBody,
  type MovementEffect,
  type Position,
} from "@arena/shared";

// Prédiction du déplacement de son propre personnage : sans elle, il ne bouge qu'au retour du serveur (ping + tic
// serveur + lissage). Le client numérote chaque commande envoyée et retient combien de temps il l'a tenue. Le serveur
// renvoie la dernière commande reçue et le temps passé depuis sous cette commande : on repart de la position du
// serveur et on rejoue, avec le même calcul (simulateMovement), ce qu'il n'a pas encore appliqué. Les petits écarts
// (gigue du réseau) sont résorbés en douceur ; un grand écart (charge, contrôle) est rattrapé d'un coup.

// Pas de rejeu, celui du serveur (20 tics par seconde) : un pas plus long pourrait traverser un obstacle.
const REPLAY_STEP = 1 / 20;
// Vitesse à laquelle un écart avec le serveur se résorbe (par seconde), et écart au-delà duquel on se recale net.
const CORRECTION_RATE = 10;
const SNAP_DISTANCE = 3;
// Garde-fou : commandes en attente de réponse au plus.
const MAX_PENDING = 200;

interface Segment {
  seq: number;
  input: MoveInput;
  // Temps pendant lequel le client a tenu cette commande (jusqu'à la suivante).
  elapsed: number;
}

// Ce que le serveur dit de notre personnage (état synchronisé).
export interface ServerBody extends MovementBody {
  lock: string;
  inputSeq: number;
  inputTime: number;
  effects: Iterable<MovementEffect>;
}

// Ce qui est affiché : position et orientation, et si l'image vient d'être recalée net (l'animation de course ne doit
// pas y voir un déplacement).
export interface PredictedBody extends MovementBody {
  snapped: boolean;
}

export interface PredictionContext {
  // Position de la cible verrouillable (null sans cible) et si elle est vivante.
  target: Position | null;
  targetAlive: boolean;
  confine: ((pos: Position) => Position) | null;
}

export class MovementPredictor {
  private segments: Segment[] = [];
  private nextSeq = 1;
  // Dernière position serveur prise en compte (pour mesurer la correction quand elle change).
  private base: ServerBody | null = null;
  private baseKey = "";
  // Écart avec la position prédite, résorbé peu à peu (position et orientation).
  private offset = { x: 0, z: 0, facing: 0 };
  // Prédiction active à l'image précédente ; reprise pas encore signalée au jeu.
  private active = false;
  private restarted = false;

  // Nouvelle commande envoyée au serveur : son numéro.
  send(input: MoveInput): number {
    const seq = this.nextSeq++;
    this.segments.push({ seq, input, elapsed: 0 });
    if (this.segments.length > MAX_PENDING) this.segments.shift();
    return seq;
  }

  // Vrai une seule fois après une reprise de la prédiction : le jeu doit renvoyer les touches tenues (celles envoyées
  // pendant la pause, une charge par exemple, ont été oubliées).
  takeRestart(): boolean {
    const restarted = this.restarted;
    this.restarted = false;
    return restarted;
  }

  // Position et orientation à afficher pour cette image. Sans prédiction (avant la préparation, mort, en charge) :
  // les commandes en attente sont oubliées et on suit le serveur. display : ce qui est affiché à l'image précédente,
  // d'où l'on part en douceur quand la prédiction reprend.
  update(dt: number, server: ServerBody, context: PredictionContext, active: boolean, display: MovementBody): PredictedBody | null {
    if (!active) {
      this.reset();
      return null;
    }
    const starting = !this.active;
    this.active = true;
    if (starting) this.restarted = true;
    const current = this.segments[this.segments.length - 1];
    if (current) current.elapsed += dt;

    const key = `${server.x},${server.z},${server.facing},${server.inputSeq},${server.inputTime},${server.lock}`;
    let previous: MovementBody | null = null;
    if (key !== this.baseKey && this.base) previous = this.replay(this.base, context);
    if (key !== this.baseKey) {
      this.baseKey = key;
      this.base = copyServerBody(server);
      // Les commandes antérieures à la dernière reçue par le serveur sont faites.
      this.segments = this.segments.filter((s) => s.seq >= server.inputSeq);
    }
    const predicted = this.replay(this.base!, context);
    if (starting) previous = display;
    if (previous) {
      this.offset.x += previous.x - predicted.x;
      this.offset.z += previous.z - predicted.z;
      this.offset.facing = normalizeAngle(this.offset.facing + previous.facing - predicted.facing);
    }
    let snapped = false;
    if (Math.hypot(this.offset.x, this.offset.z) > SNAP_DISTANCE) {
      this.offset = { x: 0, z: 0, facing: this.offset.facing };
      snapped = true;
    }
    const decay = Math.exp(-CORRECTION_RATE * dt);
    this.offset.x *= decay;
    this.offset.z *= decay;
    this.offset.facing *= decay;
    return {
      x: predicted.x + this.offset.x,
      z: predicted.z + this.offset.z,
      facing: normalizeAngle(predicted.facing + this.offset.facing),
      snapped,
    };
  }

  private reset() {
    this.segments = [];
    this.base = null;
    this.baseKey = "";
    this.offset = { x: 0, z: 0, facing: 0 };
    this.active = false;
  }

  // Rejoue depuis la position du serveur les commandes qu'il n'a pas encore appliquées : la dernière qu'il a reçue
  // pour le temps qu'il lui reste, les suivantes en entier.
  private replay(base: ServerBody, context: PredictionContext): MovementBody {
    let body: MovementBody = { x: base.x, z: base.z, facing: base.facing };
    let lock = base.lock;
    // Les effets s'écoulent pendant le rejeu, comme sur le serveur (décomptés avant le déplacement) : un root qui
    // expire libère le personnage au bon moment.
    let effects = [...base.effects].map((e) => ({ ...e }));
    for (const segment of this.segments) {
      let remaining = segment.seq === base.inputSeq ? Math.max(0, segment.elapsed - base.inputTime) : segment.elapsed;
      while (remaining > 1e-6) {
        const dt = Math.min(REPLAY_STEP, remaining);
        remaining -= dt;
        for (const effect of effects) if (effect.remaining !== PERMANENT) effect.remaining -= dt;
        effects = effects.filter((e) => e.remaining === PERMANENT || e.remaining > 0);
        if (lock && lockReleased(lock, segment.input, context.targetAlive, effects)) lock = "";
        if (isIncapacitated(effects)) continue;
        const next = simulateMovement(body, segment.input, dt, {
          effects,
          lock,
          target: lock ? context.target : null,
          confine: context.confine,
        });
        body = { x: next.x, z: next.z, facing: next.facing };
      }
    }
    return body;
  }
}

// Copie champ par champ : l'état synchronisé change sous nos pieds à chaque mise à jour du serveur.
function copyServerBody(server: ServerBody): ServerBody {
  return {
    x: server.x,
    z: server.z,
    facing: server.facing,
    lock: server.lock,
    inputSeq: server.inputSeq,
    inputTime: server.inputTime,
    effects: [...server.effects].map((e) => ({ kind: e.kind, remaining: e.remaining, duration: e.duration, value: e.value })),
  };
}
