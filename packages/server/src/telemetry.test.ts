import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_INPUT } from "@arena/shared";
import { ActionCounter, browserFamily, sanitizePerf, snapshot, trackRoom, untrackRoom } from "./telemetry";

describe("télémétrie", () => {
  it("reconnaît la famille de navigateur, sans garder le User-Agent", () => {
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const headless = chrome.replace("Chrome/", "HeadlessChrome/");
    const edge = `${chrome} Edg/131.0.0.0`;
    const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
    const safariIphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
    assert.deepEqual(browserFamily(chrome), { browser: "Chrome", mobile: false });
    assert.deepEqual(browserFamily(headless), { browser: "HeadlessChrome", mobile: false });
    assert.deepEqual(browserFamily(edge), { browser: "Edge", mobile: false });
    assert.deepEqual(browserFamily(firefox), { browser: "Firefox", mobile: false });
    assert.deepEqual(browserFamily(safariIphone), { browser: "Safari", mobile: true });
    assert.deepEqual(browserFamily("curl/8.7.1"), { browser: "Autre", mobile: false });
    assert.deepEqual(browserFamily(undefined), { browser: "Inconnu", mobile: false });
  });

  it("compte le début d'un déplacement, pas chaque entrée reçue pendant qu'il dure", () => {
    const actions = new ActionCounter();
    const forward = { ...NO_INPUT, up: true };
    for (let i = 0; i < 30; i++) actions.move("a", forward);
    assert.equal(actions.get("a"), 1);
    actions.move("a", NO_INPUT);
    actions.move("a", { ...NO_INPUT, left: true });
    assert.equal(actions.get("a"), 2);
    // Tourner la caméra sans bouger n'est pas une action.
    actions.move("a", NO_INPUT);
    actions.move("a", { ...NO_INPUT, yaw: 1.2 });
    assert.equal(actions.get("a"), 2);
  });

  it("additionne les autres actions et oublie un joueur parti", () => {
    const actions = new ActionCounter();
    for (let i = 0; i < 4; i++) actions.add("b");
    assert.equal(actions.get("b"), 4);
    actions.forget("b");
    assert.equal(actions.get("b"), 0);
  });

  it("relève les joueurs connectés et ceux en partie, toutes salles confondues", () => {
    trackRoom("salon", () => ({ humans: 3, inMatch: false }));
    trackRoom("partie", () => ({ humans: 2, inMatch: true }));
    assert.deepEqual(snapshot(), { online: 5, in_match: 2, matches: 1, rooms: 2 });
    untrackRoom("salon");
    untrackRoom("partie");
    assert.deepEqual(snapshot(), { online: 0, in_match: 0, matches: 0, rooms: 0 });
  });

  it("garde les performances d'affichage envoyées par le client, bornées et arrondies", () => {
    assert.deepEqual(sanitizePerf({ dpr: 2, scale: 1.5, fps: 57.4, fpsLow: 41.6, drops: 1, reverted: 1, extra: "x" }), {
      dpr: 2,
      scale: 1.5,
      fps: 57,
      fps_low: 42,
      drops: 1,
      reverted: 1,
    });
    assert.equal(sanitizePerf({ dpr: 2, scale: 1.5, fps: 1e9, fpsLow: 40, drops: 0, reverted: 0 }), null);
    assert.equal(sanitizePerf({ dpr: "2", scale: 1.5, fps: 60, fpsLow: 40, drops: 0, reverted: 0 }), null);
    assert.equal(sanitizePerf(null), null);
  });
});
