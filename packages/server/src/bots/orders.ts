import { ORDER_EXECUTORS, distance, type BotReplyMessage, type OrderId } from "@arena/shared";
import type { PlayerRuntime } from "../PlayerRuntime";
import type { BotBrain } from "./BotBrain";

// Transmet l'ordre d'un joueur aux bots de son équipe qui peuvent l'exécuter, et retourne leurs réponses (bulles
// au-dessus de leur tête). Les ordres qui ne concernent qu'un bot vont au plus proche qui peut agir (pas sous mez ni
// stun) et accepte ; si aucun n'accepte, le plus proche dit pourquoi. Assistez-moi et
// Suivez-moi vont à tous ; Buff please à chaque bot qui a un buff que le joueur n'a pas.
// visible : joueurs que l'équipe voit (la cible d'Assistez-moi doit en faire partie).
export function dispatchOrder(
  kind: OrderId,
  issuer: PlayerRuntime,
  bots: readonly BotBrain[],
  players: ReadonlyMap<string, PlayerRuntime>,
  visible: ReadonlySet<string>,
): BotReplyMessage[] {
  if (kind === "protect" && issuer.classDef.id === "gardien") return [];
  const executors = bots
    .filter(
      (bot) =>
        bot.player.alive &&
        bot.player.state.team === issuer.state.team &&
        ORDER_EXECUTORS[kind].includes(bot.player.classDef.id),
    )
    .sort((a, b) => distance(a.player.state, issuer.state) - distance(b.player.state, issuer.state));
  const nearest = executors[0];
  if (!nearest) return [];
  const answer = (bot: BotBrain, target: PlayerRuntime | null = null): BotReplyMessage => ({
    botId: bot.player.id,
    reply: bot.receiveOrder(kind, issuer, target),
  });

  switch (kind) {
    case "assist": {
      const target = issuer.targetId ? players.get(issuer.targetId) : undefined;
      const valid = !!target && target.alive && target.state.team !== issuer.state.team && visible.has(target.id);
      if (!valid) return [{ botId: nearest.player.id, reply: "noTarget" }];
      return executors.map((bot) => answer(bot, target));
    }
    case "follow":
      return executors.map((bot) => answer(bot));
    case "buff": {
      const givers = executors.filter((bot) => bot.missingBuffs(issuer).length > 0);
      if (givers.length === 0) return [{ botId: nearest.player.id, reply: "alreadyBuffed" }];
      return givers.map((bot) => answer(bot));
    }
    default: {
      let refusal: BotReplyMessage | null = null;
      for (const bot of executors) {
        if (bot.player.incapacitated) continue;
        const reply = answer(bot);
        if (reply.reply === kind) return [reply];
        refusal ??= reply;
      }
      return refusal ? [refusal] : [];
    }
  }
}
