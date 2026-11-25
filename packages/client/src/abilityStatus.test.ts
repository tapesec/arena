import assert from "node:assert/strict";
import { test } from "node:test";
import { getAbility, type AbilityDef, type EffectKind } from "@arena/shared";
import { abilityStatus, errorText } from "./abilityStatus";
import type { SelfFrame, TargetFrame } from "./store";

const ability = (id: string): AbilityDef => {
  const def = getAbility(id);
  assert.ok(def, id);
  return def;
};

function self(overrides: Partial<SelfFrame> = {}, effects: EffectKind[] = []): SelfFrame {
  return {
    name: "Moi",
    className: "",
    hp: 1000,
    maxHp: 1000,
    cast: null,
    effects: effects.map((kind) => ({ kind, remaining: 5, duration: 5, sourceId: "x", source: "x" }) as SelfFrame["effects"][number]),
    classId: "arcaniste",
    mana: 1000,
    maxMana: 1000,
    endurance: 100,
    maxEndurance: 100,
    attacking: false,
    lock: "",
    song: "",
    queuedAbility: "",
    comboAbility: "",
    charging: false,
    rolling: false,
    rooted: false,
    ...overrides,
  };
}

function enemy(overrides: Partial<TargetFrame> = {}): TargetFrame {
  return {
    name: "Cible",
    className: "",
    hp: 1000,
    maxHp: 1000,
    cast: null,
    effects: [],
    classId: "lame",
    mana: 0,
    maxMana: 0,
    endurance: 100,
    maxEndurance: 100,
    isSelf: false,
    isAlly: false,
    distance: 10,
    inMeleeRange: false,
    inLineOfSight: true,
    position: "front",
    ...overrides,
  };
}

const state = (...args: Parameters<typeof abilityStatus>) => abilityStatus(...args).state;

test("un sort offensif part sur un ennemi vivant, à portée et en vue", () => {
  assert.equal(state(ability("firebolt"), self(), enemy()), "ready");
  assert.equal(abilityStatus(ability("firebolt"), self(), enemy()).reason, null);
});

test("mort, neutralisé, en Charge ou en roulade : rien ne part", () => {
  const firebolt = ability("firebolt");
  assert.equal(state(firebolt, self({ hp: 0 }), enemy()), "disabled");
  for (const kind of ["mez", "stun", "rampart"] as const) assert.equal(state(firebolt, self({}, [kind]), enemy()), "disabled");
  assert.equal(state(firebolt, self({ charging: true }), enemy()), "disabled");
  assert.equal(state(firebolt, self({ rolling: true }), enemy()), "disabled");
  assert.equal(state(firebolt, self({}, ["silenced"]), enemy()), "disabled");
});

test("ressource insuffisante, sauf pour couper son chant", () => {
  assert.equal(state(ability("firebolt"), self({ mana: 0 }), enemy()), "unaffordable");
  assert.equal(state(ability("speedSong"), self({ mana: 0 }), null), "unaffordable");
  assert.equal(state(ability("speedSong"), self({ mana: 0, song: "speedSong" }), null), "ready");
});

test("pas de cible qui convienne", () => {
  const firebolt = ability("firebolt");
  assert.equal(state(firebolt, self(), null), "noTarget");
  assert.equal(state(firebolt, self(), enemy({ isAlly: true })), "noTarget");
  assert.equal(state(firebolt, self(), enemy({ hp: 0 })), "noTarget");
  assert.equal(state(ability("resurrect"), self(), enemy({ isAlly: true })), "noTarget");
});

test("hors de portée, trop près ou hors de vue", () => {
  const firebolt = ability("firebolt");
  const charge = ability("charge");
  const cases = [
    [firebolt, enemy({ distance: firebolt.range + 1 }), "outOfRange"],
    [firebolt, enemy({ inLineOfSight: false }), "noLineOfSight"],
    [charge, enemy({ distance: (charge.minRange ?? 0) - 1 }), "tooClose"],
  ] as const;
  for (const [def, target, code] of cases) {
    assert.deepEqual(abilityStatus(def, self(), target), { state: "range", reason: errorText(code) });
  }
});

test("technique de dos : refusée de face, prête dans le dos", () => {
  const backstab = ability("backstab");
  assert.equal(backstab.position, "back");
  assert.equal(state(backstab, self(), enemy({ inMeleeRange: true, position: "front" })), "position");
  assert.equal(state(backstab, self(), enemy({ inMeleeRange: true, position: "back" })), "ready");
  assert.equal(state(backstab, self(), enemy({ inMeleeRange: false, position: "back" })), "range");
});

test("combo : ne part qu'après son ouverture", () => {
  const poison = ability("poisonBlade");
  assert.equal(poison.after, "backstab");
  assert.equal(state(poison, self(), enemy({ inMeleeRange: true })), "combo");
  assert.equal(state(poison, self({ comboAbility: "backstab" }), enemy({ inMeleeRange: true })), "ready");
});
