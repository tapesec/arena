import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Serveur de jeu Colyseus vers lequel Vite redirige les requêtes /colyseus.
const GAME_SERVER_URL = process.env.GAME_SERVER_URL ?? "http://localhost:2567";

export default defineConfig({
  plugins: [react()],
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
