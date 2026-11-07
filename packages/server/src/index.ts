import { defineRoom, defineServer, listen } from "colyseus";
import { SERVER_PORT } from "@arena/shared";
import { ArenaRoom } from "./ArenaRoom";

const server = defineServer({
  rooms: {
    arena: defineRoom(ArenaRoom),
  },
});

// PORT permet de lancer une autre instance à côté (tests, mise en ligne).
await listen(server, Number(process.env.PORT ?? SERVER_PORT));
