import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  BACKWARD_SPEED_FACTOR,
  ENDURANCE_REGEN,
  facingTowards,
  MANA_REGEN,
  CLASSES,
  MOVE_SPEED,
  NO_INPUT,
  STICK_DISTANCE,
  maxResource,
  type ClassId,
  type CombatEvent,
  type InterruptEvent,
  type KillEvent,
  type MoveInput,
} from "@arena/shared";
import { CombatSystem } from "./CombatSystem";
import { PlayerRuntime } from "./PlayerRuntime";
import { PlayerState } from "./state";

const DT = 0.05;

// Décalage appliqué à toutes les positions : la zone ouverte de l'arène (sans obstacle ni relief),
// autour de (37, 10).
const OFFSET_X = 28;

// Monde de test : système de combat sans réseau, avec un hasard contrôlé.
class World {
  combat: CombatSystem;
  events: CombatEvent[] = [];
  interrupts: InterruptEvent[] = [];
  kills: KillEvent[] = [];
  errors: { id: string; code: string; abilityId?: string }[] = [];
  // Valeurs renvoyées par le générateur aléatoire ; 0.99 par défaut = aucun blocage, esquive ou critique.
  rolls: number[] = [];

  constructor() {
    this.combat = new CombatSystem(
      {
        broadcast: (type, message) => {
          if (type === "combat") this.events.push(message as CombatEvent);
          if (type === "interrupt") this.interrupts.push(message as InterruptEvent);
        },
        sendTo: (id, type, message) => {
          if (type === "error") this.errors.push({ id, ...(message as { code: string; abilityId?: string }) });
        },
        announce: (type, message) => {
          if (type === "kill") this.kills.push(message as KillEvent);
        },
      },
      () => this.rolls.shift() ?? 0.99,
    );
  }

  // facing : 0 regarde vers +z, π vers -z.
  spawn(id: string, classId: ClassId, team: number, x: number, z: number, facing = 0): PlayerRuntime {
    // Les compétences à débloquer sont testées aussi : le joueur de test les a toutes.
    const base = CLASSES[classId];
    const classDef = { ...base, abilities: [...base.abilities, ...(base.unlockable ?? [])] };
    const state = new PlayerState();
    state.team = team;
    state.classId = classId;
    state.x = x + OFFSET_X;
    state.z = z;
    state.facing = facing;
    state.hp = state.maxHp = classDef.maxHp;
    if (classDef.resource === "mana") state.mana = state.maxMana = maxResource("mana");
    else state.endurance = state.maxEndurance = maxResource("endurance");
    const player = new PlayerRuntime(id, state, classDef);
    this.combat.add(player);
    return player;
  }

  run(seconds: number) {
    for (let t = 0; t < seconds - 1e-9; t += DT) this.combat.tick(DT);
  }

  cast(caster: PlayerRuntime, abilityId: string, target?: PlayerRuntime) {
    if (target) this.combat.setTarget(caster.id, target.id);
    this.combat.useAbility(caster.id, abilityId);
  }

  eventsOf(kind: CombatEvent["kind"]) {
    return this.events.filter((e) => e.kind === kind);
  }
}

let world: World;
beforeEach(() => {
  world = new World();
});

describe("Gardien", () => {
  it("Coup de bouclier étourdit 2 s, puis immunise contre le stun", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 2, Math.PI);
    world.cast(gardien, "shieldBash", enemy);
    assert.ok(enemy.has("stun"));
    world.run(2.1);
    assert.ok(!enemy.has("stun"));
    assert.ok(enemy.has("immuneStun"));
    // Après la recharge (10 s), le Coup de bouclier part au prochain coup d'arme.
    world.run(8);
    world.cast(gardien, "shieldBash", enemy);
    world.run(2);
    assert.equal(world.eventsOf("immune").length, 1);
  });

  it("un blocage au bouclier arrête l'attaque entière : le Coup de bouclier ne stun pas", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const enemy = world.spawn("e", "gardien", 1, 0, 2, Math.PI);
    world.rolls = [0];
    world.cast(enemy, "shieldBash", gardien);
    assert.equal(world.eventsOf("blocked").length, 1);
    assert.ok(!gardien.has("stun"));
  });

  it("un blocage au bouclier arrête l'attaque de flanc en entier : ni dégâts ni ralentissement", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 1.5, 0, -Math.PI / 2);
    world.rolls = [0];
    world.cast(lame, "flankStrike", gardien);
    assert.equal(world.eventsOf("blocked").length, 1);
    assert.equal(gardien.state.hp, gardien.state.maxHp);
    assert.ok(!gardien.has("snare"));
  });

  it("un blocage par la Garde arrête aussi l'attaque entière", () => {
    const gardien = world.spawn("g", "gardien", 0, 1, 0);
    const pretre = world.spawn("p", "pretre", 0, 0, 0, 0);
    const enemy = world.spawn("e", "gardien", 1, 0, 2, Math.PI);
    world.cast(gardien, "guard", pretre);
    world.rolls = [0];
    world.cast(enemy, "shieldBash", pretre);
    assert.equal(world.eventsOf("blocked").length, 1);
    assert.ok(!pretre.has("stun"));
  });

  it("une attaque esquivée est évitée en entier : ni dégâts ni ralentissement", () => {
    const lameA = world.spawn("a", "lame", 0, 0, 0, 0);
    const lameB = world.spawn("b", "lame", 1, 1.5, 0, -Math.PI / 2);
    world.cast(lameA, "evasion");
    world.rolls = [0];
    world.cast(lameB, "flankStrike", lameA);
    assert.equal(world.eventsOf("evaded").length, 1);
    assert.equal(lameA.state.hp, lameA.state.maxHp);
    assert.ok(!lameA.has("snare"));
  });

  it("un Gardien stun ne bloque plus au bouclier", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const enemy = world.spawn("e", "gardien", 1, 0, 2, Math.PI);
    // Sur le côté du Gardien, tournée vers lui.
    const lame = world.spawn("l", "lame", 1, 1.5, 0, -Math.PI / 2);
    world.cast(enemy, "shieldBash", gardien);
    assert.ok(gardien.has("stun"));
    // Tirages à 0 : un Gardien libre bloquerait ce coup à coup sûr.
    world.rolls = [0, 0, 0, 0];
    world.cast(lame, "flankStrike", gardien);
    assert.equal(world.eventsOf("blocked").length, 0);
    assert.ok(world.eventsOf("damage").some((e) => e.targetId === "g"));
  });

  it("le stun n'est pas cassé par les dégâts", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    // Une Lame alliée dans le dos de l'ennemi (il regarde vers -z).
    const lame = world.spawn("l", "lame", 0, 0, 4, Math.PI);
    const enemy = world.spawn("e", "lame", 1, 0, 2, Math.PI);
    world.cast(gardien, "shieldBash", enemy);
    world.cast(lame, "backstab", enemy);
    assert.ok(world.eventsOf("damage").some((e) => e.targetId === "e" && e.abilityId === "backstab"));
    assert.ok(enemy.has("stun"));
  });

  it("la Garde bloque un coup de mêlée visant l'allié protégé", () => {
    const gardien = world.spawn("g", "gardien", 0, 1, 0);
    const pretre = world.spawn("p", "pretre", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 0, -2, 0); // dans le dos du Prêtre
    world.cast(gardien, "guard", pretre);
    assert.ok(pretre.has("guarded"));
    world.rolls = [0.1]; // jet de garde réussi
    world.cast(lame, "backstab", pretre);
    assert.equal(world.eventsOf("blocked")[0]?.detail, "g");
    assert.equal(pretre.state.hp, pretre.state.maxHp);
  });

  it("l'Interception redirige le prochain coup vers le Gardien", () => {
    const gardien = world.spawn("g", "gardien", 0, 1, 0);
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0);
    const enemy = world.spawn("e", "arcaniste", 1, 0, 10, Math.PI);
    world.cast(gardien, "intercept", arcaniste);
    world.cast(enemy, "firebolt", arcaniste);
    world.run(2.6);
    assert.equal(arcaniste.state.hp, arcaniste.state.maxHp);
    assert.equal(gardien.state.hp, gardien.state.maxHp - 250);
    assert.ok(!arcaniste.has("intercept"));
  });
});

describe("Arcaniste", () => {
  it("Déflagration frappe les ennemis autour du lanceur, sans cible, plus fort au centre", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const close = world.spawn("c", "lame", 1, 0, 0.5);
    const edge = world.spawn("e", "lame", 1, 0, -6.5);
    const far = world.spawn("f", "lame", 1, 8, 0);
    const ally = world.spawn("x", "pretre", 0, 1, 0);
    world.cast(arcaniste, "blast");
    world.run(2.1);
    const lost = (p: typeof close) => p.state.maxHp - p.state.hp;
    // 450 au centre, 100 au bord (7 m) : 0,5 m → 425, 6,5 m → 125.
    assert.equal(lost(close), 425);
    assert.equal(lost(edge), 125);
    assert.equal(lost(far), 0);
    assert.equal(lost(ally), 0);
  });

  it("la Bulle se lance sur soi, absorbe un coup de mêlée puis disparaît sans se reformer", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 0, -2, 0);
    world.run(1);
    assert.ok(!arcaniste.has("bubble"), "pas de bulle d'office");
    world.cast(arcaniste, "bubble");
    world.run(2.1);
    assert.ok(arcaniste.has("bubble"));
    world.cast(lame, "backstab", arcaniste);
    assert.equal(world.eventsOf("absorbed").length, 1);
    assert.equal(arcaniste.state.hp, arcaniste.state.maxHp);
    world.run(12);
    assert.ok(!arcaniste.has("bubble"), "pas de reformation automatique");
  });

  it("la Bulle ne protège pas des sorts et n'est pas consommée par eux", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const enemy = world.spawn("e", "arcaniste", 1, 0, 15, Math.PI);
    world.cast(arcaniste, "bubble");
    world.run(2.1);
    world.cast(enemy, "firebolt", arcaniste);
    world.run(2.6);
    assert.ok(arcaniste.state.hp < arcaniste.state.maxHp, "le Trait de feu touche");
    assert.ok(arcaniste.has("bubble"), "la bulle reste");
  });

  it("une bulle cassée au corps à corps n'interrompt pas l'incantation", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 0, -2, 0);
    const enemy = world.spawn("e", "pretre", 1, 0, 15, Math.PI);
    world.cast(arcaniste, "bubble");
    world.run(2.1);
    world.cast(arcaniste, "firebolt", enemy);
    world.run(0.5);
    world.cast(lame, "backstab", arcaniste);
    // La technique a activé l'attaque de la Lame : on la coupe, ses coups suivants interrompraient le sort.
    world.combat.toggleAttack(lame.id);
    assert.equal(world.eventsOf("absorbed").length, 1);
    assert.equal(arcaniste.state.castAbility, "firebolt");
    assert.equal(world.interrupts.length, 0);
    world.run(2.1);
    assert.ok(world.eventsOf("damage").some((e) => e.targetId === "e" && e.abilityId === "firebolt"));
  });

  it("la Bulle arrête le Coup de bouclier : pas de stun, la bulle casse", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const gardien = world.spawn("g", "gardien", 1, 0, 2, Math.PI);
    world.cast(arcaniste, "bubble");
    world.run(2.1);
    world.cast(gardien, "shieldBash", arcaniste);
    assert.equal(world.eventsOf("absorbed").length, 1);
    assert.ok(!arcaniste.has("stun"));
    assert.ok(!arcaniste.has("bubble"));
  });

  it("la Bulle arrête l'attaque de flanc en entier : ni dégâts ni ralentissement", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    // Sur le côté de l'Arcaniste, tournée vers elle.
    const lame = world.spawn("l", "lame", 1, 1.5, 0, -Math.PI / 2);
    world.cast(arcaniste, "bubble");
    world.run(2.1);
    world.cast(lame, "flankStrike", arcaniste);
    assert.equal(world.eventsOf("absorbed").length, 1);
    assert.equal(arcaniste.state.hp, arcaniste.state.maxHp);
    assert.ok(!arcaniste.has("snare"));
  });

  it("la Bulle ne se lance que sur l'Arcaniste", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const ally = world.spawn("x", "pretre", 0, 3, 0);
    world.cast(arcaniste, "bubble", ally);
    world.run(2.1);
    assert.ok(arcaniste.has("bubble"));
    assert.ok(!ally.has("bubble"));
  });

  it("Trait de givre : 150 dégâts et snare magique de 4 s", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "frostbolt", lame);
    world.run(2.05);
    assert.equal(lame.state.hp, lame.state.maxHp - 150);
    const snare = lame.getEffect("snare");
    assert.ok(snare?.magic, "snare magique (le Cri de ralliement le retire)");
    assert.ok(Math.abs(snare!.remaining - 4) < 0.1);
  });

  it("Brûlure : 40 dégâts par seconde pendant 10 s, sans interrompre l'incantation", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const pretre = world.spawn("p", "pretre", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "burn", pretre);
    world.run(2.05);
    assert.ok(pretre.has("burning"));
    assert.equal(pretre.state.hp, pretre.state.maxHp);
    world.cast(pretre, "heal", pretre);
    world.run(1.6);
    assert.ok(pretre.state.castAbility === "heal" || world.eventsOf("heal").length > 0, "le soin n'est pas interrompu");
    assert.equal(world.interrupts.length, 0);
    world.run(10);
    const ticks = world.eventsOf("damage").filter((e) => e.abilityId === "burn");
    assert.equal(ticks.length, 10);
    assert.ok(ticks.every((e) => e.amount === 40));
    assert.ok(!pretre.has("burning"));
  });

  it("Brûlure : un tic libère du root", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "frostNova");
    world.run(1.55);
    assert.ok(lame.has("root"));
    world.cast(arcaniste, "burn", lame);
    world.run(3.1);
    assert.ok(!lame.has("root"));
  });

  it("Nova de givre : root 12 s sur les ennemis à 15 m, sans cible", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const near = world.spawn("n", "lame", 1, 0, 14);
    const far = world.spawn("f", "lame", 1, 0, -16);
    world.cast(arcaniste, "frostNova");
    world.run(1.55);
    assert.ok(Math.abs(near.getEffect("root")!.remaining - 12) < 0.1);
    assert.ok(!far.has("root"));
  });

  it("Near sight : portée des sorts réduite de 75 %, l'incantation en cours échoue hors de portée ; pas un contrôle magique", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const enemy = world.spawn("e", "arcaniste", 1, 0, 10, Math.PI);
    const gardien = world.spawn("g", "gardien", 1, 1, 10);
    world.cast(gardien, "rallyCry");
    world.cast(enemy, "firebolt", arcaniste);
    world.cast(arcaniste, "nearSight", enemy);
    world.run(1.55);
    assert.ok(enemy.has("nearSight"), "le Cri de ralliement n'en protège pas");
    world.run(0.5);
    assert.equal(arcaniste.state.hp, arcaniste.state.maxHp, "le Trait de feu échoue à 10 m (portée 7,5 m)");
    assert.ok(world.errors.some((e) => e.id === "e" && e.code === "outOfRangeNearSight"));
    world.cast(enemy, "firebolt", arcaniste);
    world.run(0.1);
    assert.equal(enemy.state.castAbility, "");
    world.run(15);
    assert.ok(!enemy.has("nearSight"));
  });

  it("Puissance arcanique : tous les sorts de dégâts sont critiques pendant 15 s", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "arcanePower");
    world.cast(arcaniste, "firebolt", lame);
    world.run(2.05);
    const hit = world.eventsOf("damage").find((e) => e.abilityId === "firebolt");
    assert.equal(hit?.amount, 375);
    assert.ok(hit?.crit);
    world.run(15);
    assert.ok(!arcaniste.has("arcanePower"));
  });
});

describe("Annonce des éliminations", () => {
  it("annonce la victime, le tueur et la compétence, et le dernier survivant de l'équipe", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    pretre.state.name = "Kerra";
    world.spawn("g", "gardien", 0, 6, 0).state.name = "Hald";
    const lame = world.spawn("l", "lame", 1, 0, -2);
    lame.state.name = "Lorcan";
    pretre.state.hp = 1;
    world.cast(lame, "backstab", pretre);
    assert.ok(!pretre.alive);
    assert.deepEqual(world.kills, [
      {
        victimId: "p",
        victimName: "Kerra",
        victimTeam: 0,
        killerId: "l",
        killerName: "Lorcan",
        killerTeam: 1,
        abilityId: "backstab",
        lastStanding: "Hald",
      },
    ]);
  });
});

describe("Prêtre", () => {
  it("le buff de vie disparaît à la mort du Prêtre", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const lame = world.spawn("l", "lame", 0, 1, 0);
    world.cast(pretre, "buffHp", lame);
    world.run(2.1);
    assert.equal(lame.state.maxHp, 1500);
    pretre.state.hp = 1;
    const enemy = world.spawn("e", "lame", 1, 0, 2, Math.PI);
    world.cast(enemy, "backstab", pretre); // de face : refusé
    assert.equal(world.errors.at(-1)!.code, "needBack");
    enemy.state.x = OFFSET_X;
    enemy.state.z = -2;
    enemy.state.facing = 0;
    world.cast(enemy, "backstab", pretre);
    assert.ok(!pretre.alive);
    assert.equal(lame.state.maxHp, 1300);
  });

  it("la Résurrection relève un allié à 50 % de vie, sans buff", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const ally = world.spawn("x", "lame", 0, 3, 0);
    world.cast(pretre, "buffStrength", ally);
    world.run(2.1);
    ally.state.hp = 0;
    (world.combat as unknown as { handleDeath(p: PlayerRuntime): void }).handleDeath(ally);
    world.cast(pretre, "resurrect", ally);
    world.run(4.1);
    assert.equal(ally.state.hp, 650);
    assert.ok(!ally.has("buffStrength"));
  });

  it("le Soin sans allié ciblé soigne le Prêtre lui-même", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    pretre.state.hp = 500;
    world.cast(pretre, "heal");
    world.run(2.1);
    assert.equal(pretre.state.hp, 800);
  });

  it("le Soin de groupe répartit 900 PV selon les PV manquants, Prêtre compris, à 30 m", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const a = world.spawn("a", "lame", 0, 5, 0);
    const b = world.spawn("b", "gardien", 0, -5, 0);
    const far = world.spawn("f", "lame", 0, 0, 31);
    pretre.state.hp = pretre.state.maxHp - 300;
    a.state.hp = a.state.maxHp - 600;
    b.state.hp = b.state.maxHp - 900;
    far.state.hp = 100;
    world.cast(pretre, "groupHeal");
    world.run(3.1);
    // 1800 PV manquants pour 900 : chacun en récupère la moitié.
    assert.equal(pretre.state.maxHp - pretre.state.hp, 150);
    assert.equal(a.state.maxHp - a.state.hp, 300);
    assert.equal(b.state.maxHp - b.state.hp, 450);
    assert.equal(far.state.hp, 100);
  });

  it("le Soin de groupe ne soigne pas au-delà du maximum : le surplus est perdu", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const a = world.spawn("a", "lame", 0, 5, 0);
    a.state.hp = a.state.maxHp - 200;
    world.cast(pretre, "groupHeal");
    world.run(3.1);
    assert.equal(a.state.hp, a.state.maxHp);
    assert.equal(pretre.state.hp, pretre.state.maxHp);
  });

  it("le Renouveau soigne 50 PV par seconde pendant 10 s, repart de zéro relancé et se cumule entre Prêtres", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const autre = world.spawn("q", "pretre", 0, 0, 2);
    const ally = world.spawn("x", "gardien", 0, 3, 0);
    ally.state.hp = 100;
    world.cast(pretre, "renew", ally);
    world.run(2.05);
    assert.equal(ally.effects.filter((e) => e.kind === "renew").length, 1);
    world.run(3);
    assert.equal(ally.state.hp, 250);
    // Relancé par le même Prêtre : toujours un seul Renouveau, qui repart de zéro.
    world.cast(pretre, "renew", ally);
    world.run(2.05);
    assert.equal(ally.effects.filter((e) => e.kind === "renew").length, 1);
    assert.equal(ally.state.hp, 350);
    world.cast(autre, "renew", ally);
    world.run(2.05);
    assert.equal(ally.effects.filter((e) => e.kind === "renew").length, 2);
    world.run(10);
    assert.equal(ally.effects.filter((e) => e.kind === "renew").length, 0);
  });

  it("un tic du Renouveau sur une cible pleine n'émet pas de soin à 0", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const ally = world.spawn("x", "gardien", 0, 3, 0);
    ally.state.hp = ally.state.maxHp - 75;
    world.cast(pretre, "renew", ally);
    world.run(10.1);
    const ticks = world.eventsOf("heal").filter((e) => e.abilityId === "renew");
    assert.deepEqual(
      ticks.map((e) => e.amount),
      [50, 25],
    );
    assert.equal(ally.state.hp, ally.state.maxHp);
  });

  it("le Soin de groupe annonce aussi les alliés pleins de la zone, à 0", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    world.spawn("a", "lame", 0, 5, 0);
    world.cast(pretre, "groupHeal");
    world.run(3.1);
    const heals = world.eventsOf("heal").filter((e) => e.abilityId === "groupHeal");
    assert.deepEqual(heals.map((e) => [e.targetId, e.amount]).sort(), [
      ["a", 0],
      ["p", 0],
    ]);
  });

  it("le Buff de puissance augmente de 15 % les dégâts des sorts et les soins", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const arcaniste = world.spawn("a", "arcaniste", 0, 2, 0);
    const enemy = world.spawn("e", "lame", 1, 2, 10, Math.PI);
    world.cast(pretre, "buffStrength", arcaniste);
    world.run(2.1);
    world.cast(pretre, "buffStrength", pretre);
    world.run(2.1);
    world.cast(arcaniste, "firebolt", enemy);
    world.run(2.1);
    assert.equal(world.eventsOf("damage").at(-1)?.amount, Math.round(250 * 1.15));
    arcaniste.state.hp = 100;
    world.cast(pretre, "heal", arcaniste);
    world.run(2.1);
    assert.equal(arcaniste.state.hp, 100 + 345);
  });

  it("l'Intervention divine relève les alliés morts à 30 m, à 50 % de vie", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    world.cast(pretre, "divineIntervention");
    assert.equal(world.errors.at(-1)?.code, "noDeadAllyInRange");
    const near = world.spawn("n", "lame", 0, 10, 0);
    const far = world.spawn("f", "lame", 0, 0, 31);
    const kill = (p: PlayerRuntime) => {
      p.state.hp = 0;
      (world.combat as unknown as { handleDeath(p: PlayerRuntime): void }).handleDeath(p);
    };
    kill(near);
    kill(far);
    world.cast(pretre, "divineIntervention");
    world.run(5.1);
    assert.equal(near.state.hp, near.state.maxHp / 2);
    assert.equal(far.state.hp, 0);
  });
});

describe("Barde", () => {
  it("le Mez de zone touche les ennemis dans le rayon et casse au moindre dégât", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const near1 = world.spawn("n1", "lame", 1, 0, 15);
    const near2 = world.spawn("n2", "lame", 1, 3, 15);
    const far = world.spawn("f", "lame", 1, 0, 25.5);
    world.cast(barde, "aoeMez", near1);
    world.run(2.1);
    assert.ok(near1.has("mez") && near2.has("mez"));
    assert.ok(!far.has("mez"));

    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 5, 0);
    world.cast(arcaniste, "firebolt", near1);
    world.run(2.6);
    assert.ok(!near1.has("mez") && near1.has("immuneMez"));
    assert.ok(near2.has("mez"));
    world.run(7.4);
    assert.ok(!near2.has("mez"), "mez de 10 s");
  });

  it("le Réveil retire le mez d'un allié et laisse l'immunité, pas le stun", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0);
    const ally = world.spawn("x", "lame", 0, 3, 0);
    const enemy = world.spawn("e", "barde", 1, 3, 15, Math.PI);
    world.cast(enemy, "mez", ally);
    world.run(2.1);
    assert.ok(ally.has("mez"));
    barde.state.mana = 500;
    world.cast(barde, "awaken", ally);
    world.run(1.05);
    assert.ok(!ally.has("mez"));
    assert.ok(ally.has("immuneMez"));
    // Parti de 500 : 50 mana dépensés, plus 1,05 s de régénération.
    assert.ok(Math.abs(barde.state.mana - (500 + MANA_REGEN * 1.05 - 50)) < 1, `50 mana (${barde.state.mana})`);

    const gardien = world.spawn("g", "gardien", 1, 3, 2, Math.PI);
    world.cast(gardien, "shieldBash", ally);
    assert.ok(ally.has("stun"));
    world.cast(barde, "awaken", ally);
    world.run(1.05);
    assert.ok(ally.has("stun"));
  });

  it("Oubli : n'interrompt pas, mais le sort qui finit pendant l'effet n'a aucun effet (mana et recharge dépensés)", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const barde = world.spawn("b", "barde", 1, 0, 10, Math.PI);
    arcaniste.state.mana = 500;
    world.cast(arcaniste, "firebolt", barde);
    world.cast(barde, "silence", arcaniste);
    world.run(1.05);
    assert.ok(arcaniste.has("oblivion"));
    assert.equal(arcaniste.state.castAbility, "firebolt", "pas d'interruption");
    assert.equal(world.interrupts.length, 0);
    world.run(1);
    assert.equal(barde.state.hp, barde.state.maxHp, "le sort oublié ne fait rien");
    // Parti de 500 : 100 mana dépensés, plus 2,05 s de régénération.
    assert.ok(Math.abs(arcaniste.state.mana - (500 + MANA_REGEN * 2.05 - 100)) < 1, `mana dépensé (${arcaniste.state.mana})`);
    assert.ok(!arcaniste.has("oblivion"), "consommé au premier sort");
    world.cast(arcaniste, "firebolt", barde);
    world.run(2.05);
    assert.equal(barde.state.hp, barde.state.maxHp - 250, "le sort suivant part");
  });

  it("Oubli : une compétence instantanée est aussi oubliée (recharge lancée), pas une technique", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const barde = world.spawn("b", "barde", 1, 0, 10, Math.PI);
    world.cast(barde, "silence", arcaniste);
    world.run(1.05);
    world.cast(arcaniste, "arcanePower");
    assert.ok(!arcaniste.has("arcanePower"));
    assert.ok(arcaniste.cooldowns.has("arcanePower"));
    assert.ok(!arcaniste.has("oblivion"));

    const lame = world.spawn("l", "lame", 0, 0, 8, 0);
    world.cast(barde, "silence", lame);
    world.run(1.05);
    world.cast(lame, "sprint");
    assert.ok(lame.has("sprint"), "compétence d'endurance non touchée");
    assert.ok(lame.has("oblivion"));
  });

  it("Oubli : le Cri de ralliement en protège", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const barde = world.spawn("b", "barde", 1, 0, 10, Math.PI);
    world.cast(gardien, "rallyCry");
    world.cast(barde, "silence", gardien);
    world.run(1.05);
    assert.ok(!gardien.has("oblivion"));
  });

  it("un personnage mezzé ne peut ni bouger ni agir", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 0, 10, Math.PI);
    world.cast(barde, "mez", lame);
    world.run(2.1);
    world.combat.setInput(lame.id, { up: true, down: false, left: false, right: false });
    world.run(1);
    assert.equal(lame.state.z, 10);
    world.cast(lame, "rage");
    assert.equal(world.errors.at(-1)?.code, "incapacitated");
  });

  it("chants : 50 mana à l'activation, un seul à la fois, couper est gratuit, pas coupés par les attaques", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const ally = world.spawn("x", "lame", 0, 5, 0);
    world.cast(barde, "speedSong");
    assert.equal(barde.state.mana, barde.state.maxMana - 50);
    world.run(DT);
    assert.ok(ally.has("speed"));
    const enemy = world.spawn("e", "arcaniste", 1, 0, 10, Math.PI);
    world.cast(enemy, "firebolt", barde);
    world.run(2.1);
    assert.ok(barde.state.hp < barde.state.maxHp);
    assert.ok(ally.has("speed"), "le chant ne se tait plus quand le Barde est attaqué");

    world.cast(barde, "secondWind");
    world.run(DT);
    assert.equal(barde.state.song, "secondWind");
    assert.ok(!ally.has("speed") && ally.has("secondWind") && barde.has("secondWind"));
    const mana = barde.state.mana;
    world.cast(barde, "secondWind");
    assert.equal(barde.state.song, "");
    assert.equal(barde.state.mana, mana, "couper le chant est gratuit");
  });

  it("Chant de vitesse : perdu quand le bénéficiaire est touché ou agit, retrouvé après 5 s de calme", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 0, 5, 0);
    const enemy = world.spawn("e", "arcaniste", 1, 5, 12, Math.PI);
    world.cast(barde, "speedSong");
    world.run(DT);
    assert.ok(barde.has("speed"), "lancer son chant n'est pas une action");
    assert.ok(lame.has("speed"));

    world.cast(lame, "evasion");
    world.run(DT);
    assert.ok(!lame.has("speed"), "agir le fait perdre");
    world.run(4.8);
    assert.ok(!lame.has("speed"));
    world.run(0.3);
    assert.ok(lame.has("speed"), "retrouvé après 5 s de calme");

    // Touché par un effet hostile (sans dégâts) : il le perd aussi.
    world.cast(enemy, "nearSight", lame);
    world.run(1.55);
    assert.ok(!lame.has("speed"), "touché par un effet hostile");
    world.combat.setInput(lame.id, { ...NO_INPUT, left: true });
    world.run(0.5);
    world.combat.setInput(lame.id, NO_INPUT);
    world.run(4.6);
    assert.ok(lame.has("speed"), "se déplacer ne compte pas");
    assert.ok(barde.has("speed"));
  });

  it("Chant de second souffle : +50 mana et +5 endurance par seconde aux alliés à 30 m", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 0, 5, 0);
    const far = world.spawn("f", "lame", 0, 0, 31);
    world.cast(barde, "secondWind");
    barde.state.mana = 0;
    lame.state.endurance = far.state.endurance = 0;
    world.run(1);
    assert.ok(Math.abs(barde.state.mana - (MANA_REGEN + 50)) < 1, `mana ${barde.state.mana}`);
    assert.ok(Math.abs(lame.state.endurance - (ENDURANCE_REGEN + 5)) < 0.2, `endurance ${lame.state.endurance}`);
    assert.ok(Math.abs(far.state.endurance - ENDURANCE_REGEN) < 0.2, "hors de portée : régénération de base");
  });

  it("Buff dextérité : coups et incantations 15 % plus rapides, permanent, retiré à la mort du Barde", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 0, 0, 5, 0);
    const arcaniste = world.spawn("a", "arcaniste", 0, 3, 0, 0);
    world.cast(barde, "buffDexterity", lame);
    world.run(2.05);
    world.cast(barde, "buffDexterity", arcaniste);
    world.run(2.05);
    assert.ok(lame.has("buffDexterity") && arcaniste.has("buffDexterity"));
    assert.equal(lame.getEffect("buffDexterity")?.remaining, Infinity);

    const enemy = world.spawn("e", "gardien", 1, 0, 7, Math.PI);
    world.cast(lame, "evasion");
    world.combat.setTarget(lame.id, enemy.id);
    world.combat.toggleAttack(lame.id);
    world.run(DT);
    assert.ok(Math.abs(lame.swingTimer - 2 * 0.85) < DT + 1e-6, `intervalle ${lame.swingTimer}`);

    world.cast(arcaniste, "firebolt", enemy);
    assert.ok(Math.abs(arcaniste.state.castDuration - 2 * 0.85) < 1e-6);

    world.combat.setTarget(enemy.id, barde.id);
    barde.state.hp = 1;
    world.cast(world.spawn("k", "lame", 1, 0, -2, 0), "kick", barde);
    assert.ok(!barde.alive);
    assert.ok(!lame.has("buffDexterity"));
  });

  it("Ballade rythmée : tous les alliés, root et snares retirés puis résistés, perdue en agissant", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const far = world.spawn("f", "lame", 0, 0, 60);
    const rooted = world.spawn("r", "pretre", 0, 4, 0);
    const enemy = world.spawn("e", "arcaniste", 1, 4, 10, Math.PI);
    world.cast(enemy, "freeze", rooted);
    world.run(1.55);
    assert.ok(rooted.has("root"));
    world.cast(barde, "ballad");
    assert.ok(barde.has("ballad") && far.has("ballad") && rooted.has("ballad"), "quelle que soit la distance");
    assert.ok(!rooted.has("root"));
    assert.ok(!enemy.has("ballad"));

    world.cast(enemy, "frostbolt", rooted);
    world.run(2.05);
    assert.ok(!rooted.has("snare"), "snare résisté");
    assert.ok(world.eventsOf("immune").some((e) => e.detail === "mobility"));
    assert.ok(rooted.has("ballad"), "les dégâts ne la retirent pas");

    world.combat.setInput(barde.id, { ...NO_INPUT, up: true });
    const z = barde.state.z;
    world.run(1);
    world.combat.setInput(barde.id, NO_INPUT);
    assert.ok(Math.abs(barde.state.z - z - 2 * MOVE_SPEED) < 0.2, `vitesse × 2 (${barde.state.z - z})`);
    assert.ok(barde.has("ballad"), "se déplacer ne la retire pas");
    world.cast(far, "sprint");
    assert.ok(!far.has("ballad"), "agir la retire");
    world.cast(rooted, "heal");
    assert.ok(!rooted.has("ballad"));
    world.run(8);
    assert.ok(!barde.has("ballad"), "10 s au plus");
  });

  it("Ballade rythmée : perdue quand un sort commencé avant elle part ; couper son chant ne la retire pas", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const pretre = world.spawn("p", "pretre", 0, 3, 0);
    world.cast(barde, "speedSong");
    world.cast(pretre, "heal");
    world.run(0.5);
    world.cast(barde, "ballad");
    assert.ok(pretre.has("ballad"));
    world.run(1.6);
    assert.ok(!pretre.has("ballad"), "le soin est parti");
    world.cast(barde, "speedSong");
    assert.equal(barde.state.song, "");
    assert.ok(barde.has("ballad"));
  });
});

describe("Lame", () => {
  it("l'Attaque de flanc exige d'être sur le côté et ralentit", () => {
    const lame = world.spawn("l", "lame", 0, 2, 0, -Math.PI / 2); // à droite de la cible, tournée vers elle
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "flankStrike", enemy);
    assert.equal(enemy.state.hp, enemy.state.maxHp - 190);
    assert.ok(enemy.has("snare"));
  });

  it("le snare le plus puissant reste jusqu'à la fin de son effet", () => {
    const lame = world.spawn("l", "lame", 0, 2, 0, -Math.PI / 2);
    // Un Barde : il ne bloque pas au bouclier, la technique porte à coup sûr.
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "flankStrike", enemy);
    const snare = enemy.getEffect("snare")!;
    // Un snare plus fort est déjà en place (60 %) : celui de l'Attaque de flanc (40 %) ne le remplace pas.
    snare.value = 0.6;
    world.run(2);
    world.cast(lame, "flankStrike", enemy);
    world.run(DT);
    assert.equal(enemy.getEffect("snare")?.value, 0.6);
    assert.ok(enemy.getEffect("snare")!.remaining < 8 - 1.9, "sa durée n'est pas relancée");
    // Une fois le snare fort terminé, un nouveau snare plus faible s'applique.
    world.run(6.5);
    assert.ok(!enemy.has("snare"));
    world.cast(lame, "flankStrike", enemy);
    world.run(2.1); // la technique part au prochain coup d'arme
    assert.equal(enemy.getEffect("snare")?.value, 0.4);
  });

  it("une technique part aussitôt si l'arme est prête, à la place du coup normal", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "backstab", enemy);
    assert.equal(enemy.state.hp, enemy.state.maxHp - 270);
    assert.equal(world.eventsOf("damage").filter((e) => e.abilityId === "auto").length, 0);
    assert.ok(lame.state.attacking, "la technique active l'attaque");
  });

  it("deux techniques ne s'enchaînent pas : la seconde attend le prochain coup d'arme", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "backstab", enemy);
    world.cast(lame, "backstab", enemy);
    assert.equal(world.eventsOf("damage").length, 1);
    assert.equal(lame.state.queuedAbility, "backstab");
    world.run(1.9);
    assert.equal(world.eventsOf("damage").length, 1);
    world.run(0.2);
    assert.equal(world.eventsOf("damage").filter((e) => e.abilityId === "backstab").length, 2);
    assert.equal(lame.state.queuedAbility, "");
  });

  it("une technique dont les conditions manquent au moment du coup laisse partir un coup normal", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "backstab", enemy);
    // La cible se retourne : la Lame n'est plus dans son dos au coup suivant.
    world.cast(lame, "backstab", enemy);
    enemy.state.facing = Math.PI;
    world.run(2.1);
    assert.equal(world.eventsOf("damage").filter((e) => e.abilityId === "auto").length, 1);
    assert.ok(world.errors.some((e) => e.id === "l" && e.code === "needBack"));
  });

  it("la Rage rend tous les coups critiques", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "rage");
    world.cast(lame, "backstab", enemy);
    assert.equal(enemy.state.hp, enemy.state.maxHp - 405);
    assert.equal(world.eventsOf("damage")[0]?.crit, true);
  });

  it("l'Évasion fait esquiver les coups de mêlée", () => {
    const lame = world.spawn("l", "lame", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, -2, 0);
    world.cast(lame, "evasion");
    world.rolls = [0.5]; // < 75 % : esquive
    world.cast(enemy, "backstab", lame);
    assert.equal(world.eventsOf("evaded").length, 1);
    assert.equal(lame.state.hp, lame.state.maxHp);
  });

  it("Coup de pied : dégâts, silence 10 s qui interrompt et empêche les sorts, sans casser par les dégâts", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "arcaniste", 1, 0, 0, Math.PI);
    const ally = world.spawn("a", "lame", 0, 1, -2, 0);
    world.cast(enemy, "firebolt", lame);
    world.run(0.5);
    world.cast(lame, "kick", enemy);
    assert.equal(enemy.state.hp, enemy.state.maxHp - 50);
    assert.ok(enemy.has("silenced"));
    assert.equal(enemy.state.castAbility, "", "l'incantation est interrompue");
    world.cast(enemy, "concentration");
    assert.ok(world.errors.some((e) => e.id === "e" && e.code === "silenced"));
    world.cast(ally, "backstab", enemy);
    assert.ok(enemy.has("silenced"), "les dégâts ne cassent pas le silence");
    world.run(10.1);
    assert.ok(!enemy.has("silenced"));
    assert.ok(!enemy.has("immuneMez") && !enemy.effects.some((e) => e.kind.startsWith("immune")), "pas d'immunité");
  });

  it("Coup de pied : une attaque de mêlée qui peut être esquivée (ni dégâts ni silence)", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 0, Math.PI);
    world.cast(enemy, "evasion");
    world.rolls = [0.1];
    world.cast(lame, "kick", enemy);
    assert.equal(world.eventsOf("evaded").length, 1);
    assert.equal(enemy.state.hp, enemy.state.maxHp);
    assert.ok(!enemy.has("silenced"));
  });

  it("Sprint double la vitesse, sans se cumuler avec le chant du Barde", () => {
    const lame = world.spawn("l", "lame", 0, 0, 0, 0);
    world.cast(lame, "sprint");
    assert.ok(lame.has("sprint"));
    world.combat.setInput(lame.id, { ...NO_INPUT, up: true });
    const z = lame.state.z;
    world.run(1);
    assert.ok(Math.abs(lame.state.z - z - 2 * MOVE_SPEED) < 0.2, `distance ${lame.state.z - z}`);
    world.combat.setInput(lame.id, NO_INPUT);
    const barde = world.spawn("b", "barde", 0, 0, lame.state.z - OFFSET_X * 0, 0);
    barde.state.x = lame.state.x;
    world.cast(barde, "speedSong");
    // Le Sprint est une action : le chant n'accélère la Lame qu'après 5 s de calme.
    world.run(0.1);
    assert.ok(!lame.has("speed"));
    world.run(4);
    assert.ok(lame.has("speed"));
    world.combat.setInput(lame.id, { ...NO_INPUT, up: true });
    const z2 = lame.state.z;
    world.run(1);
    assert.ok(Math.abs(lame.state.z - z2 - 2 * MOVE_SPEED) < 0.2, "le plus fort compte, pas le cumul");
  });

  it("combo : Lame empoisonnée juste après une Attaque dans le dos qui a porté, puis Gangrène", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "poisonBlade", enemy);
    assert.ok(world.errors.some((e) => e.code === "combo"), "pas de combo sans ouverture");
    world.cast(lame, "backstab", enemy);
    assert.equal(lame.state.comboAbility, "backstab");
    world.cast(lame, "poisonBlade", enemy);
    world.run(2.05);
    assert.ok(enemy.has("poisoned"));
    assert.equal(lame.state.comboAbility, "poisonBlade");
    world.cast(lame, "gangrene", enemy);
    world.run(2.05);
    assert.ok(enemy.has("gangrene"));
    // La Lame arrête de frapper, et la cible tient jusqu'au bout du poison.
    world.combat.toggleAttack(lame.id);
    enemy.state.hp = enemy.state.maxHp = 5000;
    assert.equal(world.eventsOf("damage").filter((e) => e.abilityId === "gangrene")[0]?.amount, 350);
    // Le poison : 300 en 10 s.
    world.run(8);
    const poison = world.eventsOf("damage").filter((e) => e.abilityId === "poisonBlade");
    assert.equal(poison.reduce((sum, e) => sum + (e.amount ?? 0), 0), 300);
  });

  it("combo : un coup normal entre les deux casse l'enchaînement", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "backstab", enemy);
    world.run(2.05); // coup normal
    assert.equal(lame.state.comboAbility, "");
    world.cast(lame, "poisonBlade", enemy);
    assert.ok(world.errors.some((e) => e.code === "combo"));
    assert.equal(lame.state.queuedAbility, "");
  });

  it("combo : une ouverture esquivée n'ouvre pas le combo", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 0, 0);
    world.cast(enemy, "evasion");
    world.rolls = [0.1];
    world.cast(lame, "backstab", enemy);
    assert.equal(world.eventsOf("evaded").length, 1);
    assert.equal(lame.state.comboAbility, "");
  });

  it("combo : perdu si le coup suivant ne part pas à temps (round manqué)", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "backstab", enemy);
    enemy.state.z += 10; // hors de portée
    world.run(3);
    assert.equal(lame.state.comboAbility, "");
  });

  it("Brise armure : après une Attaque de flanc, +25 % de dégâts de mêlée reçus", () => {
    const lame = world.spawn("l", "lame", 0, 2, 0, -Math.PI / 2);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    world.cast(lame, "flankStrike", enemy);
    world.cast(lame, "armorBreak", enemy);
    world.run(2.05);
    assert.ok(enemy.has("armorBroken"));
    assert.equal(world.eventsOf("damage").filter((e) => e.abilityId === "armorBreak")[0]?.amount, 250);
    world.run(2); // coup normal : 70 × 1,25
    assert.equal(world.eventsOf("damage").filter((e) => e.abilityId === "auto").at(-1)?.amount, Math.round(70 * 1.25));
  });

  it("Gangrène : les soins reçus sont réduits de moitié", () => {
    const pretre = world.spawn("p", "pretre", 1, 0, 5, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    enemy.state.hp = 500;
    lame.effects.length = 0;
    // Pose la Gangrène directement (le combo est testé plus haut).
    (world.combat as unknown as { applyEffect: (...args: unknown[]) => void }).applyEffect(
      lame,
      { id: "gangrene", melee: true, resource: "endurance", effects: [] },
      enemy,
      { type: "debuff", debuff: "gangrene", duration: 10 },
    );
    world.cast(pretre, "instantHeal", enemy);
    assert.equal(world.eventsOf("heal").at(-1)?.amount, 100);
  });

  it("Gangrène : le Renouveau et le Soin de groupe sont réduits aussi", () => {
    const pretre = world.spawn("p", "pretre", 1, 0, 5, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    enemy.state.hp = 300;
    (world.combat as unknown as { applyEffect: (...args: unknown[]) => void }).applyEffect(
      lame,
      { id: "gangrene", melee: true, resource: "endurance", effects: [] },
      enemy,
      { type: "debuff", debuff: "gangrene", duration: 30 },
    );
    world.cast(pretre, "renew", enemy);
    world.run(3.05);
    const ticks = world.eventsOf("heal").filter((e) => e.abilityId === "renew" && e.targetId === "e");
    assert.ok(ticks.length >= 1 && ticks.every((e) => e.amount === 25), `tics ${ticks.map((e) => e.amount)}`);
    world.run(10);
    enemy.state.hp = 300;
    world.cast(pretre, "groupHeal");
    world.run(3.05);
    const share = world.eventsOf("heal").filter((e) => e.abilityId === "groupHeal" && e.targetId === "e").at(-1);
    // Seule la cible est blessée (le Prêtre est plein) : sa part est de 900, plafonnée à ce qui lui manque, puis /2.
    assert.equal(share?.amount, Math.round(Math.min(900, enemy.state.maxHp - 300) / 2));
  });

  it("Coup de pied intercepté : le Gardien prend les dégâts et le silence, pas sa cible", () => {
    const gardien = world.spawn("g", "gardien", 1, 1, 0);
    const arcaniste = world.spawn("a", "arcaniste", 1, 0, 0, Math.PI);
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    world.cast(gardien, "intercept", arcaniste);
    world.cast(arcaniste, "firebolt", lame);
    world.run(0.5);
    world.cast(lame, "kick", arcaniste);
    assert.equal(world.eventsOf("intercepted").length, 1);
    assert.ok(!arcaniste.has("silenced"));
    assert.equal(arcaniste.state.hp, arcaniste.state.maxHp);
    assert.ok(gardien.has("silenced"));
    assert.equal(gardien.state.hp, gardien.state.maxHp - 50);
    assert.equal(arcaniste.state.castAbility, "firebolt", "l'incantation de la cible protégée continue");
  });

  it("combo : une ouverture interceptée n'ouvre pas le combo", () => {
    const gardien = world.spawn("g", "gardien", 1, 1, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    world.cast(gardien, "intercept", enemy);
    world.cast(lame, "backstab", enemy);
    assert.equal(world.eventsOf("intercepted").length, 1);
    assert.equal(lame.state.comboAbility, "");
  });

  it("combo : refusé sur une autre cible que celle de l'ouverture", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 0, 0);
    const other = world.spawn("o", "barde", 1, 0.5, -1, 0);
    world.cast(lame, "backstab", enemy);
    assert.equal(lame.state.comboTarget, "e");
    world.cast(lame, "poisonBlade", other);
    assert.ok(world.errors.some((e) => e.code === "combo"));
    assert.equal(lame.state.queuedAbility, "");
  });

  it("silence : une incantation sous Concentration va au bout, mais le sort suivant est impossible", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const enemy = world.spawn("e", "arcaniste", 1, 0, 0, Math.PI);
    world.cast(enemy, "concentration");
    world.cast(enemy, "firebolt", lame);
    world.run(0.5);
    world.cast(lame, "kick", enemy);
    assert.ok(enemy.has("silenced"));
    assert.equal(enemy.state.castAbility, "firebolt");
    world.run(1.6);
    assert.ok(world.eventsOf("damage").some((e) => e.abilityId === "firebolt"), "le sort part");
    world.cast(enemy, "firebolt", lame);
    assert.equal(enemy.state.castAbility, "");
  });

  it("silence : le chant du Barde se coupe et ne peut pas être relancé pendant l'effet", () => {
    const lame = world.spawn("l", "lame", 0, 0, -2, 0);
    const barde = world.spawn("b", "barde", 1, 0, 0, Math.PI);
    world.cast(barde, "speedSong");
    assert.equal(barde.state.song, "speedSong");
    world.cast(lame, "kick", barde);
    assert.equal(barde.state.song, "");
    world.cast(barde, "speedSong");
    assert.equal(barde.state.song, "");
    world.run(10.1);
    world.cast(barde, "speedSong");
    assert.equal(barde.state.song, "speedSong");
  });

  it("Sprint sous snare : vitesse × 2 × 0,6", () => {
    const lame = world.spawn("l", "lame", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 2, 0, -Math.PI / 2);
    world.cast(enemy, "flankStrike", lame);
    assert.ok(lame.has("snare"));
    world.cast(lame, "sprint");
    world.combat.setInput(lame.id, { ...NO_INPUT, up: true });
    const z = lame.state.z;
    world.run(1);
    assert.ok(Math.abs(lame.state.z - z - 1.2 * MOVE_SPEED) < 0.2, `distance ${lame.state.z - z}`);
  });
});

describe("Immunités aux contrôles", () => {
  it("relancer un mez sur une cible déjà mezzée échoue : on ne peut pas prolonger le contrôle", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 15, Math.PI);
    world.cast(barde, "mez", enemy);
    world.run(2.1);
    assert.ok(enemy.has("mez") && enemy.has("immuneMez"));
    world.cast(barde, "mez", enemy);
    world.run(2.1);
    assert.equal(world.eventsOf("immune").length, 1);
    // Appliqué à t = 2 s, le mez se termine à t = 22 s, sans avoir été rafraîchi par le second.
    world.run(18);
    assert.ok(!enemy.has("mez"));
  });

  it("le root rend immunisé au root pendant sa durée plus 30 s", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 15, Math.PI);
    world.cast(arcaniste, "freeze", enemy);
    world.run(1.6);
    assert.ok(enemy.has("root") && enemy.has("immuneRoot"));
    world.run(10 + 25);
    assert.ok(!enemy.has("root") && enemy.has("immuneRoot"));
    world.run(6);
    assert.ok(!enemy.has("immuneRoot"));
  });
});

describe("Règles communes", () => {
  it("se tourne tout seul vers l'ennemi visé en lançant un sort ou en activant l'attaque, pas sous mez", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, Math.PI);
    const enemy = world.spawn("e", "pretre", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "firebolt", enemy);
    assert.equal(arcaniste.state.castAbility, "firebolt");
    assert.ok(Math.abs(arcaniste.state.facing) < 1e-6, `orientation ${arcaniste.state.facing}`);

    // Dos tourné : l'ennemi est derrière la Lame.
    const lame = world.spawn("l", "lame", 0, 0, 12, 0);
    world.combat.setTarget(lame.id, enemy.id);
    world.combat.toggleAttack(lame.id);
    assert.ok(Math.abs(Math.abs(lame.state.facing) - Math.PI) < 1e-6, `orientation ${lame.state.facing}`);

    // Sous mez : l'attaque activée ne le tourne pas (ce chemin ne passe pas par checkCanUse).
    const gardien = world.spawn("g", "gardien", 0, -3, 0, Math.PI);
    (world.combat as unknown as { addEffect(p: PlayerRuntime, kind: string, duration: number, sourceId: string): void }).addEffect(gardien, "mez", 10, "x");
    world.combat.setTarget(gardien.id, enemy.id);
    world.combat.toggleAttack(gardien.id);
    assert.equal(gardien.state.facing, Math.PI, "sous mez, pas de rotation");

    // Jamais vers un allié.
    const pretre = world.spawn("p", "pretre", 0, 0, -5, 0);
    world.cast(pretre, "heal", arcaniste);
    assert.equal(pretre.state.facing, 0);

    // Clic droit tenu : l'orientation demandée suit la rotation.
    const steer = world.spawn("s", "arcaniste", 0, 4, 0, Math.PI);
    world.combat.setInput(steer.id, { up: false, down: false, left: false, right: false, steer: true, yaw: Math.PI });
    world.cast(steer, "firebolt", enemy);
    world.run(2.05);
    assert.ok(world.eventsOf("damage").some((e) => e.sourceId === "s"), "le sort part malgré le clic droit");
  });

  it("le root arrête net, puis la vitesse remonte jusqu'à la normale ; il casse aux dégâts", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const enemy = world.spawn("e", "pretre", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "freeze", enemy);
    world.run(1.6);
    assert.ok(enemy.has("root"));
    const root = enemy.getEffect("root")!;
    // Avance pendant 0,2 s : au début presque à l'arrêt, puis à mi-durée à environ la moitié de la vitesse.
    const stride = () => {
      const start = enemy.state.z;
      world.combat.setInput(enemy.id, { up: true, down: false, left: false, right: false });
      world.run(0.2);
      world.combat.setInput(enemy.id, { up: false, down: false, left: false, right: false });
      return Math.abs(enemy.state.z - start);
    };
    const early = stride();
    world.run(root.remaining - root.duration / 2);
    const middle = stride();
    world.run(root.remaining);
    assert.ok(!enemy.has("root"));
    const free = stride();
    assert.ok(early < free * 0.1, `début ${early} contre ${free}`);
    assert.ok(Math.abs(middle / free - 0.5) < 0.1, `mi-durée ${middle} contre ${free}`);
  });

  it("le root casse aux dégâts", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const enemy = world.spawn("e", "pretre", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "freeze", enemy);
    world.run(1.6);
    assert.ok(enemy.has("root"));
    world.cast(arcaniste, "firebolt", enemy);
    world.run(2.6);
    assert.ok(!enemy.has("root"));
  });

  it("on ne peut pas attaquer un allié ni soigner un ennemi", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0, 0);
    const ally = world.spawn("x", "arcaniste", 0, 0, 5, Math.PI);
    const enemy = world.spawn("e", "lame", 1, 0, 8, Math.PI);
    world.cast(ally, "firebolt", pretre);
    assert.equal(world.errors.at(-1)?.code, "notHostile");
    world.combat.setTarget(pretre.id, enemy.id);
    world.cast(pretre, "resurrect");
    assert.equal(world.errors.at(-1)?.code, "hostile");
  });
});

// Raccourci pour construire une commande de déplacement.
const keys = (pressed: Partial<MoveInput> = {}): MoveInput => ({ ...NO_INPUT, ...pressed });

describe("Contrôles", () => {
  it("Z avance dans la direction du personnage, Q et D le font pivoter sur place", () => {
    const lame = world.spawn("l", "lame", 1, 0, 0, 0);
    world.combat.setInput(lame.id, keys({ up: true }));
    world.run(1);
    assert.ok(lame.state.z > 5 && Math.abs(lame.state.x - OFFSET_X) < 1e-3);
    world.combat.setInput(lame.id, keys({ right: true }));
    const z = lame.state.z;
    world.run(0.5);
    assert.equal(lame.state.z, z);
    assert.ok(lame.state.facing > 1);
  });

  it("on recule moins vite qu'on n'avance", () => {
    const lame = world.spawn("l", "lame", 1, 0, 0, Math.PI);
    world.combat.setInput(lame.id, keys({ down: true }));
    world.run(1);
    assert.ok(Math.abs(lame.state.z - MOVE_SPEED * BACKWARD_SPEED_FACTOR) < 0.01, `z = ${lame.state.z}`);
  });

  it("clic droit maintenu : Q et D font un pas de côté sans tourner", () => {
    const lame = world.spawn("l", "lame", 1, 0, 0, 0);
    world.combat.setInput(lame.id, keys({ right: true, steer: true, yaw: 0 }));
    world.run(0.5);
    assert.ok(lame.state.x > OFFSET_X + 2 && Math.abs(lame.state.z) < 1e-3);
    assert.equal(lame.state.facing, 0);
  });

  it("pivoter n'interrompt pas une incantation, avancer si", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 20, Math.PI);
    world.cast(arcaniste, "firebolt", enemy);
    world.combat.setInput(arcaniste.id, keys({ left: true }));
    world.run(0.2);
    assert.equal(world.interrupts.length, 0);
    world.combat.setInput(arcaniste.id, keys({ up: true }));
    world.run(0.1);
    assert.equal(world.interrupts.at(-1)?.reason, "move");
  });

  it("F fait face à la cible en permanence, jusqu'à ce qu'on pivote", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, Math.PI);
    const enemy = world.spawn("e", "lame", 1, 0, 10, Math.PI);
    world.combat.setTarget(arcaniste.id, enemy.id);
    world.combat.lockOnTarget(arcaniste.id, "face");
    world.run(0.1);
    assert.ok(Math.abs(arcaniste.state.facing) < 1e-3);
    // La cible se déplace sur le côté : on continue de lui faire face, sans bouger.
    enemy.state.x = OFFSET_X + 10;
    world.run(0.1);
    assert.ok(Math.abs(arcaniste.state.facing - Math.atan2(10, 10)) < 1e-3);
    assert.equal(arcaniste.state.x, OFFSET_X);
    world.combat.setInput(arcaniste.id, keys({ left: true }));
    world.run(0.1);
    assert.equal(arcaniste.state.lock, "");
  });

  it("C suit la cible ; le pas de côté le garde, avancer le lâche", () => {
    const lame = world.spawn("l", "lame", 0, 0, 0, Math.PI);
    const enemy = world.spawn("e", "arcaniste", 1, 0, 10, Math.PI);
    world.combat.setTarget(lame.id, enemy.id);
    world.combat.lockOnTarget(lame.id, "stick");
    world.run(2);
    const gap = Math.hypot(enemy.state.x - lame.state.x, enemy.state.z - lame.state.z);
    assert.ok(gap <= STICK_DISTANCE + 0.01, `encore à ${gap} m`);
    world.combat.setInput(lame.id, keys({ left: true, steer: true, yaw: 0 }));
    world.run(0.5);
    assert.equal(lame.state.lock, "stick");
    world.combat.setInput(lame.id, keys({ up: true }));
    world.run(0.05);
    assert.equal(lame.state.lock, "");
  });

  it("le stick tient sous root : face à la cible, il avance dès que le root le permet ; il se lâche à la mort de la cible", () => {
    const lame = world.spawn("l", "lame", 0, 0, 0, 0);
    const arcaniste = world.spawn("a", "arcaniste", 1, 0, 14, Math.PI);
    world.combat.setTarget(lame.id, arcaniste.id);
    world.cast(arcaniste, "freeze", lame);
    world.run(1.6);
    assert.ok(lame.has("root"));
    // Posé en étant rooté : accepté.
    world.combat.lockOnTarget(lame.id, "stick");
    assert.equal(lame.state.lock, "stick");
    // L'arcaniste passe sur le côté : la Lame pivote pour lui faire face, sans encore avancer (root tout frais).
    arcaniste.state.x += 10;
    arcaniste.state.z = lame.state.z + 1;
    world.run(0.1);
    assert.equal(lame.state.lock, "stick");
    const wanted = facingTowards(lame.state, arcaniste.state);
    assert.ok(Math.abs(Math.atan2(Math.sin(lame.state.facing - wanted), Math.cos(lame.state.facing - wanted))) < 0.05, "face à la cible");
    assert.ok(Math.abs(lame.state.x - OFFSET_X) < 0.05, "presque immobile sous root");
    // Le root s'estompe : elle avance vers la cible.
    world.run(6);
    assert.equal(lame.state.lock, "stick");
    assert.ok(lame.state.x - OFFSET_X > 2, `avance sous root déclinant (${(lame.state.x - OFFSET_X).toFixed(2)} m)`);
    // Cible morte : le stick se lâche.
    arcaniste.state.hp = 0;
    assert.ok(!arcaniste.alive);
    world.run(0.1);
    assert.equal(lame.state.lock, "");
  });
});

describe("Suivi de cible, root et incantation", () => {
  it("recevoir un root interrompt l'incantation en cours, sauf sous Concentration", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0, 0);
    const arcaniste = world.spawn("a", "arcaniste", 1, 0, 10, Math.PI);
    world.cast(pretre, "heal");
    world.cast(arcaniste, "freeze", pretre);
    world.run(1.6);
    assert.ok(pretre.has("root"));
    assert.equal(pretre.state.castAbility, "", "incantation interrompue par le root");
    assert.equal(world.interrupts.at(-1)?.reason, "cc");

    // Sous Concentration : la Nova de givre (1,5 s) roote le mage pendant son Trait de feu (2 s), sans l'interrompre.
    const mage = world.spawn("m", "arcaniste", 0, 4, 0, 0);
    world.cast(mage, "concentration");
    world.cast(mage, "firebolt", arcaniste);
    world.cast(arcaniste, "frostNova");
    world.run(1.6);
    assert.ok(mage.has("root"), "rooté par la Nova");
    assert.equal(mage.state.castAbility, "firebolt", "incantation protégée");
  });

  it("suivre sa cible empêche d'incanter, mais lancer un sort à incantation lâche le suivi et l'incantation démarre", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0, 0);
    const allie = world.spawn("x", "lame", 0, 0, 12, 0);
    world.combat.setTarget(pretre.id, allie.id);
    world.combat.lockOnTarget(pretre.id, "stick");
    world.run(0.2);
    assert.ok(pretre.isMoving, "le suivi fait avancer");
    world.combat.useAbility(pretre.id, "heal");
    assert.equal(pretre.state.lock, "", "le suivi est lâché");
    assert.equal(pretre.state.castAbility, "heal", "l'incantation démarre");
    const z = pretre.state.z;
    world.run(2.1);
    assert.ok(Math.abs(pretre.state.z - z) < 1e-6, "plus d'avance pendant l'incantation");
    assert.ok(world.eventsOf("heal").some((e) => e.sourceId === "p"), "le soin part");
  });

  it("un sort refusé (hors de portée) ne lâche pas le suivi ; une touche de déplacement empêche toujours d'incanter", () => {
    const mage = world.spawn("m", "arcaniste", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 40, Math.PI);
    world.combat.setTarget(mage.id, enemy.id);
    world.combat.lockOnTarget(mage.id, "stick");
    world.run(0.2);
    world.combat.useAbility(mage.id, "firebolt");
    assert.equal(world.errors.at(-1)?.code, "outOfRange");
    assert.equal(mage.state.lock, "stick", "suivi conservé");
    assert.equal(mage.state.castAbility, "");
    // Pas de côté (garde le suivi) : on bouge soi-même, le sort est refusé et le suivi reste.
    enemy.state.z = mage.state.z + 15;
    world.combat.setInput(mage.id, keys({ left: true, steer: true, yaw: 0 }));
    world.run(0.1);
    world.combat.useAbility(mage.id, "firebolt");
    assert.equal(world.errors.at(-1)?.code, "castWhileMoving");
    assert.equal(mage.state.lock, "stick");
  });
});

describe("Gardien : nouvelles compétences", () => {
  // Accès aux méthodes internes pour préparer une situation (effet déjà posé).
  const addEffect = (p: PlayerRuntime, kind: string, duration: number) =>
    (world.combat as unknown as { addEffect: (...args: unknown[]) => void }).addEffect(p, kind, duration, "test");

  it("la Charge fonce sur la cible, puis frappe et stun à l'arrivée", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 15, Math.PI);
    world.cast(gardien, "charge", enemy);
    assert.ok(gardien.state.charging);
    world.run(1);
    assert.ok(!gardien.state.charging);
    const gap = Math.hypot(gardien.state.x - enemy.state.x, gardien.state.z - enemy.state.z);
    assert.ok(gap <= 3 && gap >= 1.4, `arrêt au contact, sans traverser la cible (${gap.toFixed(2)} m)`);
    assert.ok(world.eventsOf("damage").some((e) => e.abilityId === "charge" && e.amount === 100));
    assert.ok(enemy.has("stun"));
    assert.ok(gardien.state.attacking, "la Charge lance l'attaque");
  });

  it("la Charge exige 10 m au moins", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 6, Math.PI);
    world.cast(gardien, "charge", enemy);
    assert.equal(world.errors.at(-1)?.code, "tooClose");
    assert.ok(!gardien.state.charging);
  });

  it("la Charge passe l'esquive et l'immunité au stun, et donne l'immunité", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const enemy = world.spawn("e", "lame", 1, 0, 15, Math.PI);
    world.cast(enemy, "evasion");
    addEffect(enemy, "immuneStun", 30);
    world.rolls = [0, 0, 0, 0];
    world.cast(gardien, "charge", enemy);
    world.run(1);
    assert.equal(world.eventsOf("evaded").length, 0);
    assert.ok(enemy.has("stun"));
    assert.ok(enemy.has("immuneStun"));
  });

  it("Coup puissant : 100 dégâts quelle que soit la position", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 2, Math.PI); // face au Gardien
    world.cast(gardien, "powerStrike", enemy);
    assert.equal(enemy.state.hp, enemy.state.maxHp - 100);
  });

  it("Frappe handicapante : dans le dos, 100 dégâts et snare de 40 %", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const enemy = world.spawn("e", "barde", 1, 0, 2, 0); // dos tourné au Gardien
    world.cast(gardien, "cripplingStrike", enemy);
    assert.equal(enemy.state.hp, enemy.state.maxHp - 100);
    assert.equal(enemy.getEffect("snare")?.value, 0.4);
  });

  it("Provocation : interrompt, arrête, retourne la cible et réduit ses dégâts sur les autres", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const pretre = world.spawn("p", "pretre", 0, 0, 20, Math.PI);
    const enemy = world.spawn("e", "arcaniste", 1, 0, 10, 0); // regarde le Prêtre, dos au Gardien
    world.cast(enemy, "firebolt", pretre);
    world.run(0.5);
    world.cast(gardien, "taunt", enemy);
    assert.equal(world.interrupts.at(-1)?.reason, "taunt");
    assert.ok(enemy.has("taunted") && enemy.has("halted"));
    assert.ok(Math.abs(Math.abs(enemy.state.facing) - Math.PI) < 0.01, "tournée vers le Gardien");
    // Pendant la provocation, un Trait de feu sur le Prêtre fait moitié moins de dégâts.
    enemy.state.facing = 0;
    world.run(0.6);
    world.cast(enemy, "firebolt", pretre);
    world.run(2.6);
    assert.equal(pretre.state.hp, pretre.state.maxHp - 125);
  });

  it("Cri de ralliement : retire les contrôles magiques et en protège, pas des physiques", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 0, 3, 0, 0);
    const barde = world.spawn("b", "barde", 1, 3, 15, Math.PI);
    const ennemi = world.spawn("e", "gardien", 1, 3, 2, Math.PI);
    world.cast(barde, "mez", lame);
    world.run(2.1);
    assert.ok(lame.has("mez"));
    world.cast(gardien, "rallyCry");
    assert.ok(!lame.has("mez"));
    assert.ok(lame.has("magicImmune") && gardien.has("magicImmune"));
    // Un nouveau mez est résisté ; le Coup de bouclier (physique) passe.
    lame.effects = lame.effects.filter((e) => e.kind !== "immuneMez");
    world.cast(barde, "mez", lame);
    world.run(2.1);
    assert.ok(!lame.has("mez"));
    assert.ok(world.eventsOf("immune").some((e) => e.detail === "magic"));
    world.cast(ennemi, "shieldBash", lame);
    assert.ok(lame.has("stun"));
  });

  it("Rempart : le groupe proche ne subit aucune attaque de mêlée, le Gardien se fige", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const pretre = world.spawn("p", "pretre", 0, 0, 10, 0);
    const lointain = world.spawn("x", "pretre", 0, 0, 45, 0);
    const lame = world.spawn("l", "lame", 1, 0, 8, 0); // dans le dos du Prêtre
    world.cast(gardien, "rampart");
    world.run(0.1);
    assert.ok(pretre.has("meleeImmune") && gardien.has("meleeImmune"));
    assert.ok(!lointain.has("meleeImmune"));
    world.cast(lame, "backstab", pretre);
    assert.equal(pretre.state.hp, pretre.state.maxHp);
    assert.ok(world.eventsOf("immune").some((e) => e.detail === "melee"));
    world.cast(gardien, "taunt", lame);
    assert.equal(world.errors.at(-1)?.code, "incapacitated");
    // Un allié qui entre dans la zone est protégé aussi.
    lointain.state.z = 20;
    world.run(0.1);
    assert.ok(lointain.has("meleeImmune"));
  });

  it("Rempart : s'arrête si le Gardien est mez", () => {
    const gardien = world.spawn("g", "gardien", 0, 0, 0, 0);
    const barde = world.spawn("b", "barde", 1, 0, 15, Math.PI);
    world.cast(gardien, "rampart");
    world.cast(barde, "mez", gardien);
    world.run(2.1);
    assert.ok(gardien.has("mez"));
    assert.ok(!gardien.has("rampart"));
    world.run(0.1);
    assert.ok(!gardien.has("meleeImmune"));
  });

  it("la Garde ne bloque pas quand le Gardien bouge", () => {
    const gardien = world.spawn("g", "gardien", 0, 1, 0);
    const pretre = world.spawn("p", "pretre", 0, 0, 0, 0);
    const lame = world.spawn("l", "lame", 1, 0, -2, 0); // dans le dos du Prêtre
    world.cast(gardien, "guard", pretre);
    gardien.input = { ...NO_INPUT, left: true, steer: true };
    world.rolls = [0.99, 0.1]; // le blocage aurait réussi
    world.cast(lame, "backstab", pretre);
    assert.equal(world.eventsOf("blocked").length, 0);
    assert.equal(pretre.state.hp, pretre.state.maxHp - 270);
  });
});
