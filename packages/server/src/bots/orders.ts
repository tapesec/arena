import { ORDER_EXECUTORS, distance, type BotReplyMessage, type OrderId } from "@arena/shared";
import type { PlayerRuntime } from "../PlayerRuntime";
import type { BotBrain } from "./BotBrain";

// Transmet l'ordre d'un joueur aux bots de son équipe qui peuvent l'exécuter, et retourne leurs réponses (bulles
// au-dessus de leur tête). Seuls les bots qui peuvent agir (ni mezzés ni stunnés) sont concernés, sauf pour Suivez-moi.
// Les ordres qui ne concernent qu'un bot vont au plus proche qui accepte ; si aucun n'accepte, le plus proche dit
// pourquoi. Assistez-moi et Suivez-moi vont à tous ; Buff please à chaque bot qui a un buff que le joueur n'a pas.
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
      return executors.filter((bot) => !bot.player.incapacitated).map((bot) => answer(bot, target));
    }
    case "follow":
      return executors.map((bot) => answer(bot));
    case "buff": {
      const givers = executors.filter((bot) => !bot.player.incapacitated && bot.missingBuffs(issuer).length > 0);
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

// Au début du combat, les bots de chaque équipe qui compte un joueur humain le suivent, comme un Suivez-moi donné
// d'office, jusqu'au premier ennemi aperçu : un nouveau venu n'est pas laissé seul derrière des bots partis au front.
// Ils suivent le chef d'équipe (premier humain arrivé), à défaut le premier humain de l'équipe. Le suivi cesse aussi
// si ce joueur reste sur place trop longtemps (voir BotBrain.guideIdle). Une équipe sans humain attend
// BOT_TEAM_START_DELAY secondes, puis suit un bot désigné chef (un Gardien, à défaut une Lame) qui explore la carte au
// hasard jusqu'au premier ennemi aperçu, au lieu de foncer droit sur le camp adverse.
export function followHumansAtStart(bots: readonly BotBrain[], players: ReadonlyMap<string, PlayerRuntime>) {
  for (const team of [0, 1]) {
    const teamBots = bots.filter((bot) => bot.player.alive && bot.player.state.team === team);
    const humans = [...players.values()].filter((p) => p.alive && !p.state.isBot && p.state.team === team);
    const guide = humans.find((p) => p.state.leader) ?? humans[0];
    if (guide) {
      for (const bot of teamBots) bot.receiveOrder("follow", guide, null, true);
      continue;
    }
    // Équipe sans humain : attente, puis exploration derrière un chef désigné (décidé le 2026-11-21).
    const leader =
      teamBots.find((bot) => bot.player.classDef.id === "gardien") ??
      teamBots.find((bot) => bot.player.classDef.id === "lame") ??
      teamBots[0];
    if (!leader) continue;
    for (const bot of teamBots) {
      bot.holdStart(BOT_TEAM_START_DELAY);
      if (bot === leader) bot.startScouting();
      else bot.receiveOrder("follow", leader.player, null, true);
    }
  }
}

// Équipe sans joueur humain : temps d'attente après la préparation avant de partir explorer (secondes).
export const BOT_TEAM_START_DELAY = 5;
