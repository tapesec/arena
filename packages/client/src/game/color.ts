// Couleur "#rrggbb" en composantes "r,g,b", à glisser dans rgba(...) pour dessiner sur un canvas.
export function hexToRgb(hex: string): string {
  const value = parseInt(hex.replace("#", ""), 16) || 0;
  return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
}
