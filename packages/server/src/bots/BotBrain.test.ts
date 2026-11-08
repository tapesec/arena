import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLASSES, MELEE_RANGE, START_ZONES, distance, maxResource, spawnPosition, type ClassId } from "@arena/shared";
import { CombatSystem } from "../CombatSystem";
import { PlayerRuntime } from "../PlayerRuntime";
import { PlayerState } from "../state";
import { computeTeamVisibility } from "../visibility";
import { HUMAN_ERRORS, type BotBrain } from "./BotBrain";
import { createBotBrain } from "./classBots";
import { pickBotClass } from "./composition";
import { Pathfinder } from "./Pathfinder";

const DT = 0.05;

// Les tests de comportement se déroulent dans la zone ouverte de l'arène (sans obstacle ni relief),
// autour de (37, 10) : leurs positions sont décalées d'autant.
const LANE = { x: 33, z: 25 };
const pathfinder = new Pathfinder();

// Les comportements sont testés sans erreur humaine, pour être reproductibles.
HUMAN_ERRORS.enabled = false;

// Petite arène de test : système de combat sans réseau, bots et joueurs passifs.
class Sim {
  combat = new CombatSystem({ broadcast: () => {}, sendTo: () => {} });
  bots: BotBrain[] = [];

  // facing : 0 regarde vers +z, π vers -z.
  spawn(id: string, classId: ClassId, team: number, x: number, z: number, facing = 0, bot = false, inLane = true): PlayerRuntime {
    const classDef = CLASSES[classId];
    const state = new PlayerState();
    state.team = team;
    state.classId = classId;
    state.x = inLane ? x + LANE.x : x;
    state.z = inLane ? z + LANE.z : z;
    state.facing = facing;
    state.hp = state.maxHp = classDef.maxHp;
    if (classDef.resource === "mana") state.mana = state.maxMana = maxResource("mana");
    else state.endurance = state.maxEndurance = maxResource("endurance");
    const player = new PlayerRuntime(id, state, classDef);
    this.combat.add(player);
    if (bot) this.bots.push(createBotBrain(player, this.combat, pathfinder));
    return player;
  }

  // Avance la simulation ; s'arrête plus tôt si until() devient vrai.
  run(seconds: number, until: () => boolean = () => false): number {
    let elapsed = 0;
    while (elapsed < seconds && !until()) {
      const units = [...this.combat.players.values()].map((p) => ({
        id: p.id,
        team: p.state.team,
        x: p.state.x,
        z: p.state.z,
        alive: p.alive,
      }));
      const visibility = computeTeamVisibility(units);
      for (const bot of this.bots) {
        const visible = visibility.get(bot.player.state.team) ?? new Set<string>();
        bot.update(DT, { phase: "fighting", players: this.combat.players, visible });
      }
      this.combat.tick(DT);
      elapsed += DT;
    }
    return elapsed;
  }
}

describe("Bots : déplacements", () => {
  it("une Lame traverse l'arène, trouve l'ennemi et l'élimine", () => {
    const sim = new Sim();
    const lame = sim.spawn("bot", "lame", 0, START_ZONES[0].x, START_ZONES[0].z, 0, true, false);
    const enemy = sim.spawn("cible", "barde", 1, START_ZONES[1].x, START_ZONES[1].z, 0, false, false);
    const elapsed = sim.run(120, () => !enemy.alive);
    assert.ok(!enemy.alive, `cible toujours en vie après ${elapsed.toFixed(0)} s (bot en ${lame.state.x.toFixed(1)}, ${lame.state.z.toFixed(1)})`);
  });

  it("les bots complètent la composition de leur équipe", () => {
    assert.equal(pickBotClass([]), "pretre");
    assert.equal(pickBotClass(["pretre"]), "gardien");
    assert.equal(pickBotClass(["pretre", "lame", "gardien"]), "barde");
    assert.equal(pickBotClass(["pretre", "gardien", "barde"]), "arcaniste");
  });
});

describe("Bots : comportement par classe", () => {
  it("un Arcaniste frappé au corps à corps s'éloigne", () => {
    const sim = new Sim();
    const arcaniste = sim.spawn("a", "arcaniste", 0, 5, 0, 0, true);
    const lame = sim.spawn("l", "lame", 1, 5, 2, Math.PI); // immobile, tape tant qu'il est à portée
    sim.combat.setTarget(lame.id, arcaniste.id);
    sim.combat.toggleAttack(lame.id);
    sim.run(4);
    assert.ok(distance(arcaniste.state, lame.state) > MELEE_RANGE + 2, `encore à ${distance(arcaniste.state, lame.state).toFixed(1)} m`);
  });

  it("un Prêtre soigne un allié blessé", () => {
    const sim = new Sim();
    sim.spawn("p", "pretre", 0, 5, -10, 0, true);
    const ally = sim.spawn("x", "lame", 0, 5, -5);
    ally.state.hp = 500;
    sim.run(3);
    assert.ok(ally.state.hp > 500, `PV de l'allié : ${ally.state.hp}`);
  });

  it("un Barde mezze un groupe de deux ennemis", () => {
    const sim = new Sim();
    sim.spawn("b", "barde", 0, 5, -20, 0, true);
    const e1 = sim.spawn("e1", "arcaniste", 1, 5, 0);
    const e2 = sim.spawn("e2", "pretre", 1, 7, 0);
    sim.run(4);
    assert.ok(e1.has("mez") && e2.has("mez"));
  });

  it("un Gardien protège un lanceur de sorts attaqué", () => {
    const sim = new Sim();
    const gardien = sim.spawn("g", "gardien", 0, 6, -16, 0, true);
    const arcaniste = sim.spawn("a", "arcaniste", 0, 5, -10);
    const lame = sim.spawn("l", "lame", 1, 5, -8, Math.PI);
    sim.combat.setTarget(lame.id, arcaniste.id);
    sim.combat.toggleAttack(lame.id);
    sim.run(3);
    assert.equal(arcaniste.getEffect("guarded")?.sourceId, gardien.id);
    assert.ok(distance(gardien.state, arcaniste.state) <= 4, "le Gardien doit rester près de son protégé");
    assert.equal(gardien.targetId, lame.id);
  });
});

describe("Bots : partie complète", () => {
  it("une partie à 16 bots se termine par une victoire", () => {
    const sim = new Sim();
    for (const team of [0, 1]) {
      const classes: ClassId[] = [];
      for (let i = 0; i < 8; i++) {
        const classId = pickBotClass(classes);
        classes.push(classId);
        const pos = spawnPosition(START_ZONES[team], i, 8);
        sim.spawn(`t${team}-${i}`, classId, team, pos.x, pos.z, team === 0 ? Math.PI / 4 : (-3 * Math.PI) / 4, true, false);
      }
    }
    const aliveIn = (team: number) =>
      [...sim.combat.players.values()].filter((p) => p.state.team === team && p.alive).length;
    const elapsed = sim.run(600, () => aliveIn(0) === 0 || aliveIn(1) === 0);
    assert.ok(aliveIn(0) === 0 || aliveIn(1) === 0, `pas de vainqueur après ${elapsed.toFixed(0)} s (${aliveIn(0)} contre ${aliveIn(1)})`);
  });
});

describe("Bots : erreur humaine", () => {
  it("un bot met un court instant à remarquer un ennemi qui apparaît", () => {
    HUMAN_ERRORS.enabled = true;
    try {
      const sim = new Sim();
      const barde = sim.spawn("b", "barde", 0, 5, -20, 0, true);
      const e1 = sim.spawn("e1", "arcaniste", 1, 5, 0);
      sim.spawn("e2", "pretre", 1, 7, 0);
      sim.run(HUMAN_ERRORS.reactionMin - 0.1);
      assert.equal(barde.state.castAbility, "", "le bot a réagi instantanément");
      sim.run(5);
      assert.ok(e1.has("mez"), "le bot n'a jamais réagi");
    } finally {
      HUMAN_ERRORS.enabled = false;
    }
  });
});
