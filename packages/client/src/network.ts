import { Client, type Room } from "@colyseus/sdk";
import { SERVER_PORT } from "@arena/shared";

// Même hôte que la page : permet de tester depuis un autre PC du réseau local.
const client = new Client(`http://${window.location.hostname}:${SERVER_PORT}`);

export function joinArena(): Promise<Room> {
  return client.joinOrCreate("arena");
}
