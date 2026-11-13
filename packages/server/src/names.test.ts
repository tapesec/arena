import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanName, defaultPlayerName } from "@arena/shared";
import { claimName, suffixBotName, suffixPlayerName } from "./names";

describe("pseudos", () => {
  it("ne garde que les lettres sans accent, les chiffres et le @, 15 caractères au plus", () => {
    assert.equal(cleanName("Zoé la_Brave@42!"), "ZolaBrave@42");
    assert.equal(cleanName("abcdefghijklmnopqrst"), "abcdefghijklmno");
  });

  it("propose un nom de fantasy suivi de 3 chiffres", () => {
    const name = defaultPlayerName(() => 0.5);
    assert.equal(name, "Ailith555");
    assert.match(name, /^[A-Za-z]+\d{3}$/);
    assert.ok(name.length <= 15);
  });

  it("ajoute 3 chiffres au pseudo déjà pris par un joueur, sans dépasser 15 caractères", () => {
    assert.match(suffixPlayerName("Rowan", new Set(["rowan"])), /^Rowan\d{3}$/);
    const long = suffixPlayerName("abcdefghijklmno", new Set(["abcdefghijklmno"]));
    assert.match(long, /^abcdefghijkl\d{3}$/);
  });

  it("ajoute un chiffre au pseudo du bot, en évitant les noms pris", () => {
    const taken = new Set(["rowan", ..."012345678".split("").map((d) => `rowan${d}`)]);
    assert.equal(suffixBotName("Rowan", taken), "Rowan9");
  });

  it("garde le pseudo libre, suffixe celui d'un joueur, et renomme le bot qui le porte", () => {
    const players = [
      { name: "Rowan", isBot: false },
      { name: "Kael", isBot: true },
      { name: "Kael3", isBot: true },
    ];
    assert.equal(claimName("Lyra", players), "Lyra");
    assert.match(claimName("rowan", players), /^rowan\d{3}$/);
    assert.equal(claimName("Kael", players), "Kael");
    assert.match(players[1].name, /^Kael[0-9]$/);
    assert.notEqual(players[1].name, "Kael3");
  });
});
