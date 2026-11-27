import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// Éclairage d'une scène : lumière du ciel (hémisphérique) et soleil (directionnel).
export interface Lighting {
  sky: { direction: Vector3; intensity: number; diffuse: Color3; groundColor: Color3 };
  sun: { direction: Vector3; intensity: number; diffuse: Color3 };
}

// Éclairage du jeu, partagé avec la Vue de jeu de l'éditeur (le réglage des personnages s'y fait sous la même lumière).
export const GAME_LIGHTING: Lighting = {
  // Ciel bleuté au-dessus, reflet vert de l'herbe en dessous.
  sky: { direction: new Vector3(0, 1, 0), intensity: 0.95, diffuse: new Color3(0.8, 0.88, 1), groundColor: new Color3(0.35, 0.42, 0.28) },
  // Lumière chaude de fin d'après-midi ; direction vers le bas (le soleil du ciel est placé à l'opposé).
  sun: { direction: new Vector3(-0.5, -1, 0.3).normalize(), intensity: 1.5, diffuse: new Color3(1, 0.93, 0.8) },
};

export function applyLighting(sky: HemisphericLight, sun: DirectionalLight, lighting: Lighting) {
  sky.direction.copyFrom(lighting.sky.direction);
  sky.intensity = lighting.sky.intensity;
  sky.diffuse.copyFrom(lighting.sky.diffuse);
  sky.groundColor.copyFrom(lighting.sky.groundColor);
  sun.direction.copyFrom(lighting.sun.direction);
  sun.intensity = lighting.sun.intensity;
  sun.diffuse.copyFrom(lighting.sun.diffuse);
}
