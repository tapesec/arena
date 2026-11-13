import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineRoom, defineServer, listen } from "colyseus";
import { SERVER_PORT } from "@arena/shared";
import { ArenaRoom } from "./ArenaRoom";
import { CLIENT_DIST, createClientServer } from "./staticClient";

// Production (NODE_ENV=production, `npm start`) : le serveur sert aussi la page du jeu construite par `npm run build`.
// Développement : Vite sert la page et redirige /colyseus vers ce serveur.
const PRODUCTION = process.env.NODE_ENV === "production";
if (PRODUCTION && !existsSync(join(CLIENT_DIST, "index.html"))) {
  console.error(`Client introuvable dans ${CLIENT_DIST} : lancer d'abord « npm run build ».`);
  process.exit(1);
}

const server = defineServer({
  rooms: {
    arena: defineRoom(ArenaRoom),
  },
  express: PRODUCTION ? (app) => void app.use(createClientServer()) : undefined,
});

// PORT permet de lancer une autre instance à côté (tests, mise en ligne).
await listen(server, Number(process.env.PORT ?? SERVER_PORT));
