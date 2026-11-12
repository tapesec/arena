import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EFFECTS, getAbility, type EffectKind } from "@arena/shared";
import { EFFECT_ABILITIES, OWN } from "./effectIconMap";

const ICONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "icons");

describe("icônes des effets (HUD)", () => {
  it("chaque effet a une icône qui existe", () => {
    for (const kind of Object.keys(EFFECTS) as EffectKind[]) {
      const own = OWN[kind];
      const ability = EFFECT_ABILITIES[kind];
      assert.ok(own || ability, `${kind} : aucune icône`);
      if (own) assert.ok(existsSync(path.join(ICONS, "effects", `${own.icon}.svg`)), `${kind} : icons/effects/${own.icon}.svg manquant`);
      else {
        assert.ok(getAbility(ability!), `${kind} : compétence ${ability} inconnue`);
        assert.ok(existsSync(path.join(ICONS, `${ability}.svg`)), `${kind} : icons/${ability}.svg manquant`);
      }
    }
  });
});
