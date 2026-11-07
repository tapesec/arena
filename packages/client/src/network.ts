import { Client, type Room } from "@colyseus/sdk";
import { SERVER_PORT, type ClassId } from "@arena/shared";

// Par défaut, même hôte que la page : permet de tester depuis un autre PC du réseau local.
// VITE_SERVER_URL permet de viser un autre serveur (instance de test, mise en ligne).
const serverUrl = import.meta.env.VITE_SERVER_URL ?? `http://${window.location.hostname}:${SERVER_PORT}`;
const client = new Client(serverUrl);

export function joinArena(classId: ClassId): Promise<Room> {
  return client.joinOrCreate("arena", { classId });
}
