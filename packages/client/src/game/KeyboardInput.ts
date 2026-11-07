import { NO_INPUT, type MoveInput } from "@arena/shared";

// event.code désigne la touche physique, indépendamment de la disposition :
// "KeyW" est la touche Z sur un clavier AZERTY, W sur un QWERTY.
const MOVE_BINDINGS: Record<string, keyof MoveInput> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export type KeyAction =
  | "nextTarget"
  | "clearTarget"
  | "targetSelf"
  | "toggleAttack"
  | "respawn"
  | "faceTarget"
  | `slot${number}`;

const ACTION_BINDINGS: Record<string, KeyAction> = {
  Tab: "nextTarget",
  Escape: "clearTarget",
  KeyF: "toggleAttack",
  KeyR: "respawn",
  KeyE: "faceTarget",
  F1: "targetSelf",
  // Rangée des chiffres (touches &, é, "… sur un clavier AZERTY) : barre de compétences.
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`Digit${n}`, `slot${n}` as KeyAction])),
};

// Suit l'état des touches de déplacement et prévient uniquement quand il change,
// pour ne pas envoyer un message réseau à chaque frame. Les autres touches
// déclenchent des actions ponctuelles.
export class KeyboardInput {
  private state: MoveInput = { ...NO_INPUT };

  constructor(
    private onMoveChange: (input: MoveInput) => void,
    private onAction: (action: KeyAction) => void,
  ) {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
  }

  dispose() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    const action = ACTION_BINDINGS[event.code];
    if (action) {
      // Sans ça, Tab déplacerait le focus du navigateur.
      event.preventDefault();
      if (!event.repeat) this.onAction(action);
      return;
    }
    if (event.repeat) return;
    this.setMove(event.code, true);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.setMove(event.code, false);
  };

  // Si la fenêtre perd le focus, on ne recevra pas les keyup : on relâche tout.
  private handleBlur = () => {
    this.state = { ...NO_INPUT };
    this.onMoveChange(this.state);
  };

  private setMove(code: string, pressed: boolean) {
    const direction = MOVE_BINDINGS[code];
    if (!direction || this.state[direction] === pressed) return;
    this.state = { ...this.state, [direction]: pressed };
    this.onMoveChange(this.state);
  }
}
