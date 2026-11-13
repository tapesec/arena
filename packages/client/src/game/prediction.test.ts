import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_INPUT, simulateMovement, type MoveInput, type MovementEffect } from "@arena/shared";
import { MovementPredictor, type ServerBody } from "./prediction";

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
const context = { target: null, targetAlive: false, confine: null };

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
