import assert from "node:assert/strict";
import { describe, it } from "node:test";
import manifest from "./assets-manifest.json" with { type: "json" };
import { productionModels } from "./productionAssets";

// Le jeu publié charge ses assets depuis le bucket d'après le manifeste : un fichier absent y serait demandé au serveur
// du jeu, qui ne l'a pas. Après un changement de modèles ou d'objets, lancer npm run deploy-assets et commiter le
// manifeste. (Ce test ne voit pas un fichier modifié sans changer de nom : deploy-assets reste à lancer dans ce cas.)
describe("Manifeste des assets", () => {
  it("contient chaque modèle du jeu", () => {
    const published = new Set(Object.keys(manifest));
    const missing = productionModels().filter((file) => !published.has(file));
    assert.deepEqual(missing, []);
  });
});
