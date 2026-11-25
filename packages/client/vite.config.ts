import { readFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { parseSoundKey } from "./src/audio/scramble";

// Serveur de jeu Colyseus vers lequel Vite redirige les requêtes /colyseus.
const GAME_SERVER_URL = process.env.GAME_SERVER_URL ?? "http://localhost:2567";

// Fichiers lus et enregistrés par la page de réglage animation-lab.html (développement), par /__dev-file/<nom> :
// le calage des animations de compétence et les effets à particules (lus par le jeu), et les demandes d'effets
// adressées à Claude.
const DEV_FILES: Record<string, URL> = {
  animationTuning: new URL("./src/game/animationTuning.json", import.meta.url),
  particleEffects: new URL("./src/game/particleEffects.json", import.meta.url),
  groundMarks: new URL("./src/game/groundMarks.json", import.meta.url),
  objects3d: new URL("./src/game/objects3d.json", import.meta.url),
  // Éditeur d'apparence (onglets Apparence et Placement) : apparences des classes et placements des objets.
  appearances: new URL("./src/game/appearances.json", import.meta.url),
  overlays2d: new URL("./src/game/overlays2d.json", import.meta.url),
  soundEdits: new URL("./src/audio/soundEdits.json", import.meta.url),
  // Onglet « Sons communs » : sons communs du jeu remplacés.
  commonSounds: new URL("./src/audio/commonSounds.json", import.meta.url),
  particleRequests: new URL("./particle-requests.json", import.meta.url),
};
function devFilesEndpoint(): Plugin {
  return {
    name: "dev-files",
    configureServer(server) {
      const handle = (name: (url: string) => string) => (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          try {
            const file = DEV_FILES[name(req.url ?? "")];
            if (!file) throw new Error("fichier inconnu");
            if (req.method === "POST") {
              let body = "";
              for await (const chunk of req) body += chunk;
              const data = JSON.parse(body) as unknown;
              if (!data || typeof data !== "object") throw new Error("format invalide");
              await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
              res.end("ok");
            } else {
              res.setHeader("Content-Type", "application/json");
              res.end(await readFile(file, "utf8").catch(() => "null"));
            }
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        })();
      };
      server.middlewares.use("/__dev-file", handle((url) => url.replace(/^\//, "").split("?")[0]));
      // Ancienne adresse du calage des animations (pages ouvertes avant la mise à jour).
      server.middlewares.use("/__animation-tuning", handle(() => "animationTuning"));
    },
  };
}

// Dossiers de public/ réservés aux pages de développement (bibliothèques complètes d'animations et de sons) : retirés
// de la version de production. Une fois les assets publiés sur le CDN (manifeste non vide, voir src/assets.ts), les
// modèles, sons et musiques en sont retirés aussi : un asset oublié par scripts/deploy-assets.ts se voit (404) au lieu
// d'être servi en douce par le serveur du jeu.
const PUBLISHED = Object.keys(JSON.parse(readFileSync(new URL("./src/assets-manifest.json", import.meta.url), "utf8")) as object).length > 0;
const DEV_ONLY_PUBLIC = ["dev-models", "dev-sounds", ...(PUBLISHED ? ["models", "sounds", "music"] : [])];
function excludeDevAssets(): Plugin {
  let outDir = "";
  return {
    name: "exclude-dev-assets",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      // Sans la clé (.env.local sur le poste, secret en CI), les sons protégés seraient muets dans le jeu publié.
      if (!parseSoundKey(config.env.VITE_SOUND_KEY)) {
        throw new Error("VITE_SOUND_KEY manquante : clé des sons protégés (packages/client/.env.local ou secret de la CI)");
      }
    },
    async closeBundle() {
      for (const folder of DEV_ONLY_PUBLIC) await rm(resolve(outDir, folder), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), devFilesEndpoint(), excludeDevAssets()],
  server: {
    port: 5173,
    // Tout passe par Vite (page et serveur de jeu) : une seule adresse à exposer, par exemple avec ngrok.
    proxy: {
      "/colyseus": {
        target: GAME_SERVER_URL,
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ""),
      },
    },
    // Vite refuse par défaut les noms de domaine inconnus : on autorise ceux des tunnels ngrok.
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app", ".ngrok.dev"],
  },
});
