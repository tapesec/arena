import { openSync, writeSync } from "node:fs";
import type { MoveInput } from "@arena/shared";

// Événements de jeu pour l'observabilité : une ligne JSON par événement dans TELEMETRY_FILE (en production
// /var/log/arena/events.log, envoyé à CloudWatch Logs par l'agent CloudWatch ; voir infra/main/observability.tf, qui en
// tire les métriques et le tableau de bord). Sans TELEMETRY_FILE (développement, tests), rien n'est écrit.
//
// Données personnelles : ni adresse IP, ni pseudo, ni identifiant durable. Seulement la famille de navigateur, la
// classe jouée et des compteurs.

// Un joueur est « actif » à partir de ce nombre d'actions dans une partie (les autres : onglet ouvert puis abandonné,
// robot).
export const ACTIVE_PLAYER_ACTIONS = 5;

// Fréquence des relevés (joueurs connectés, en partie).
const SNAPSHOT_INTERVAL_MS = 60_000;

type Fields = Record<string, string | number | boolean | null>;

// Descripteur du fichier, ouvert au premier événement ; null : télémétrie désactivée (pas de fichier, ou erreur).
let output: number | null | undefined;

// Une erreur d'écriture (disque plein, droits…) ne doit jamais arrêter le jeu : la télémétrie se désactive.
function disable(error: unknown): null {
  console.error(`Télémétrie désactivée : ${error instanceof Error ? error.message : String(error)}`);
  output = null;
  return null;
}

function fileDescriptor(): number | null {
  if (output === undefined) {
    const file = process.env.TELEMETRY_FILE;
    try {
      output = file ? openSync(file, "a") : null;
    } catch (error) {
      return disable(error);
    }
  }
  return output;
}

// Écriture synchrone : quelques lignes par minute, et rien n'est perdu quand le serveur s'arrête (process.exit).
export function telemetry(event: string, fields: Fields = {}): void {
  const fd = fileDescriptor();
  if (fd === null) return;
  try {
    writeSync(fd, `${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`);
  } catch (error) {
    disable(error);
  }
}

// Famille de navigateur tirée du User-Agent (HeadlessChrome : navigateur automatisé, donc probablement un robot).
export function browserFamily(userAgent: string | null | undefined): { browser: string; mobile: boolean } {
  const ua = userAgent ?? "";
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const browser = /HeadlessChrome/.test(ua)
    ? "HeadlessChrome"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : ua
                ? "Autre"
                : "Inconnu";
  return { browser, mobile };
}

// Actions d'un joueur pendant une partie : commencer à se déplacer, lancer une compétence, choisir une cible, activer
// l'attaque, donner un ordre aux bots. Les entrées de déplacement arrivent en continu : seul le début d'un mouvement
// compte.
export class ActionCounter {
  private counts = new Map<string, number>();
  private moving = new Map<string, boolean>();

  move(id: string, input: MoveInput): void {
    const moving = input.up || input.down || input.left || input.right;
    if (moving && !this.moving.get(id)) this.add(id);
    this.moving.set(id, moving);
  }

  add(id: string): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
  }

  get(id: string): number {
    return this.counts.get(id) ?? 0;
  }

  forget(id: string): void {
    this.counts.delete(id);
    this.moving.delete(id);
  }
}

// Salles ouvertes, pour les relevés réguliers.
export interface RoomSnapshot {
  humans: number;
  inMatch: boolean;
}

const rooms = new Map<string, () => RoomSnapshot>();

export function trackRoom(roomId: string, snapshot: () => RoomSnapshot): void {
  rooms.set(roomId, snapshot);
}

export function untrackRoom(roomId: string): void {
  rooms.delete(roomId);
}

export function snapshot(): Fields {
  let online = 0;
  let inMatch = 0;
  let matches = 0;
  for (const read of rooms.values()) {
    const room = read();
    online += room.humans;
    if (room.inMatch) {
      inMatch += room.humans;
      matches++;
    }
  }
  return { online, in_match: inMatch, matches, rooms: rooms.size };
}

// Relevé toutes les minutes, même à zéro joueur (la courbe du tableau de bord reste continue).
export function startSnapshots(): void {
  if (fileDescriptor() === null) return;
  setInterval(() => telemetry("snapshot", snapshot()), SNAPSHOT_INTERVAL_MS).unref();
}

// Performances d'affichage envoyées par le client (packages/client/src/game/renderScale.ts) : densité de l'écran,
// densité du rendu, images/s moyennes et basses (10e centile), baisses de résolution tentées et annulation de la
// dernière (1 : sans effet, le processeur freine). Valeurs bornées et arrondies ; null si le message est invalide.
export interface RenderPerf {
  dpr: number;
  scale: number;
  fps: number;
  fps_low: number;
  drops: number;
  reverted: number;
}

export function sanitizePerf(message: unknown): RenderPerf | null {
  const m = (message ?? {}) as Record<string, unknown>;
  const num = (value: unknown, min: number, max: number, digits = 0) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? Number(value.toFixed(digits)) : null;
  const perf = {
    dpr: num(m.dpr, 0.25, 8, 2),
    scale: num(m.scale, 0.25, 8, 2),
    fps: num(m.fps, 0, 1000),
    fps_low: num(m.fpsLow, 0, 1000),
    drops: num(m.drops, 0, 10),
    reverted: num(m.reverted, 0, 1),
  };
  return Object.values(perf).every((v) => v !== null) ? (perf as RenderPerf) : null;
}
