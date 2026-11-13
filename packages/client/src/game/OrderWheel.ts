import type { OrderId } from "@arena/shared";
import { useHudStore, type OrderWheelFrame } from "../store";

// Trou au centre de la roue (rayon en pixels) : la souris n'y pointe aucun ordre, relâcher la molette ne donne rien.
export const WHEEL_INNER = 50;

// Case de la roue pointée par la souris, décalée de (dx, dy) pixels par rapport au centre : la case 0 est en haut, les
// suivantes dans le sens des aiguilles d'une montre. null au centre.
export function wheelSlot(dx: number, dy: number, count: number): number | null {
  if (Math.hypot(dx, dy) < WHEEL_INNER) return null;
  // Angle depuis le haut de l'écran, croissant dans le sens horaire (l'axe y de l'écran pointe vers le bas).
  const angle = Math.atan2(dx, -dy);
  const slot = Math.round(angle / ((2 * Math.PI) / count));
  return ((slot % count) + count) % count;
}

// Roue des ordres aux bots : molette enfoncée, elle s'ouvre là où est la souris ; on pointe un ordre et on relâche
// pour le donner. L'interface (App.tsx) l'affiche d'après le store.
export class OrderWheel {
  private pointerId: number | null = null;
  // Position de la souris par rapport au centre de la roue.
  private lastOffset = { dx: 0, dy: 0 };

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
    this.lastOffset = { dx: 0, dy: 0 };
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
    this.refresh(event.clientX - wheel.x, event.clientY - wheel.y);
  };

  // Recalcule les ordres possibles (la situation change pendant que la roue est ouverte : un soin, une cible qui
  // meurt…) et l'ordre pointé ; la roue se ferme si elle ne peut plus être ouverte (mort, fin du combat).
  private refresh(dx: number, dy: number) {
    const wheel = useHudStore.getState().orderWheel;
    if (!wheel) return;
    const items = this.items();
    if (!items) return this.close();
    const slot = wheelSlot(dx, dy, items.length);
    const selected = slot !== null && items[slot].enabled ? slot : null;
    const changed = selected !== wheel.selected || items.some((item, i) => item.enabled !== wheel.items[i]?.enabled || item.label !== wheel.items[i]?.label);
    if (changed) useHudStore.getState().setOrderWheel({ ...wheel, items, selected });
    this.lastOffset = { dx, dy };
  }

  // Appelé à chaque image par le jeu : la roue suit la situation même si la souris ne bouge pas.
  update() {
    if (this.pointerId !== null) this.refresh(this.lastOffset.dx, this.lastOffset.dy);
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
