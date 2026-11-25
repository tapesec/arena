// Règles de combat pures, sans état du système : régénération, coûts, facteurs de buff, combo, partage des soins,
// atténuation des zones.

import {
  DEXTERITY_FACTOR,
  ENDURANCE_REGEN,
  MANA_REGEN,
  SECOND_WIND_ENDURANCE_REGEN,
  SECOND_WIND_MANA_REGEN,
  STRENGTH_BUFF_BONUS,
  distance,
  type AbilityDef,
  type AbilityEffect,
  type GameErrorCode,
} from "@arena/shared";
import type { PlayerRuntime } from "../PlayerRuntime";

export function updateRegen(player: PlayerRuntime, dt: number) {
  const state = player.state;
  // Chant de second souffle d'un Barde proche : régénération en plus.
  const song = player.has("secondWind");
  if (state.maxMana > 0) {
    state.mana = Math.min(state.maxMana, state.mana + (MANA_REGEN + (song ? SECOND_WIND_MANA_REGEN : 0)) * dt);
  }
  if (state.maxEndurance > 0) {
    const regen = ENDURANCE_REGEN + (song ? SECOND_WIND_ENDURANCE_REGEN : 0);
    state.endurance = Math.min(state.maxEndurance, state.endurance + regen * dt);
  }
}

// Couper son chant ne coûte rien : seule l'activation se paie.
export function costOf(caster: PlayerRuntime, ability: AbilityDef): number {
  return stopsSong(caster, ability) ? 0 : ability.cost;
}

export function stopsSong(caster: PlayerRuntime, ability: AbilityDef): boolean {
  return caster.state.song === ability.id && isSong(ability);
}

export function dexterityFactor(player: PlayerRuntime): number {
  return player.has("buffDexterity") ? DEXTERITY_FACTOR : 1;
}

// Bonus du buff de puissance, sur les dégâts comme sur les soins du lanceur.
export function powerFactor(source: PlayerRuntime): number {
  return source.has("buffStrength") ? 1 + STRENGTH_BUFF_BONUS : 1;
}

// Combo : la technique d'ouverture (opener) doit avoir porté sur la même cible au coup d'arme précédent.
export function comboError(ability: AbilityDef, opener: string, openerTargetId: string, targetId: string): GameErrorCode | null {
  if (!ability.after || (opener === ability.after && openerTargetId === targetId)) return null;
  return "combo";
}

// Soin réparti (Soin de groupe) : le total, augmenté par le buff de puissance, est partagé au prorata des points de
// vie qui manquent à chacun ; personne n'en reçoit plus qu'il ne lui en manque, le surplus est perdu.
export function splitHealShares(caster: PlayerRuntime, amount: number, targets: PlayerRuntime[]): Map<string, number> {
  const shares = new Map<string, number>();
  const total = amount * powerFactor(caster);
  const missing = targets.map((p) => Math.max(0, p.state.maxHp - p.state.hp));
  const totalMissing = missing.reduce((sum, value) => sum + value, 0);
  targets.forEach((p, i) => {
    // Arrondi à l'unité inférieure : le total distribué ne dépasse jamais le soin.
    shares.set(p.id, totalMissing <= total ? missing[i] : Math.floor((total * missing[i]) / totalMissing));
  });
  return shares;
}

// Chant du Barde (à activer ou couper).
export function isSong(ability: AbilityDef): boolean {
  return ability.effects.some((effect) => effect.type === "toggleSong");
}

// Dégâts décroissants du centre vers le bord d'une zone d'effet (edgeAmount au bord du rayon).
export function withFalloff(effect: AbilityEffect, ability: AbilityDef, center: PlayerRuntime, target: PlayerRuntime): AbilityEffect {
  if (effect.type !== "damage" || effect.edgeAmount === undefined || !ability.radius) return effect;
  const ratio = Math.min(1, distance(center.state, target.state) / ability.radius);
  return { ...effect, amount: Math.round(effect.amount + (effect.edgeAmount - effect.amount) * ratio) };
}
