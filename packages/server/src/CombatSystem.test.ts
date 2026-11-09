import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  BACKWARD_SPEED_FACTOR,
  CLASSES,
  MOVE_SPEED,
  NO_INPUT,
  STICK_DISTANCE,
  maxResource,
  type ClassId,
  type CombatEvent,
  type InterruptEvent,
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
  errors: { id: string; message: string }[] = [];
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
          if (type === "error") this.errors.push({ id, message: (message as { message: string }).message });
        },
      },
      () => this.rolls.shift() ?? 0.99,
    );
  }

  // facing : 0 regarde vers +z, π vers -z.
  spawn(id: string, classId: ClassId, team: number, x: number, z: number, facing = 0): PlayerRuntime {
    const classDef = CLASSES[classId];
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
    const edge = world.spawn("e", "lame", 1, 0, -4.5);
    const far = world.spawn("f", "lame", 1, 6, 0);
    const ally = world.spawn("x", "pretre", 0, 1, 0);
    world.cast(arcaniste, "blast");
    world.run(2.6);
    const lost = (p: typeof close) => p.state.maxHp - p.state.hp;
    assert.equal(lost(close), 325);
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

  it("Concentration protège l'incantation suivante du Silence", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const barde = world.spawn("b", "barde", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "concentration");
    world.cast(arcaniste, "firebolt", barde);
    world.cast(barde, "silence", arcaniste);
    world.run(1.1);
    assert.equal(arcaniste.state.castAbility, "firebolt");
    world.run(1.5);
    assert.equal(barde.state.hp, barde.state.maxHp - 250);
  });

  it("sans Concentration, le Silence interrompt l'incantation", () => {
    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 0, 0);
    const barde = world.spawn("b", "barde", 1, 0, 10, Math.PI);
    world.cast(arcaniste, "firebolt", barde);
    world.cast(barde, "silence", arcaniste);
    world.run(1.1);
    assert.equal(arcaniste.state.castAbility, "");
    assert.equal(world.interrupts[0]?.reason, "silence");
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
    assert.match(world.errors.at(-1)!.message, /dos/);
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

  it("la Purification retire le mez et laisse l'immunité", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const ally = world.spawn("x", "lame", 0, 3, 0);
    const barde = world.spawn("b", "barde", 1, 3, 15, Math.PI);
    world.cast(barde, "mez", ally);
    world.run(2.1);
    assert.ok(ally.has("mez"));
    world.cast(pretre, "purify", ally);
    assert.ok(!ally.has("mez"));
    assert.ok(ally.has("immuneMez"));
  });

  it("la Purification ne retire pas le stun", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    const ally = world.spawn("x", "lame", 0, 3, 0);
    const gardien = world.spawn("g", "gardien", 1, 3, 2, Math.PI);
    world.cast(gardien, "shieldBash", ally);
    assert.ok(ally.has("stun"));
    world.cast(pretre, "purify", ally);
    assert.ok(ally.has("stun"));
  });

  it("le Soin sans allié ciblé soigne le Prêtre lui-même", () => {
    const pretre = world.spawn("p", "pretre", 0, 0, 0);
    pretre.state.hp = 500;
    world.cast(pretre, "heal");
    world.run(2.1);
    assert.equal(pretre.state.hp, 800);
  });
});

describe("Barde", () => {
  it("le Mez de zone touche les ennemis dans le rayon et casse au moindre dégât", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const near1 = world.spawn("n1", "lame", 1, 0, 15);
    const near2 = world.spawn("n2", "lame", 1, 3, 15);
    const far = world.spawn("f", "lame", 1, 0, 25);
    world.cast(barde, "aoeMez", near1);
    world.run(3.1);
    assert.ok(near1.has("mez") && near2.has("mez"));
    assert.ok(!far.has("mez"));

    const arcaniste = world.spawn("a", "arcaniste", 0, 0, 5, 0);
    world.cast(arcaniste, "firebolt", near1);
    world.run(2.6);
    assert.ok(!near1.has("mez") && near1.has("immuneMez"));
    assert.ok(near2.has("mez"));
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
    assert.equal(world.errors.at(-1)?.message, "Vous êtes neutralisé");
  });

  it("le Chant de vitesse accélère les alliés et se coupe quand le Barde est attaqué", () => {
    const barde = world.spawn("b", "barde", 0, 0, 0, 0);
    const ally = world.spawn("x", "lame", 0, 5, 0);
    world.cast(barde, "speedSong");
    world.run(DT);
    assert.ok(ally.has("speed"));
    const enemy = world.spawn("e", "arcaniste", 1, 0, 10, Math.PI);
    world.cast(enemy, "firebolt", barde);
    world.run(2.6);
    assert.ok(!ally.has("speed"));
    world.run(5.1);
    assert.ok(ally.has("speed"));
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
    assert.ok(world.errors.some((e) => e.id === "l" && e.message.includes("dos")));
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
    assert.equal(world.errors.at(-1)?.message, "Cible non hostile");
    world.combat.setTarget(pretre.id, enemy.id);
    world.cast(pretre, "purify");
    assert.equal(world.errors.at(-1)?.message, "Cible hostile");
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

  it("le stick se lâche quand on est rooté ou que la cible meurt", () => {
    const lame = world.spawn("l", "lame", 0, 0, 0, 0);
    const arcaniste = world.spawn("a", "arcaniste", 1, 0, 10, Math.PI);
    world.combat.setTarget(lame.id, arcaniste.id);
    world.combat.lockOnTarget(lame.id, "stick");
    world.cast(arcaniste, "freeze", lame);
    world.run(1.6);
    assert.ok(lame.has("root"));
    assert.equal(lame.state.lock, "");
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
    assert.equal(world.errors.at(-1)?.message, "Cible trop proche");
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
    assert.equal(world.errors.at(-1)?.message, "Vous êtes neutralisé");
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
