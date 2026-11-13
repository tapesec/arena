import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_INPUT, simulateMovement, type MoveInput, type MovementEffect } from "@arena/shared";
import { MovementPredictor, VelocityTracker, type ServerBody } from "./prediction";

// Serveur simulé : reçoit les commandes avec un délai, avance par tics de 50 ms avec le même calcul que le vrai.
class FakeServer {
  body: ServerBody = { x: 0, z: 0, facing: 0, lock: "", inputSeq: 0, inputTime: 0, effects: [] };
  private input: MoveInput = NO_INPUT;
  private inbox: { at: number; input: MoveInput; seq: number }[] = [];
  private clock = 0;

  constructor(private effects: MovementEffect[] = []) {
    this.body.effects = effects;
  }

  receive(at: number, input: MoveInput, seq: number) {
    this.inbox.push({ at, input, seq });
  }

  // Avance jusqu'à l'instant donné, tic par tic.
  runUntil(time: number) {
    while (this.clock + 0.05 <= time + 1e-9) {
      this.clock += 0.05;
      for (const message of this.inbox.filter((m) => m.at <= this.clock)) {
        this.input = message.input;
        this.body = { ...this.body, inputSeq: message.seq, inputTime: 0 };
      }
      this.inbox = this.inbox.filter((m) => m.at > this.clock);
      const next = simulateMovement(this.body, this.input, 0.05, { effects: this.effects, lock: "", target: null, confine: null });
      this.body = { ...this.body, x: next.x, z: next.z, facing: next.facing, inputTime: this.body.inputTime + 0.05 };
    }
  }
}

const FORWARD: MoveInput = { up: true, down: false, left: false, right: false };
const context = { target: null, targetVelocity: { x: 0, z: 0 }, targetAlive: false, confine: null };

// Le client joue à 60 images par seconde ; ses commandes arrivent au serveur latency secondes plus tard, et il voit
// l'état du serveur latency secondes en retard.
function play(latency: number, commands: { at: number; input: MoveInput }[], duration: number, effects: MovementEffect[] = []) {
  const server = new FakeServer(effects);
  const predictor = new MovementPredictor();
  const snapshots: { at: number; body: ServerBody }[] = [];
  const frame = 1 / 60;
  let shown = { x: 0, z: 0, facing: 0 };
  let firstMoveAt: number | null = null;
  const pending = [...commands];
  for (let time = frame; time <= duration + 1e-9; time += frame) {
    while (pending.length && pending[0].at <= time) {
      const command = pending.shift()!;
      server.receive(time + latency, command.input, predictor.send(command.input));
    }
    server.runUntil(time);
    snapshots.push({ at: time, body: server.body });
    const seen = [...snapshots].reverse().find((s) => s.at <= time - latency)?.body ?? snapshots[0].body;
    shown = predictor.update(frame, seen, context, true, shown) ?? shown;
    if (firstMoveAt === null && Math.hypot(shown.x, shown.z) > 1e-3) firstMoveAt = time;
  }
  server.runUntil(duration + latency + 1);
  return { shown, server: server.body, firstMoveAt };
}

test("prédiction : fait bouger son personnage dès l'appui, sans attendre le serveur", () => {
  const { firstMoveAt } = play(0.12, [{ at: 0.1, input: FORWARD }], 1);
  assert.ok(firstMoveAt !== null && firstMoveAt < 0.15, `premier mouvement à ${firstMoveAt}`);
});

test("prédiction : finit là où le serveur l'a placé une fois les touches relâchées", () => {
  const commands = [
    { at: 0.1, input: FORWARD },
    { at: 0.7, input: { ...FORWARD, steer: true, yaw: Math.PI / 2 } },
    { at: 1.3, input: NO_INPUT },
  ];
  const { shown, server } = play(0.12, commands, 3);
  assert.ok(Math.hypot(shown.x - server.x, shown.z - server.z) < 0.05);
});

test("prédiction : tient compte d'un ralentissement", () => {
  const snare: MovementEffect = { kind: "snare", remaining: 10, duration: 10, value: 0.5 };
  const { shown, server } = play(0.12, [{ at: 0.1, input: FORWARD }, { at: 1.1, input: NO_INPUT }], 3, [snare]);
  assert.ok(Math.hypot(shown.x - server.x, shown.z - server.z) < 0.05);
  // Une seconde à mi-vitesse : environ 3 m (vitesse normale 6 m/s).
  assert.ok(server.z > 2.5 && server.z < 3.5, `z = ${server.z}`);
});

// Poursuite au stick (C) d'une cible qui fuit en ligne droite, sur un réseau irrégulier (mises à jour qui arrivent
// avec jusqu'à 40 ms de retard en plus, parfois deux à la fois) : le personnage doit la suivre à vitesse constante.
test("prédiction : suit au stick une cible en fuite sans à-coups", () => {
  const latency = 0.1;
  const speed = 4;
  const target = (t: number) => ({ x: 0, z: 3 + speed * t });
  let server: ServerBody = { x: 0, z: 0, facing: 0, lock: "stick", inputSeq: 0, inputTime: 0, effects: [] };
  const predictor = new MovementPredictor();
  const tracker = new VelocityTracker();
  const seq = predictor.send(NO_INPUT);
  const snapshots: { tick: number; arrival: number; body: ServerBody; target: { x: number; z: number } }[] = [];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let tick = 0;
  const frame = 1 / 60;
  let shown = { x: 0, z: 0, facing: 0 };
  const speeds: number[] = [];
  for (let time = frame; time <= 4; time += frame) {
    while ((tick + 1) * 0.05 <= time + 1e-9) {
      tick++;
      const clock = tick * 0.05;
      // Le serveur vise la cible là où elle était au début du tic.
      const next = simulateMovement(server, NO_INPUT, 0.05, { effects: [], lock: "stick", target: target(clock - 0.05), confine: null });
      const acked = clock >= latency;
      server = { ...server, x: next.x, z: next.z, facing: next.facing, inputSeq: acked ? seq : 0, inputTime: acked ? server.inputTime + 0.05 : 0 };
      const previous = snapshots[snapshots.length - 1]?.arrival ?? 0;
      snapshots.push({ tick, arrival: Math.max(previous, clock + latency + random() * 0.04), body: server, target: target(clock) });
    }
    const seen = [...snapshots].reverse().find((s) => s.arrival <= time);
    if (!seen) continue;
    const before = shown;
    const velocity = tracker.update("cible", seen.target, seen.tick * 50);
    shown = predictor.update(frame, seen.body, { target: seen.target, targetVelocity: velocity, targetAlive: true, confine: null }, true, shown) ?? shown;
    if (time > 1) speeds.push((shown.z - before.z) / frame);
  }
  const slowest = Math.min(...speeds);
  const fastest = Math.max(...speeds);
  assert.ok(slowest > speed - 0.2 && fastest < speed + 0.2, `vitesse affichée entre ${slowest} et ${fastest}`);
});

test("stick : s'arrête net derrière une cible immobile (sinon il resterait « en mouvement » et ne pourrait plus incanter)", () => {
  const target = { x: 0.37, z: 7.913 };
  for (const start of [{ x: 0, z: 0 }, { x: -3.21, z: 1.7 }, { x: 5.5, z: -2.3 }]) {
    let body = { ...start, facing: 0 };
    let moving = true;
    for (let tick = 0; tick < 200; tick++) {
      const next = simulateMovement(body, NO_INPUT, 0.05, { effects: [], lock: "stick", target, confine: null });
      moving = next.stickMoving;
      body = next;
    }
    assert.equal(moving, false);
  }
});
