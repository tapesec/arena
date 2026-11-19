import type { OrderId } from "@arena/shared";
import { WHEEL_INNER } from "./game/OrderWheel";

// Dessin de la roue des ordres aux bots : un disque semi-transparent découpé en parts, une par ordre, le premier en
// haut puis dans le sens des aiguilles d'une montre. Centré sur le point où il est placé (son conteneur, de taille
// nulle). Utilisé en jeu (OrderWheelView) et pour l'illustrer dans le didacticiel.

// Rayon extérieur du disque (pixels ; l'intérieur, WHEEL_INNER, sert aussi à choisir l'ordre), et rayon où sont écrits
// les ordres.
const WHEEL_OUTER = 180;
const WHEEL_LABEL = (WHEEL_OUTER + WHEEL_INNER) / 2;

export interface OrderWheelItem {
  id: OrderId;
  label: string;
  enabled: boolean;
}

// Point à la distance radius du centre, dans la direction angle (0 en haut, sens horaire), dans le repère du SVG.
function wheelPoint(angle: number, radius: number): string {
  return `${WHEEL_OUTER + Math.sin(angle) * radius},${WHEEL_OUTER - Math.cos(angle) * radius}`;
}

// Part de disque (couronne) centrée sur center, d'ouverture span.
function wheelSector(center: number, span: number): string {
  const from = center - span / 2;
  const to = center + span / 2;
  return [
    `M ${wheelPoint(from, WHEEL_INNER)}`,
    `L ${wheelPoint(from, WHEEL_OUTER)}`,
    `A ${WHEEL_OUTER} ${WHEEL_OUTER} 0 0 1 ${wheelPoint(to, WHEEL_OUTER)}`,
    `L ${wheelPoint(to, WHEEL_INNER)}`,
    `A ${WHEEL_INNER} ${WHEEL_INNER} 0 0 0 ${wheelPoint(from, WHEEL_INNER)}`,
    "Z",
  ].join(" ");
}

export function OrderWheelGraphic({ items, selected }: { items: OrderWheelItem[]; selected: number | null }) {
  const span = (2 * Math.PI) / items.length;
  const size = WHEEL_OUTER * 2;
  return (
    <>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {items.map((item, index) =>
          index === selected ? null : (
            <path key={item.id} className={`order-wheel-sector${item.enabled ? "" : " order-wheel-disabled"}`} d={wheelSector(index * span, span)} />
          ),
        )}
        {/* La part pointée en dernier : son contour doré passe par-dessus ceux de ses voisines. */}
        {selected !== null && <path className="order-wheel-sector order-wheel-selected" d={wheelSector(selected * span, span)} />}
      </svg>
      {items.map((item, index) => {
        const angle = index * span;
        const classes = ["order-wheel-label"];
        if (!item.enabled) classes.push("order-wheel-disabled");
        if (index === selected) classes.push("order-wheel-selected");
        const x = Math.sin(angle) * WHEEL_LABEL;
        const y = -Math.cos(angle) * WHEEL_LABEL;
        return (
          <div key={item.id} className={classes.join(" ")} style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}>
            {item.label}
          </div>
        );
      })}
    </>
  );
}
