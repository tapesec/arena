// Copie dans assets-source/sounds/Sonniss GDC 2026 les sons retenus des bundles Sonniss #GameAudioGDC 2026
// (voir sonniss-selection.json), depuis les parties décompressées dans Téléchargements. Appelé par import-assets.sh.
// Usage : node scripts/import-sonniss.mjs <dossier Téléchargements> <dossier assets-source>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [downloads, out] = process.argv.slice(2);
const selection = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sonniss-selection.json"), "utf8"));
const dest = path.join(out, "sounds", "Sonniss GDC 2026");
let count = 0;
for (const [part, libraries] of Object.entries(selection)) {
  if (part.startsWith("_")) continue;
  const root = path.join(downloads, `Sonniss.com-GDC2026-GameAudioBundle${part}of5`);
  if (!existsSync(root)) {
    console.log(`Sonniss partie ${part} absente de ${downloads} : ignorée`);
    continue;
  }
  const libs = libraries === "*" ? Object.fromEntries(readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => [e.name, null])) : libraries;
  for (const [library, pattern] of Object.entries(libs)) {
    const regex = pattern ? new RegExp(pattern) : null;
    for (const file of readdirSync(path.join(root, library))) {
      if (!/\.wav$/i.test(file) || (regex && !regex.test(file))) continue;
      mkdirSync(path.join(dest, library), { recursive: true });
      copyFileSync(path.join(root, library, file), path.join(dest, library, file));
      count++;
    }
  }
}
console.log(`Sonniss : ${count} sons copiés`);
