import { NO_INPUT, movesBody, type ClassDef, type EffectKind, type MoveInput } from "@arena/shared";
import type { EffectState, PlayerState } from "./state";

export interface ActiveEffect {
  kind: EffectKind;
  // Durée restante en secondes (Infinity pour un effet permanent).
  remaining: number;
  // Durée totale, au moment de l'application ou du dernier rafraîchissement.
  duration: number;
  // Joueur à l'origine de l'effet (Prêtre pour un buff, Gardien pour une garde…).
  sourceId: string;
  // Valeur propre à l'effet, par exemple le pourcentage de ralentissement.
  value: number;
  // Posé par un sort magique (mana) : le Cri de ralliement le retire et en protège.
  magic: boolean;
  // Dégâts ou soin sur la durée (Brûlure, Renouveau) : compétence d'origine, tics déjà faits et nombre total, dégâts
  // ou soin ; value = montant par tic.
  ticks?: { abilityId: string; done: number; total: number; kind: "damage" | "heal" };
  // Copie synchronisée vers les clients.
  view: EffectState;
}

// Tout ce que le serveur sait d'un joueur, y compris ce qui n'est jamais envoyé aux clients.
export class PlayerRuntime {
  input: MoveInput = NO_INPUT;
  targetId: string | null = null;
  // Temps restant avant le prochain coup d'attaque automatique.
  swingTimer = 0;
  // Cible verrouillée au début de l'incantation.
  castTargetId: string | null = null;
  // Incantation protégée par Concentration : ni les dégâts ni le Silence ne l'interrompent.
  castProtected = false;
  // Le combo se perd si le coup d'arme suivant ne part pas à temps (un round d'attaque manqué).
  comboExpiresAt = 0;
  // Instant (temps de la partie, en secondes) où chaque compétence redevient disponible.
  cooldowns = new Map<string, number>();
  effects: ActiveEffect[] = [];
  songSuppressedUntil = 0;
  // Dernier coup de mêlée reçu (temps de la partie) et son auteur : sert aux bots pour fuir ou protéger.
  lastMeleeHitAt = -Infinity;
  lastMeleeAttackerId: string | null = null;
  // Le stick fait avancer le personnage vers sa cible pendant ce tick.
  stickMoving = false;
  // Charge en cours : cible, temps écoulé, temps passé bloqué, dégâts et stun à l'arrivée.
  charge: { targetId: string; elapsed: number; stuck: number; damage: number; stun: number } | null = null;

  constructor(
    readonly id: string,
    readonly state: PlayerState,
    readonly classDef: ClassDef,
  ) {}

  get alive(): boolean {
    return this.state.hp > 0;
  }

  getEffect(kind: EffectKind): ActiveEffect | undefined {
    return this.effects.find((e) => e.kind === kind);
  }

  has(kind: EffectKind): boolean {
    return this.effects.some((e) => e.kind === kind);
  }

  // Mez, stun, ou Rempart (le Gardien se fige) : ne peut plus agir du tout.
  get incapacitated(): boolean {
    return this.has("mez") || this.has("stun") || this.has("rampart");
  }

  // Mez, stun, ou root (qui ne laisse que lentement reprendre de la vitesse).
  get immobilized(): boolean {
    return this.incapacitated || this.has("root");
  }

  // Le personnage se déplace (pivoter sur place ne compte pas) : interdit d'incanter.
  get isMoving(): boolean {
    return movesBody(this.input) || this.stickMoving;
  }
}
