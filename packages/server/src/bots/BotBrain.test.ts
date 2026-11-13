import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLASSES, MELEE_RANGE, START_ZONES, distance, maxResource, spawnPosition, type ClassId, type OrderId } from "@arena/shared";
import { CombatSystem } from "../CombatSystem";
import { PlayerRuntime } from "../PlayerRuntime";
import { PlayerState } from "../state";
import { computeTeamVisibility } from "../visibility";
import { HUMAN_ERRORS, type BotBrain } from "./BotBrain";
import { createBotBrain } from "./classBots";
import { pickBotClass } from "./composition";
import { dispatchOrder } from "./orders";
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

  // Joueurs vus par chaque équipe.
  visibility(): Map<number, Set<string>> {
    const units = [...this.combat.players.values()].map((p) => ({
      id: p.id,
      team: p.state.team,
      x: p.state.x,
      z: p.state.z,
      alive: p.alive,
    }));
    return computeTeamVisibility(units);
  }

  // Ordre donné par un joueur : réponses des bots.
  order(kind: OrderId, issuer: PlayerRuntime) {
    const visible = this.visibility().get(issuer.state.team) ?? new Set<string>();
    return dispatchOrder(kind, issuer, this.bots, this.combat.players, visible);
  }

  // Avance la simulation ; s'arrête plus tôt si until() devient vrai.
  run(seconds: number, until: () => boolean = () => false): number {
    let elapsed = 0;
    while (elapsed < seconds && !until()) {
      const visibility = this.visibility();
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

describe("Bots : Gardien", () => {
  it("charge un lanceur de sorts ennemi quand son protégé est tranquille", () => {
    const sim = new Sim();
    const gardien = sim.spawn("g", "gardien", 0, 5, -10, 0, true);
    sim.spawn("p", "pretre", 0, 6, -11);
    const caster = sim.spawn("e", "arcaniste", 1, 5, 8, Math.PI);
    sim.run(4, () => caster.has("stun"));
    assert.ok(caster.has("stun"), "la Charge doit stun le lanceur de sorts");
    assert.ok(distance(gardien.state, caster.state) <= MELEE_RANGE);
  });

  it("provoque la Lame qui frappe son protégé, puis la frappe (Coup de bouclier, Coup puissant)", () => {
    const sim = new Sim();
    const gardien = sim.spawn("g", "gardien", 0, 6, -12, 0, true);
    const arcaniste = sim.spawn("a", "arcaniste", 0, 5, -10);
    const lame = sim.spawn("l", "lame", 1, 5, -8, Math.PI);
    sim.combat.setTarget(lame.id, arcaniste.id);
    sim.combat.toggleAttack(lame.id);
    sim.run(2.5, () => lame.has("taunted"));
    assert.equal(lame.getEffect("taunted")?.sourceId, gardien.id);
    sim.run(8);
    assert.ok(lame.has("immuneStun"), "Coup de bouclier");
    assert.ok(gardien.cooldowns.has("shieldBash"));
  });

  it("lance le Cri de ralliement quand deux alliés sont rootés par un sort", () => {
    const sim = new Sim();
    const gardien = sim.spawn("g", "gardien", 0, 5, -10, 0, true);
    const a1 = sim.spawn("a1", "pretre", 0, 7, -10);
    const a2 = sim.spawn("a2", "arcaniste", 0, 3, -10);
    // À 9 m : trop près pour que le Gardien charge l'Arcaniste.
    const arcaniste = sim.spawn("e", "arcaniste", 1, 5, -1, Math.PI);
    sim.combat.useAbility(arcaniste.id, "frostNova");
    sim.run(4, () => gardien.has("magicImmune"));
    // Le root a bien été posé (immunité au root), puis retiré par le cri.
    assert.ok(a1.has("immuneRoot") && a2.has("immuneRoot"), "la Nova de givre devait rooter les deux alliés");
    assert.ok(gardien.has("magicImmune"), "pas de Cri de ralliement");
    assert.ok(!a1.has("root") && !a2.has("root") && a1.has("magicImmune"));
  });

  it("lève le Rempart quand trois combattants de mêlée assaillent le groupe", () => {
    const sim = new Sim();
    const gardien = sim.spawn("g", "gardien", 0, 5, -10, 0, true);
    const pretre = sim.spawn("p", "pretre", 0, 5, -14);
    for (const [i, x] of [4, 5, 6].entries()) {
      const lame = sim.spawn(`l${i}`, "lame", 1, x, -12.5, Math.PI);
      sim.combat.setTarget(lame.id, pretre.id);
      sim.combat.toggleAttack(lame.id);
    }
    sim.run(2, () => gardien.has("rampart"));
    assert.ok(gardien.has("rampart"));
    assert.ok(pretre.has("meleeImmune"));
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
      // Le Barde peut se buffer en attendant, mais pas encore viser l'ennemi.
      assert.ok(!["aoeMez", "mez", "silence"].includes(barde.state.castAbility), "le bot a réagi instantanément");
      sim.run(5);
      assert.ok(e1.has("mez"), "le bot n'a jamais réagi");
    } finally {
      HUMAN_ERRORS.enabled = false;
    }
  });
});

describe("Bots : ordres", () => {
  it("Soigne-moi : le Prêtre soigne le joueur avant un allié plus blessé", () => {
    const sim = new Sim();
    sim.spawn("p", "pretre", 0, 0, 0, 0, true);
    const joueur = sim.spawn("j", "lame", 0, 5, 0);
    const autre = sim.spawn("o", "barde", 0, -5, 0);
    joueur.state.hp = Math.round(joueur.state.maxHp * 0.7);
    autre.state.hp = Math.round(autre.state.maxHp * 0.5);
    const hp = { joueur: joueur.state.hp, autre: autre.state.hp };
    assert.deepEqual(sim.order("heal", joueur), [{ botId: "p", reply: "heal" }]);
    sim.run(5, () => joueur.state.hp > hp.joueur);
    assert.ok(joueur.state.hp > hp.joueur, "le joueur n'a pas été soigné");
    assert.equal(autre.state.hp, hp.autre);
  });

  it("Soigne-moi à pleine vie, Réveille-moi sans être mezzé : le bot dit pourquoi il n'obéit pas", () => {
    const sim = new Sim();
    sim.spawn("p", "pretre", 0, 0, 0, 0, true);
    sim.spawn("b", "barde", 0, 2, 0, 0, true);
    const joueur = sim.spawn("j", "lame", 0, 5, 0);
    assert.deepEqual(sim.order("heal", joueur), [{ botId: "p", reply: "full" }]);
    assert.deepEqual(sim.order("awaken", joueur), [{ botId: "b", reply: "notMezzed" }]);
  });

  it("J'ai besoin de mana : le Barde passe au Chant de second souffle, puis reprend le Chant de vitesse", () => {
    const sim = new Sim();
    const barde = sim.spawn("b", "barde", 0, 0, 0, 0, true);
    const joueur = sim.spawn("j", "arcaniste", 0, 5, 0);
    sim.run(1);
    assert.equal(barde.state.song, "speedSong");
    joueur.state.mana = 100;
    assert.deepEqual(sim.order("resource", joueur), [{ botId: "b", reply: "resource" }]);
    // Le Barde finit d'abord l'incantation en cours (Buff dextérité sur le joueur).
    sim.run(4, () => barde.state.song === "secondWind");
    assert.equal(barde.state.song, "secondWind");
    joueur.state.mana = joueur.state.maxMana;
    sim.run(4, () => barde.state.song === "speedSong");
    assert.equal(barde.state.song, "speedSong");
  });

  it("Protège-moi : le Gardien garde le joueur plutôt qu'un lanceur de sorts", () => {
    const sim = new Sim();
    const gardien = sim.spawn("g", "gardien", 0, 0, 0, 0, true);
    sim.spawn("a", "arcaniste", 0, 1, 0);
    const joueur = sim.spawn("j", "lame", 0, 6, 0);
    assert.deepEqual(sim.order("protect", joueur), [{ botId: "g", reply: "protect" }]);
    sim.run(5, () => joueur.getEffect("guarded")?.sourceId === gardien.id);
    assert.equal(joueur.getEffect("guarded")?.sourceId, gardien.id);
  });

  it("Assistez-moi : les Lames attaquent la cible du joueur, pas leur cible préférée ; sans cible, « quelle cible ? »", () => {
    const sim = new Sim();
    const lame = sim.spawn("l", "lame", 0, 0, 0, 0, true);
    const joueur = sim.spawn("j", "arcaniste", 0, 1, 0);
    sim.spawn("e1", "barde", 1, -3, 12);
    const gardien = sim.spawn("e2", "gardien", 1, 3, 12);
    assert.deepEqual(sim.order("assist", joueur), [{ botId: "l", reply: "noTarget" }]);
    sim.combat.setTarget(joueur.id, gardien.id);
    assert.deepEqual(sim.order("assist", joueur), [{ botId: "l", reply: "assist" }]);
    sim.run(2);
    assert.equal(lame.targetId, gardien.id);
  });

  it("Suivez-moi : les bots suivent le joueur, et l'ordre cesse au premier ennemi aperçu", () => {
    const sim = new Sim();
    const lame = sim.spawn("l", "lame", 0, 0, 0, 0, true);
    const joueur = sim.spawn("j", "barde", 0, 0, 2);
    assert.deepEqual(sim.order("follow", joueur), [{ botId: "l", reply: "follow" }]);
    joueur.state.x += 12;
    sim.run(5);
    assert.ok(distance(lame.state, joueur.state) <= 5.5, `Lame à ${distance(lame.state, joueur.state).toFixed(1)} m`);
    sim.spawn("e", "arcaniste", 1, 12, 14);
    sim.run(1);
    assert.equal(sim.bots[0].order, null);
  });

  it("Suivez-moi : un Prêtre suit encore le joueur après plus de 10 s sans ennemi", () => {
    const sim = new Sim();
    const pretre = sim.spawn("p", "pretre", 0, 0, 0, 0, true);
    const joueur = sim.spawn("j", "lame", 0, 0, 2);
    sim.order("follow", joueur);
    sim.run(12);
    joueur.state.x += 12;
    sim.run(5);
    assert.ok(distance(pretre.state, joueur.state) <= 5.5, `Prêtre à ${distance(pretre.state, joueur.state).toFixed(1)} m`);
  });

  it("Réveille-moi : le Barde mezzé ne répond pas, le Barde libre suivant obéit", () => {
    const sim = new Sim();
    const proche = sim.spawn("b1", "barde", 0, 1, 0, 0, true);
    sim.spawn("b2", "barde", 0, 6, 0, 0, true);
    const joueur = sim.spawn("j", "lame", 0, 0, 2);
    const mez = (p: PlayerRuntime) => (sim.combat as unknown as { addEffect(p: PlayerRuntime, kind: string, duration: number, sourceId: string): void }).addEffect(p, "mez", 10, "x");
    mez(proche);
    mez(joueur);
    assert.deepEqual(sim.order("awaken", joueur), [{ botId: "b2", reply: "awaken" }]);
  });

  it("Buff please : chaque Prêtre et chaque Barde lance les buffs qui manquent au joueur", () => {
    const sim = new Sim();
    sim.spawn("p", "pretre", 0, 0, 0, 0, true);
    sim.spawn("b", "barde", 0, 2, 0, 0, true);
    const joueur = sim.spawn("j", "lame", 0, 5, 0);
    joueur.effects = joueur.effects.filter((e) => !e.kind.startsWith("buff"));
    const replies = sim.order("buff", joueur).map((r) => r.reply);
    assert.deepEqual(replies.sort(), ["buff", "buff"]);
    sim.run(10, () => joueur.has("buffHp") && joueur.has("buffStrength") && joueur.has("buffDexterity"));
    assert.ok(joueur.has("buffHp") && joueur.has("buffStrength") && joueur.has("buffDexterity"));
  });
});
