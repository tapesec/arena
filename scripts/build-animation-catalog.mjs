// Produit les bibliothèques d'animations COMPLÈTES (toutes les animations des packs Quaternius), pour la page
// de visualisation des animations (packages/client/animations.html), utile en développement seulement.
// Le jeu, lui, n'embarque que les animations qu'il utilise (voir build-assets.mjs).
//
// Usage : node scripts/build-animation-catalog.mjs
// Sortie : packages/client/public/dev-models/animations/ (non versionné : se régénère à partir de assets-source/).
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample } from "@gltf-transform/functions";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "assets-source", "animations");
const OUT = path.join(ROOT, "packages", "client", "public", "dev-models", "animations");
const LIBRARIES = ["UAL1_Standard.glb", "UAL2.glb"];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(OUT, { recursive: true });

for (const file of LIBRARIES) {
  const doc = await io.read(path.join(SOURCE, file));
  const root = doc.getRoot();
  // Seul le squelette sert : le mannequin est retiré.
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  await doc.transform(resample(), prune({ keepLeaves: true }), dedup());
  const target = path.join(OUT, file);
  await io.write(target, doc);
  const { size } = await stat(target);
  console.log(`${file.padEnd(20)} ${root.listAnimations().length} animations, ${(size / 1024 / 1024).toFixed(2)} Mo`);
}
