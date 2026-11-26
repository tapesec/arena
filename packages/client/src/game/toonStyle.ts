import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Scene } from "@babylonjs/core/scene";

// Essai de style graphique (développement seulement, adresse ?style=toon) : ombrage en paliers façon dessin animé et
// liseré de lumière sur les bords, pour juger à la distance de jeu si le rendu
// « colle » mieux. Rien n'est activé sans le paramètre.

// Paliers de luminosité (après le rendu PBR) : la couleur garde sa teinte, sa luminosité est tirée vers le palier le
// plus proche ; liseré : lumière ajoutée là où la surface est vue de profil.
const TOON_CODE = `
float toonLum = dot(finalColor.rgb, vec3(0.299, 0.587, 0.114));
float toonBand = toonLum < 0.16 ? 0.10 : toonLum < 0.42 ? 0.32 : toonLum < 0.72 ? 0.60 : 0.88;
finalColor.rgb = finalColor.rgb / max(toonLum, 0.001) * mix(toonLum, toonBand, 0.75);
float toonRim = pow(1.0 - clamp(dot(normalize(normalW), normalize(viewDirectionW)), 0.0, 1.0), 3.0);
finalColor.rgb += vec3(toonRim * 0.35);
`;

class ToonPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "Toon", 200, undefined, true, true);
  }

  override getClassName() {
    return "ToonPlugin";
  }

  override isCompatible(shaderLanguage: number) {
    // GLSL seulement (WebGL).
    return shaderLanguage === 0;
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    return shaderType === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: TOON_CODE } : null;
  }
}

// Active le style sur les matériaux PBR (personnages, décor : tous les modèles glTF) existants et à venir (le contour des
// personnages, lui, est toujours là : voir characterAssets).
export function enableToonStyle(scene: Scene) {
  const styled = new WeakSet<Material>();
  const apply = (material: Material) => {
    if (!(material instanceof PBRMaterial) || material.unlit || styled.has(material)) return;
    styled.add(material);
    new ToonPlugin(material);
  };
  for (const material of scene.materials) apply(material);
  scene.onNewMaterialAddedObservable.add(apply);
}

// Paramètre d'adresse ?style=toon, en développement.
export function toonStyleRequested(): boolean {
  return import.meta.env.DEV && new URLSearchParams(location.search).get("style") === "toon";
}
