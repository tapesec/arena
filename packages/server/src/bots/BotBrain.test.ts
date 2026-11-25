import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLASSES, MELEE_RANGE, START_ZONES, distance, spawnPosition, type ClassId, type OrderId } from "@arena/shared";
import { CombatSystem } from "../CombatSystem";
import { PlayerRuntime, initVitals } from "../PlayerRuntime";
import { PlayerState } from "../state";
import { computeTeamVisibility } from "../visibility";
import { HUMAN_ERRORS, type BotBrain } from "./BotBrain";
import { createBotBrain } from "./classBots";
import { pickBotClass } from "./composition";
import { dispatchOrder, followHumansAtStart } from "./orders";
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
    initVitals(state, classDef);
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

  it("un Prêtre qui incante va au bout même avec une Lame au contact qui ne frappe pas", () => {
    const sim = new Sim();
    const pretre = sim.spawn("p", "pretre", 0, 5, 0, 0, true);
    const ally = sim.spawn("x", "gardien", 0, 8, 0);
    ally.state.hp = 600;
    sim.run(0.6);
    assert.ok(pretre.state.castAbility, "le soin est en cours");
    sim.spawn("l", "lame", 1, 5, 1.5, Math.PI); // au contact, sans attaque automatique
    const interrupts: string[] = [];
    (sim.combat as unknown as { out: { broadcast: (t: string, m: unknown) => void } }).out.broadcast = (t, m) => {
      if (t === "interrupt") interrupts.push((m as { reason: string }).reason);
    };
    sim.run(2.2);
    assert.ok(!interrupts.includes("move"), `interrompu par le mouvement : ${interrupts}`);
    assert.ok(ally.state.hp > 600, "le soin est parti");
  });

  it("un Arcaniste ne lance pas la Déflagration au contact de la mêlée sans protection : il s'éloigne", () => {
    const sim = new Sim();
    const arcaniste = sim.spawn("a", "arcaniste", 0, 5, 0, 0, true);
    arcaniste.cooldowns.set("concentration", 999);
    arcaniste.cooldowns.set("frostNova", 999);
    const lame = sim.spawn("l", "lame", 1, 5, 2, Math.PI);
    sim.spawn("e", "pretre", 1, 7, 2, Math.PI);
    sim.run(0.5);
    assert.notEqual(arcaniste.state.castAbility, "blast");
    sim.run(1.5);
    assert.ok(distance(arcaniste.state, lame.state) > 5, `encore à ${distance(arcaniste.state, lame.state).toFixed(1)} m`);
  });

  it("un Arcaniste lance la Déflagration sans protection contre deux lanceurs au contact", () => {
    const sim = new Sim();
    const arcaniste = sim.spawn("a", "arcaniste", 0, 5, 0, 0, true);
    arcaniste.cooldowns.set("frostNova", 999);
    sim.spawn("e1", "pretre", 1, 5, 2, Math.PI);
    sim.spawn("e2", "barde", 1, 7, 2, Math.PI);
    sim.run(0.5);
    assert.equal(arcaniste.state.castAbility, "blast");
    assert.ok(!arcaniste.castProtected, "Concentration gardée (moins de 3 ennemis)");
  });

  it("un Arcaniste protège la Déflagration par Concentration face à trois ennemis dont la mêlée", () => {
    const sim = new Sim();
    const arcaniste = sim.spawn("a", "arcaniste", 0, 5, 0, 0, true);
    arcaniste.cooldowns.set("frostNova", 999);
    sim.spawn("l", "lame", 1, 5, 2, Math.PI);
    sim.spawn("e1", "pretre", 1, 7, 2, Math.PI);
    sim.spawn("e2", "barde", 1, 3, 2, Math.PI);
    sim.run(0.5);
    assert.equal(arcaniste.state.castAbility, "blast");
    assert.ok(arcaniste.castProtected, "Déflagration sous Concentration");
  });

  it("un Barde chante la vitesse sans ennemi en vue, le second souffle en combat, et la vitesse sur ordre", () => {
    const sim = new Sim();
    const barde = sim.spawn("b", "barde", 0, 5, -20, 0, true);
    const allies = [sim.spawn("x", "lame", 0, 3, -18), sim.spawn("y", "gardien", 0, 7, -18)];
    // Des alliés qui agissent (buffs) sans ennemi en vue : toujours la vitesse.
    sim.run(1, () => (allies.forEach((a) => (a.lastEngagedAt = sim.combat.now)), false));
    assert.equal(barde.state.song, "speedSong");
    // Un ennemi en vue et deux alliés engagés : second souffle.
    sim.spawn("e", "lame", 1, 5, -6, Math.PI);
    sim.run(3, () => (allies.forEach((a) => (a.lastEngagedAt = sim.combat.now)), false));
    assert.equal(barde.state.song, "secondWind");
    // Ordre « vitesse » : Chant de vitesse aussitôt, malgré le combat.
    assert.deepEqual(sim.order("speed", allies[0]), [{ botId: "b", reply: "speed" }]);
    sim.run(3, () => (allies.forEach((a) => (a.lastEngagedAt = sim.combat.now)), false));
    assert.equal(barde.state.song, "speedSong");
  });

  it("un Barde mezze la Lame qui frappe un Prêtre allié", () => {
    const sim = new Sim();
    sim.spawn("b", "barde", 0, 5, -20, 0, true);
    const pretre = sim.spawn("p", "pretre", 0, 5, -10);
    const lame = sim.spawn("l", "lame", 1, 5, -8, Math.PI);
    sim.combat.setTarget(lame.id, pretre.id);
    sim.combat.toggleAttack(lame.id);
    sim.run(3, () => lame.has("mez"));
    assert.ok(lame.has("mez"), "la Lame doit être mezzée");
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
  it("charge la mêlée qui frappe son protégé quand elle est loin", () => {
    const sim = new Sim();
    const gardien = sim.spawn("g", "gardien", 0, 5, -26, 0, true);
    const arcaniste = sim.spawn("a", "arcaniste", 0, 5, -10);
    const lame = sim.spawn("l", "lame", 1, 5, -8, Math.PI);
    sim.combat.setTarget(lame.id, arcaniste.id);
    sim.combat.toggleAttack(lame.id);
    sim.run(3, () => lame.has("stun"));
    assert.ok(lame.has("stun"), "la Charge doit stun la Lame");
    assert.ok(distance(gardien.state, lame.state) <= MELEE_RANGE);
  });

  it("garde le même protégé tant qu'il est attaqué, même si un autre lanceur l'est aussi", () => {
    const sim = new Sim();
    const gardien = sim.spawn("g", "gardien", 0, 8, -12, 0, true);
    const a = sim.spawn("a", "arcaniste", 0, 5, -10);
    const b = sim.spawn("b", "pretre", 0, 11, -10);
    for (const [id, x, victim] of [["l1", 5, a], ["l2", 11, b]] as const) {
      const lame = sim.spawn(id, "lame", 1, x, -8, Math.PI);
      sim.combat.setTarget(lame.id, victim.id);
      sim.combat.toggleAttack(lame.id);
      if (id === "l1") sim.run(1.5);
    }
    assert.equal(a.getEffect("guarded")?.sourceId, gardien.id);
    sim.run(1.5);
    assert.equal(a.getEffect("guarded")?.sourceId, gardien.id, "la Garde reste sur le premier protégé");
  });

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

  it("Début du combat : les bots suivent d'office le chef d'équipe humain, pas ceux d'une équipe sans humain", () => {
    const sim = new Sim();
    const lame = sim.spawn("l", "lame", 0, 0, 0, 0, true);
    const autre = sim.spawn("a", "arcaniste", 0, 3, 0);
    const chef = sim.spawn("j", "barde", 0, 0, 2);
    chef.state.leader = true;
    const adverse = sim.spawn("e", "lame", 1, 30, 0, 0, true);
    // Sim.spawn ne marque pas les bots : à faire ici, l'équipe d'en face n'a que des bots.
    lame.state.isBot = adverse.state.isBot = true;
    followHumansAtStart(sim.bots, sim.combat.players);
    assert.equal(sim.bots[0].order?.issuer, chef);
    assert.equal(sim.bots[1].order, null);
    assert.ok(autre && adverse);
    chef.state.x += 12;
    sim.run(5);
    assert.ok(distance(lame.state, chef.state) <= 5.5, `Lame à ${distance(lame.state, chef.state).toFixed(1)} m`);
  });

  it("Début du combat : une équipe sans humain attend 5 s, puis suit son Gardien qui explore", () => {
    const sim = new Sim();
    const arcaniste = sim.spawn("a", "arcaniste", 0, 0, 0, 0, true);
    const gardien = sim.spawn("g", "gardien", 0, 2, 0, 0, true);
    const lame = sim.spawn("l", "lame", 0, 4, 0, 0, true);
    for (const p of [arcaniste, gardien, lame]) p.state.isBot = true;
    followHumansAtStart(sim.bots, sim.combat.players);
    assert.equal(sim.bots[0].order?.issuer, gardien);
    assert.equal(sim.bots[1].order, null);
    const start = { x: gardien.state.x, z: gardien.state.z };
    sim.run(4.5);
    assert.ok(distance(gardien.state, start) < 0.1, "le chef attend");
    sim.run(5);
    assert.ok(distance(gardien.state, start) > 10, `chef à ${distance(gardien.state, start).toFixed(1)} m du départ`);
    for (const p of [arcaniste, lame]) {
      assert.ok(distance(p.state, gardien.state) <= 7, `${p.classDef.id} à ${distance(p.state, gardien.state).toFixed(1)} m du chef`);
    }
    // Premier ennemi aperçu : le suivi cesse, chacun reprend son comportement.
    sim.spawn("e", "arcaniste", 1, gardien.state.x + 10, gardien.state.z, 0, false, false);
    sim.run(1);
    assert.equal(sim.bots[0].order, null);
    assert.equal(sim.bots[2].order, null);
  });

  it("Début du combat : le suivi d'office cesse si le joueur reste sur place 15 s", () => {
    const sim = new Sim();
    sim.spawn("l", "lame", 0, 0, 0, 0, true).state.isBot = true;
    sim.spawn("j", "barde", 0, 0, 2);
    followHumansAtStart(sim.bots, sim.combat.players);
    sim.run(10);
    assert.equal(sim.bots[0].order?.kind, "follow");
    sim.run(6);
    assert.equal(sim.bots[0].order, null);
  });

  it("Début du combat : le délai de 15 s repart quand le joueur bouge", () => {
    const sim = new Sim();
    sim.spawn("l", "lame", 0, 0, 0, 0, true).state.isBot = true;
    const joueur = sim.spawn("j", "barde", 0, 0, 2);
    followHumansAtStart(sim.bots, sim.combat.players);
    sim.run(10);
    joueur.state.x += 3;
    sim.run(10);
    assert.equal(sim.bots[0].order?.kind, "follow");
  });

  it("Début du combat : après un ordre ponctuel, le bot reprend le suivi d'office", () => {
    const sim = new Sim();
    const pretre = sim.spawn("p", "pretre", 0, 0, 0, 0, true);
    pretre.state.isBot = true;
    const joueur = sim.spawn("j", "lame", 0, 0, 2);
    followHumansAtStart(sim.bots, sim.combat.players);
    assert.deepEqual(sim.order("buff", joueur), [{ botId: "p", reply: "buff" }]);
    sim.run(6);
    assert.equal(sim.bots[0].order?.kind, "follow");
    assert.equal(sim.bots[0].order?.automatic, true);
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

  it("Besoin de vitesse : le Barde qui chante déjà la vitesse laisse l'ordre à celui qui chante le second souffle", () => {
    const sim = new Sim();
    const proche = sim.spawn("b1", "barde", 0, 1, 0, 0, true);
    const loin = sim.spawn("b2", "barde", 0, 6, 0, 0, true);
    const joueur = sim.spawn("j", "lame", 0, 0, 2);
    proche.state.song = "speedSong";
    loin.state.song = "secondWind";
    assert.deepEqual(sim.order("speed", joueur), [{ botId: "b2", reply: "speed" }]);
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
