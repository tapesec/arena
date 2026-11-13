import { Client, type Room } from "@colyseus/sdk";

// Par défaut, on passe par la même adresse que la page : en développement, Vite redirige /colyseus vers le serveur de
// jeu ; en production, c'est le serveur de jeu lui-même qui sert la page. Ça fonctionne en local, depuis un autre PC
// du réseau, ou à travers un tunnel ngrok. VITE_SERVER_URL permet de viser directement un autre serveur.
const serverUrl =
  import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? `${window.location.origin}/colyseus` : window.location.origin);
const client = new Client(serverUrl);

// Rejoint la partie en attente de joueurs, ou en ouvre une nouvelle, sous le pseudo saisi à l'accueil.
export function joinArena(name: string): Promise<Room> {
  return client.joinOrCreate("arena", { name });
}
