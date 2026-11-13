import type { OrderId } from "@arena/shared";
import { useHudStore, type OrderWheelFrame } from "../store";

// En deçà de cette distance au centre (pixels), aucun ordre n'est pointé : relâcher la molette ne donne rien.
const DEAD_ZONE = 30;

// Case de la roue pointée par la souris, décalée de (dx, dy) pixels par rapport au centre : la case 0 est en haut, les
// suivantes dans le sens des aiguilles d'une montre. null au centre.
export function wheelSlot(dx: number, dy: number, count: number): number | null {
  if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
  // Angle depuis le haut de l'écran, croissant dans le sens horaire (l'axe y de l'écran pointe vers le bas).
  const angle = Math.atan2(dx, -dy);
  const slot = Math.round(angle / ((2 * Math.PI) / count));
  return ((slot % count) + count) % count;
}

// Roue des ordres aux bots : molette enfoncée, elle s'ouvre là où est la souris ; on pointe un ordre et on relâche
// pour le donner. L'interface (App.tsx) l'affiche d'après le store.
export class OrderWheel {
  private pointerId: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    // Ordres de la roue, ou null si elle ne peut pas s'ouvrir (pas en combat, mort…).
    private items: () => OrderWheelFrame["items"] | null,
    private send: (order: OrderId) => void,
  ) {
    canvas.addEventListener("pointerdown", this.handleDown);
    canvas.addEventListener("pointermove", this.handleMove);
    canvas.addEventListener("pointerup", this.handleUp);
    canvas.addEventListener("pointercancel", this.close);
    // Clic molette : pas de défilement automatique du navigateur.
    canvas.addEventListener("mousedown", this.preventMiddle);
    window.addEventListener("blur", this.close);
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.handleDown);
    this.canvas.removeEventListener("pointermove", this.handleMove);
    this.canvas.removeEventListener("pointerup", this.handleUp);
    this.canvas.removeEventListener("pointercancel", this.close);
    this.canvas.removeEventListener("mousedown", this.preventMiddle);
    window.removeEventListener("blur", this.close);
    this.close();
  }

  private handleDown = (event: PointerEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    const items = this.items();
    if (!items) return;
    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    useHudStore.getState().setOrderWheel({ x: event.clientX, y: event.clientY, items, selected: null });
  };

  private handleMove = (event: PointerEvent) => {
    // Molette enfoncée ou relâchée pendant qu'un autre bouton est tenu (clic droit pour s'orienter) : le navigateur
    // ne signale qu'un déplacement, avec le bouton qui a changé.
    if (event.button === 1) {
      if (event.buttons & 4) this.handleDown(event);
      else this.handleUp(event);
      return;
    }
    const wheel = useHudStore.getState().orderWheel;
    if (!wheel || event.pointerId !== this.pointerId) return;
    const slot = wheelSlot(event.clientX - wheel.x, event.clientY - wheel.y, wheel.items.length);
    const selected = slot !== null && wheel.items[slot].enabled ? slot : null;
    if (selected !== wheel.selected) useHudStore.getState().setOrderWheel({ ...wheel, selected });
  };

  private handleUp = (event: PointerEvent) => {
    if (event.button !== 1 || event.pointerId !== this.pointerId) return;
    const wheel = useHudStore.getState().orderWheel;
    const order = wheel && wheel.selected !== null ? wheel.items[wheel.selected].id : null;
    this.close();
    if (order) this.send(order);
  };

  // La capture du pointeur se relâche d'elle-même quand plus aucun bouton n'est tenu (le clic droit peut en avoir
  // encore besoin).
  private close = () => {
    this.pointerId = null;
    if (useHudStore.getState().orderWheel) useHudStore.getState().setOrderWheel(null);
  };

  private preventMiddle = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  };
}
