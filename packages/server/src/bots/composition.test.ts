import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassId } from "@arena/shared";
import { botToReplace, initialBotClasses } from "./composition";

describe("Composition des bots dans la salle d'attente", () => {
  it("une équipe de 8 bots : une classe de chaque, un second Prêtre, deux Lames ou Arcanistes", () => {
    const classes = initialBotClasses(8, () => 0.9);
    assert.deepEqual(classes, ["pretre", "gardien", "barde", "arcaniste", "lame", "pretre", "arcaniste", "arcaniste"]);
  });

  it("les joueurs remplacent d'abord les doublons de Lame ou d'Arcaniste, puis le second Prêtre", () => {
    let bots: ClassId[] = ["pretre", "gardien", "barde", "arcaniste", "lame", "pretre", "lame", "arcaniste"];
    const removed: ClassId[] = [];
    while (bots.length) {
      const i = botToReplace(bots);
      removed.push(bots[i]);
      bots = bots.filter((_, j) => j !== i);
    }
    assert.deepEqual(removed, ["lame", "arcaniste", "pretre", "lame", "arcaniste", "barde", "gardien", "pretre"]);
  });
});
