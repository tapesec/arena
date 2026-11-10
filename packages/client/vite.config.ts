import { readFile, writeFile } from "node:fs/promises";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Serveur de jeu Colyseus vers lequel Vite redirige les requêtes /colyseus.
const GAME_SERVER_URL = process.env.GAME_SERVER_URL ?? "http://localhost:2567";

// Calage des animations de compétence, lu par le jeu et réglé sur la page animation-lab.html (développement) :
// la page le lit et l'enregistre par /__animation-tuning.
const TUNING_FILE = new URL("./src/game/animationTuning.json", import.meta.url);
function animationTuningEndpoint(): Plugin {
  return {
    name: "animation-tuning",
    configureServer(server) {
      server.middlewares.use("/__animation-tuning", (req, res) => {
        void (async () => {
          try {
            if (req.method === "POST") {
              let body = "";
              for await (const chunk of req) body += chunk;
              const tuning = JSON.parse(body) as unknown;
              if (!tuning || typeof tuning !== "object" || Array.isArray(tuning)) throw new Error("format invalide");
              await writeFile(TUNING_FILE, `${JSON.stringify(tuning, null, 2)}\n`);
              res.end("ok");
            } else {
              res.setHeader("Content-Type", "application/json");
              res.end(await readFile(TUNING_FILE, "utf8"));
            }
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), animationTuningEndpoint()],
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
