import { defineRoom, defineServer, listen } from "colyseus";
import { SERVER_PORT } from "@arena/shared";
import { ArenaRoom } from "./ArenaRoom";

const server = defineServer({
  rooms: {
    arena: defineRoom(ArenaRoom),
  },
});

await listen(server, SERVER_PORT);
