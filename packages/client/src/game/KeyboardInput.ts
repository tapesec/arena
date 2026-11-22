import { NO_INPUT, type MoveInput } from "@arena/shared";
import { useHudStore } from "../store";

// event.code désigne la touche physique, indépendamment de la disposition :
// "KeyW" est la touche Z sur un clavier AZERTY, W sur un QWERTY.
// Z/S avancent et reculent, Q/D pivotent (ou font un pas de côté avec le clic droit maintenu).
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
  | "faceLock"
  | "stick"
  | "resetCamera"
  | "roll"
  | `group${number}`
  | `slot${number}`;

const ACTION_BINDINGS: Record<string, KeyAction> = {
  Tab: "nextTarget",
  Escape: "clearTarget",
  KeyR: "toggleAttack",
  KeyF: "faceLock",
  KeyC: "stick",
  KeyV: "resetCamera",
  Space: "roll",
  F1: "targetSelf",
  // F2 à F8 : membres du groupe, dans l'ordre de la fenêtre de groupe.
  ...Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((n) => [`F${n}`, `group${n - 1}` as KeyAction])),
  // Rangée des chiffres (touches &, é, "… sur un clavier AZERTY) : barre de compétences, 0 pour la dixième.
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`Digit${n}`, `slot${n}` as KeyAction])),
  Digit0: "slot10",
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
    // Partie finie : le clavier sert aux boutons de l'écran de fin (Tab, Entrée), plus au personnage.
    if (useHudStore.getState().match?.phase === "ended") return;
    const action = ACTION_BINDINGS[event.code];
    // Espace (roulade) ne doit pas aussi cliquer le bouton qui a gardé le focus (son, langue…).
    if (action === "roll" && document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
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
