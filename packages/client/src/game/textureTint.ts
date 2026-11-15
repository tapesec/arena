// Teinte libre d'une texture (éditeur d'apparence) : une des couleurs principales d'un tissu (sa teinte, choisie parmi
// celles que propose mainHues) est remplacée par la couleur choisie, en gardant les ombres et les détails. Les pixels peu
// colorés (métal, gris) ne changent pas.

// Pixels assez colorés pour compter (saturation), et écart de teinte maximal (degrés) autour du groupe remplacé ; une
// part de l'écart d'origine est gardée pour conserver les nuances du tissu.
const MIN_SATURATION = 0.2;
const HUE_WIDTH = 40;
const KEPT_OFFSET = 0.3;

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const saturation = max ? delta / max : 0;
  if (!delta) return [0, saturation, max];
  const sector = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [sector * 60, saturation, max];
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - chroma;
  const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue / 60) % 6];
  return [r + m, g + m, b + m];
}

async function readPixels(url: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  return { canvas, context, pixels: context.getImageData(0, 0, canvas.width, canvas.height) };
}

interface Group {
  hue: number;
  color: string;
  // Luminosité moyenne de ses pixels (0 à 1).
  value: number;
}

// Groupes de couleurs d'une image : teintes les plus présentes parmi les pixels colorés (tranches de 10°, pondérées par
// la saturation), séparées d'au moins 30°, chacune pesant au moins MIN_SHARE du total, avec leur couleur moyenne.
const MIN_SHARE = 0.03;
function groups(data: Uint8ClampedArray, count: number): Group[] {
  const weights = new Array<number>(36).fill(0);
  const sums = Array.from({ length: 36 }, () => [0, 0, 0, 0, 0]);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [hue, saturation, value] = rgbToHsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    if (saturation < MIN_SATURATION || value < 0.1) continue;
    const bin = Math.floor(hue / 10) % 36;
    weights[bin] += saturation;
    total += saturation;
    const sum = sums[bin];
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
    sum[3] += value;
    sum[4] += 1;
  }
  const order = weights.map((weight, bin) => ({ weight, bin })).sort((a, b) => b.weight - a.weight);
  const picked: number[] = [];
  for (const { weight, bin } of order) {
    if (weight < total * MIN_SHARE || picked.length >= count) break;
    if (picked.every((other) => Math.min(Math.abs(other - bin), 36 - Math.abs(other - bin)) >= 3)) picked.push(bin);
  }
  return picked.map((bin) => {
    const [r, g, b, value, n] = sums[bin];
    const hex = [r, g, b].map((c) => Math.round(c / n).toString(16).padStart(2, "0")).join("");
    return { hue: bin * 10 + 5, color: `#${hex}`, value: value / n };
  });
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// Couleurs principales d'une texture (pastilles du choix de la couleur à remplacer).
export async function mainHues(url: string, count = 4): Promise<{ hue: number; color: string }[]> {
  const { pixels } = await readPixels(url);
  return groups(pixels.data, count).map(({ hue, color }) => ({ hue, color }));
}

// Image teinte en adresse data: (PNG), à donner à une texture Babylon : le groupe de couleur de teinte from (une de
// celles de mainHues) prend la couleur color. Chaque pixel coloré appartient au groupe de teinte la plus proche : seuls
// ceux du groupe choisi changent. La luminosité suit celle de la couleur choisie (un bleu marine assombrit le tissu) ;
// une couleur grise donne un tissu gris.
export async function tintImage(url: string, color: string, from: number): Promise<string> {
  const { canvas, context, pixels } = await readPixels(url);
  tintPixels(pixels.data, color, from);
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

// Calcul de tintImage sur les pixels RGBA d'une image (modifiés sur place) : partagé avec la construction des personnages
// du jeu (scripts/build-appearances.ts).
export function tintPixels(data: Uint8ClampedArray, color: string, from: number) {
  const main = groups(data, 4);
  const chosen = main.reduce((best, group) => (hueDistance(group.hue, from) < hueDistance(best.hue, from) ? group : best), main[0]);
  if (!chosen) return;
  const [to, targetSaturation, targetValue] = rgbToHsv(...([1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16) / 255) as [number, number, number]));
  const brightness = targetValue / Math.max(0.05, chosen.value);
  for (let i = 0; i < data.length; i += 4) {
    const [hue, saturation, value] = rgbToHsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    if (saturation < MIN_SATURATION) continue;
    const nearest = main.reduce((best, group) => (hueDistance(group.hue, hue) < hueDistance(best.hue, hue) ? group : best), main[0]);
    const offset = ((hue - chosen.hue + 540) % 360) - 180;
    if (nearest !== chosen || Math.abs(offset) > HUE_WIDTH) continue;
    // Saturation rapprochée de celle de la couleur choisie (un tissu vif devient pastel si on choisit un pastel).
    const newSaturation = targetSaturation < 0.05 ? 0 : Math.min(1, saturation * Math.max(0.2, Math.min(1.6, targetSaturation / 0.6)));
    const [r, g, b] = hsvToRgb((to + offset * KEPT_OFFSET + 360) % 360, newSaturation, Math.min(1, value * brightness));
    data[i] = r * 255;
    data[i + 1] = g * 255;
    data[i + 2] = b * 255;
  }
}

// Palette (grid × grid cases de couleur, comme celle des objets Hearthfold) dont des cases prennent une autre couleur,
// en adresse data: (PNG). Chaque case garde son dégradé : un pixel deux fois plus sombre que la moyenne de sa case reste
// deux fois plus sombre que la couleur choisie.
export async function paintCells(url: string, grid: number, colors: Record<number, string>): Promise<string> {
  const { canvas, context, pixels } = await readPixels(url);
  paintPixels(pixels.data, pixels.width, grid, colors);
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

// Calcul de paintCells sur les pixels RGBA d'une image de cette largeur (modifiés sur place), partagé comme tintPixels.
export function paintPixels(data: Uint8ClampedArray, width: number, grid: number, colors: Record<number, string>) {
  const size = Math.floor(width / grid);
  const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (const [cell, color] of Object.entries(colors)) {
    const index = Number(cell);
    const x0 = (index % grid) * size;
    const y0 = Math.floor(index / grid) * size;
    const target = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16));
    let sum = 0;
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        const i = (y * width + x) * 4;
        sum += luminance(data[i], data[i + 1], data[i + 2]);
      }
    }
    const average = Math.max(1, sum / (size * size));
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        const i = (y * width + x) * 4;
        const factor = luminance(data[i], data[i + 1], data[i + 2]) / average;
        for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, target[c] * factor);
      }
    }
  }
}
