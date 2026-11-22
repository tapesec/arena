import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { CLASS_LIST } from "@arena/shared";

// classIcon retombe sans bruit sur les épées croisées si une icône manque : chaque classe doit avoir la sienne.
describe("Icônes de classe", () => {
  it("chaque classe a son fichier dans icons/classes", () => {
    const files = readdirSync(new URL("./icons/classes/", import.meta.url)).filter((f) => f.endsWith(".svg"));
    assert.deepEqual(files.map((f) => f.slice(0, -".svg".length)).sort(), CLASS_LIST.map((c) => c.id).sort());
  });
});
