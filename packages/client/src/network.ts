import { Client, type Room } from "@colyseus/sdk";
import type { ClassId } from "@arena/shared";

// Par défaut, on passe par la même adresse que la page : Vite redirige /colyseus vers le serveur de jeu.
// Ça fonctionne en local, depuis un autre PC du réseau, ou à travers un tunnel ngrok.
// VITE_SERVER_URL permet de viser directement un autre serveur.
const serverUrl = import.meta.env.VITE_SERVER_URL ?? `${window.location.origin}/colyseus`;
const client = new Client(serverUrl);

export function joinArena(classId: ClassId): Promise<Room> {
  return client.joinOrCreate("arena", { classId });
}
