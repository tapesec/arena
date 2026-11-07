import { NO_INPUT, type MoveInput } from "@arena/shared";

// event.code désigne la touche physique, indépendamment de la disposition :
// "KeyW" est la touche Z sur un clavier AZERTY, W sur un QWERTY.
const KEY_BINDINGS: Record<string, keyof MoveInput> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

// Suit l'état des touches de déplacement et prévient uniquement quand il change,
// pour ne pas envoyer un message réseau à chaque frame.
export class KeyboardInput {
  private state: MoveInput = { ...NO_INPUT };

  constructor(private onChange: (input: MoveInput) => void) {
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
    if (event.repeat) return;
    this.set(event.code, true);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.set(event.code, false);
  };

  // Si la fenêtre perd le focus, on ne recevra pas les keyup : on relâche tout.
  private handleBlur = () => {
    this.state = { ...NO_INPUT };
    this.onChange(this.state);
  };

  private set(code: string, pressed: boolean) {
    const action = KEY_BINDINGS[code];
    if (!action || this.state[action] === pressed) return;
    this.state = { ...this.state, [action]: pressed };
    this.onChange(this.state);
  }
}
