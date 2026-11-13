import assert from "node:assert/strict";
import { test } from "node:test";
import { orderAvailable, type OrderSituation } from "@arena/shared";
import { wheelSlot } from "./OrderWheel";

test("roue des ordres : la case pointée suit la souris, la première en haut, dans le sens horaire", () => {
  assert.equal(wheelSlot(0, -100, 8), 0);
  assert.equal(wheelSlot(70, -70, 8), 1);
  assert.equal(wheelSlot(100, 0, 8), 2);
  assert.equal(wheelSlot(0, 100, 8), 4);
  assert.equal(wheelSlot(-100, 0, 8), 6);
  assert.equal(wheelSlot(-70, -70, 8), 7);
  // Juste à gauche du haut : encore la case 0.
  assert.equal(wheelSlot(-10, -100, 8), 0);
});

test("roue des ordres : rien n'est pointé près du centre", () => {
  assert.equal(wheelSlot(5, -10, 8), null);
});

const situation = (overrides: Partial<OrderSituation["issuer"]> = {}, bots: OrderSituation["bots"] = [], hasEnemyTarget = false): OrderSituation => ({
  issuer: { classId: "lame", hurt: false, mezzed: false, resourceFull: true, effects: new Set(), ...overrides },
  hasEnemyTarget,
  bots,
});
const pretre = { classId: "pretre" as const, mana: 1000, song: "", incapacitated: false };
const barde = { classId: "barde" as const, mana: 1000, song: "speedSong", incapacitated: false };

test("roue des ordres : les ordres impossibles sur le moment sont grisés", () => {
  // Soigne-moi : seulement blessé, avec un Prêtre libre qui a du mana.
  assert.equal(orderAvailable("heal", situation({}, [pretre])), false);
  assert.equal(orderAvailable("heal", situation({ hurt: true }, [pretre])), true);
  assert.equal(orderAvailable("heal", situation({ hurt: true }, [{ ...pretre, mana: 10 }])), false);
  assert.equal(orderAvailable("heal", situation({ hurt: true }, [{ ...pretre, incapacitated: true }])), false);
  // Réveille-moi : seulement mezzé.
  assert.equal(orderAvailable("awaken", situation({}, [barde])), false);
  assert.equal(orderAvailable("awaken", situation({ mezzed: true }, [barde])), true);
  // Assistez-moi : seulement avec un ennemi en cible.
  const lame = { classId: "lame" as const, mana: 0, song: "", incapacitated: false };
  assert.equal(orderAvailable("assist", situation({}, [lame])), false);
  assert.equal(orderAvailable("assist", situation({}, [lame], true)), true);
  // Vitesse : grisé si le Barde chante déjà le Chant de vitesse.
  assert.equal(orderAvailable("speed", situation({}, [barde])), false);
  assert.equal(orderAvailable("speed", situation({}, [{ ...barde, song: "secondWind" }])), true);
  // Mana : seulement si la ressource n'est pas pleine.
  assert.equal(orderAvailable("resource", situation({}, [barde])), false);
  assert.equal(orderAvailable("resource", situation({ resourceFull: false }, [barde])), true);
  // Buff please : seulement s'il manque un buff qu'un bot présent peut lancer.
  assert.equal(orderAvailable("buff", situation({ effects: new Set(["buffHp", "buffStrength"]) }, [pretre])), false);
  assert.equal(orderAvailable("buff", situation({ effects: new Set(["buffHp", "buffStrength"]) }, [pretre, barde])), true);
  // Protège-moi : jamais pour un Gardien ; Suivez-moi : même avec un bot mezzé.
  const gardien = { classId: "gardien" as const, mana: 0, song: "", incapacitated: true };
  assert.equal(orderAvailable("protect", situation({ classId: "gardien" }, [{ ...gardien, incapacitated: false }])), false);
  assert.equal(orderAvailable("follow", situation({}, [gardien])), true);
});
