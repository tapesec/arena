import assert from "node:assert/strict";
import { test } from "node:test";
import { PERMANENT } from "@arena/shared";
import { buildLoading, buildMatchFrame, buildTeammates, effectFrames, roundRemaining } from "./hudFrames";
import type { MatchStateView } from "./matchState";
import type { PlayerView, PlayerVisual } from "./PlayerVisual";

const player = (sessionId: string, state: Partial<PlayerView>) => ({ sessionId, state }) as unknown as PlayerVisual;

test("décompte des effets : au dixième dans les dernières secondes, sauf en version grossière", () => {
  assert.equal(roundRemaining(5.2, false), 6);
  assert.equal(roundRemaining(2.31, false), 2.4);
  assert.equal(roundRemaining(0.01, false), 0.1);
  assert.equal(roundRemaining(2.31, true), 3);
});

test("effets : permanent sans durée, source nommée", () => {
  const state = { effects: [{ kind: "rampart", remaining: PERMANENT, duration: PERMANENT, source: "g", value: 0 }] } as unknown as PlayerView;
  assert.deepEqual(effectFrames(state, (id) => (id === "g" ? "Gardien" : "")), [
    { kind: "rampart", remaining: null, duration: null, sourceId: "g", source: "Gardien" },
  ]);
});

test("cadre de la partie vu depuis l'une ou l'autre équipe", () => {
  const state = { phase: "fighting", phaseTimeLeft: 4.2, playerCount: 3, matchSize: 16, alive0: 5, alive1: 7, teamSize: 8, campSwap: false, winner: -1 } as MatchStateView;
  const blue = buildMatchFrame(state, 0);
  assert.equal(blue.timeLeft, 5);
  assert.deepEqual([blue.alliesAlive, blue.enemiesAlive], [5, 7]);
  const red = buildMatchFrame(state, 1);
  assert.deepEqual([red.alliesAlive, red.enemiesAlive], [7, 5]);
});

test("équipe : soi d'abord, puis les joueurs, puis les bots ; les adversaires n'y sont pas", () => {
  const self = player("me", { team: 0, name: "Moi", isBot: false, leader: true, classId: "" });
  const players = [
    player("bot", { team: 0, name: "Bot", isBot: true, leader: false, classId: "lame" }),
    player("foe", { team: 1, name: "Adversaire", isBot: false, leader: false, classId: "" }),
    player("mate", { team: 0, name: "Ami", isBot: false, leader: false, classId: "pretre" }),
    self,
  ];
  assert.deepEqual(buildTeammates(self, players).map((m) => m.id), ["me", "mate", "bot"]);
});

test("chargement : sa propre progression vient du suivi local", () => {
  const loading = new Map([
    ["me", { name: "Moi", team: 0, isBot: false, progress: 10 }],
    ["bot", { name: "Bot", team: 1, isBot: true, progress: 100 }],
  ]);
  assert.deepEqual(buildLoading(loading, "me", 55).map((l) => [l.id, l.progress, l.isSelf]), [["me", 55, true], ["bot", 100, false]]);
  assert.deepEqual(buildLoading(undefined, "me", 55), []);
});
