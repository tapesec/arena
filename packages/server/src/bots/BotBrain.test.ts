import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLASSES, START_ZONES, maxResource, type ClassId } from "@arena/shared";
import { CombatSystem } from "../CombatSystem";
import { PlayerRuntime } from "../PlayerRuntime";
import { PlayerState } from "../state";
import { computeTeamVisibility } from "../visibility";
import { BotBrain } from "./BotBrain";
import { pickBotClass } from "./composition";
import { Pathfinder } from "./Pathfinder";

const DT = 0.05;

function spawn(combat: CombatSystem, id: string, classId: ClassId, team: number, x: number, z: number): PlayerRuntime {
  const classDef = CLASSES[classId];
  const state = new PlayerState();
  state.team = team;
  state.classId = classId;
  state.x = x;
  state.z = z;
  state.hp = state.maxHp = classDef.maxHp;
  if (classDef.resource === "mana") state.mana = state.maxMana = maxResource("mana");
  else state.endurance = state.maxEndurance = maxResource("endurance");
  const player = new PlayerRuntime(id, state, classDef);
  combat.add(player);
  return player;
}

describe("Bots", () => {
  it("une Lame traverse l'arène, trouve l'ennemi et l'élimine", () => {
    const combat = new CombatSystem({ broadcast: () => {}, sendTo: () => {} });
    const lame = spawn(combat, "bot", "lame", 0, START_ZONES[0].x, START_ZONES[0].z);
    const enemy = spawn(combat, "cible", "barde", 1, START_ZONES[1].x, START_ZONES[1].z);
    const brain = new BotBrain(lame, combat, new Pathfinder());

    let elapsed = 0;
    while (enemy.alive && elapsed < 120) {
      const units = [...combat.players.values()].map((p) => ({
        id: p.id,
        team: p.state.team,
        x: p.state.x,
        z: p.state.z,
        alive: p.alive,
      }));
      const visible = computeTeamVisibility(units).get(0)!;
      brain.update(DT, { phase: "fighting", players: combat.players, visible });
      combat.tick(DT);
      elapsed += DT;
    }
    assert.ok(!enemy.alive, `cible toujours en vie après ${elapsed.toFixed(0)} s (bot en ${lame.state.x.toFixed(1)}, ${lame.state.z.toFixed(1)})`);
  });

  it("les bots complètent la composition de leur équipe", () => {
    assert.equal(pickBotClass([]), "pretre");
    assert.equal(pickBotClass(["pretre"]), "gardien");
    assert.equal(pickBotClass(["pretre", "lame", "gardien"]), "barde");
    assert.equal(pickBotClass(["pretre", "gardien", "barde"]), "arcaniste");
  });
});
