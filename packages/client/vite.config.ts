import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Serveur de jeu Colyseus vers lequel Vite redirige les requêtes /colyseus.
const GAME_SERVER_URL = process.env.GAME_SERVER_URL ?? "http://localhost:2567";

// Fichiers lus et enregistrés par la page de réglage animation-lab.html (développement), par /__dev-file/<nom> :
// le calage des animations de compétence et les effets à particules (lus par le jeu), et les demandes d'effets
// adressées à Claude.
const DEV_FILES: Record<string, URL> = {
  animationTuning: new URL("./src/game/animationTuning.json", import.meta.url),
  particleEffects: new URL("./src/game/particleEffects.json", import.meta.url),
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

export default defineConfig({
  plugins: [react(), devFilesEndpoint()],
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
