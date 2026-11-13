// Raisons pour lesquelles une action est refusée. Le serveur envoie le code (message "error"), le client affiche le
// texte dans la langue du joueur ; la barre d'action s'en sert aussi pour expliquer pourquoi une compétence est grisée.
export type GameErrorCode =
  | "noTarget"
  | "targetNotFound"
  | "targetDead"
  | "targetNotDead"
  | "notHostile"
  | "hostile"
  | "needOtherAlly"
  | "needDeadAlly"
  | "needEnemy"
  | "noDeadAllyInRange"
  | "dead"
  | "incapacitated"
  | "charging"
  | "chargeInterrupted"
  | "rooted"
  | "alreadyCasting"
  | "silenced"
  | "cooldown"
  | "noMana"
  | "noEndurance"
  | "castWhileMoving"
  | "outOfRange"
  | "outOfRangeNearSight"
  | "tooClose"
  | "noLineOfSight"
  | "notFacing"
  | "needBack"
  | "needSide"
  // Combo : ne part que juste après une autre technique (son identifiant est envoyé avec le code).
  | "combo";

// Contenu du message "error" envoyé au joueur.
export interface GameErrorMessage {
  code: GameErrorCode;
  // Compétence citée par le message (l'ouverture d'un combo).
  abilityId?: string;
}
