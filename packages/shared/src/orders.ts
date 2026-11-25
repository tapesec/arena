import { getAbility } from "./abilities";
import type { ClassId } from "./classes";
import type { EffectKind } from "./effects";

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
  | "alreadyBuffed"
  | "alreadySinging";

export interface BotReplyMessage {
  botId: string;
  reply: OrderReply;
}

export function isOrderId(value: unknown): value is OrderId {
  return typeof value === "string" && (ORDERS as readonly string[]).includes(value);
}

// Ce que la roue sait de la situation pour griser les ordres impossibles sur le moment.
export interface OrderSituation {
  issuer: {
    classId: ClassId;
    hurt: boolean;
    mezzed: boolean;
    // Mana ou endurance, selon sa classe, au maximum.
    resourceFull: boolean;
    // Effets en cours (pour les buffs qu'il a déjà).
    effects: ReadonlySet<string>;
  };
  // Le joueur a un ennemi vivant en cible.
  hasEnemyTarget: boolean;
  // Bots vivants de son équipe.
  bots: readonly { classId: ClassId; mana: number; song: string; incapacitated: boolean }[];
}

// Buffs que chaque classe de bot lance sur demande (Buff please).
export const ORDER_BUFFS: Partial<Record<ClassId, readonly EffectKind[]>> = {
  pretre: ["buffHp", "buffStrength"],
  barde: ["buffDexterity"],
};

// L'ordre peut-il être exécuté maintenant ? Sinon il est grisé dans la roue. (La recharge des compétences des bots
// n'est pas connue du client : un bot dont le Réveil recharge répond qu'il n'est pas prêt.)
export function orderAvailable(order: OrderId, situation: OrderSituation): boolean {
  const { issuer, bots } = situation;
  // Bots qui peuvent exécuter l'ordre et agir (ni mezzés ni stunnés ; pour Suivez-moi, ils suivront après) ; ceux qui
  // ont le mana de la compétence demandée.
  const able = bots.filter((bot) => ORDER_EXECUTORS[order].includes(bot.classId) && (order === "follow" || !bot.incapacitated));
  const withMana = (abilityId: string) => able.some((bot) => bot.mana >= (getAbility(abilityId)?.cost ?? 0));
  switch (order) {
    case "follow":
      return able.length > 0;
    case "assist":
      return situation.hasEnemyTarget && able.length > 0;
    case "protect":
      return issuer.classId !== "gardien" && able.length > 0;
    case "heal":
      return issuer.hurt && withMana("heal");
    case "awaken":
      return issuer.mezzed && withMana("awaken");
    case "resource":
      return !issuer.resourceFull && (able.some((bot) => bot.song === "secondWind") || withMana("secondWind"));
    case "speed":
      return able.some((bot) => bot.song !== "speedSong");
    case "buff":
      return able.some((bot) =>
        (ORDER_BUFFS[bot.classId] ?? []).some((buff) => !issuer.effects.has(buff) && bot.mana >= (getAbility(buff)?.cost ?? 0)),
      );
  }
}
