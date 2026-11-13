import type { ClassId } from "./classes";

// Ordres qu'un joueur donne aux bots de son équipe (roue de la molette), dans l'ordre de la roue en partant du haut,
// dans le sens des aiguilles d'une montre.
export const ORDERS = ["follow", "assist", "protect", "heal", "awaken", "resource", "speed", "buff"] as const;
export type OrderId = (typeof ORDERS)[number];

// Classes de bot capables d'exécuter chaque ordre.
export const ORDER_EXECUTORS: Record<OrderId, readonly ClassId[]> = {
  follow: ["gardien", "arcaniste", "pretre", "barde", "lame"],
  assist: ["lame", "arcaniste", "gardien"],
  protect: ["gardien"],
  heal: ["pretre"],
  awaken: ["barde"],
  resource: ["barde"],
  speed: ["barde"],
  buff: ["pretre", "barde"],
};

// Soigne-moi : priorité de soin au plus ce temps (secondes). Assistez-moi : un Gardien n'obéit que ce temps.
export const HEAL_ORDER_DURATION = 10;
export const GARDIEN_ASSIST_DURATION = 10;

// Réponse d'un bot à un ordre : il obéit (la réponse dépend de l'ordre) ou il dit pourquoi il ne peut pas.
export type OrderReply =
  | OrderId
  | "noMana"
  | "cooldown"
  | "noTarget"
  | "notMezzed"
  | "full"
  | "alreadyBuffed";

export interface OrderMessage {
  order: OrderId;
}

export interface BotReplyMessage {
  botId: string;
  reply: OrderReply;
}

export function isOrderId(value: unknown): value is OrderId {
  return typeof value === "string" && (ORDERS as readonly string[]).includes(value);
}

// L'ordre a-t-il un sens pour ce joueur avec ces bots vivants dans son équipe ? (Sinon il est grisé dans la roue.)
export function orderAvailable(order: OrderId, issuerClass: ClassId, botClasses: Iterable<ClassId>): boolean {
  if (order === "protect" && issuerClass === "gardien") return false;
  for (const classId of botClasses) if (ORDER_EXECUTORS[order].includes(classId)) return true;
  return false;
}
