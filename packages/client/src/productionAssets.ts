import { ANIMATION_LIBRARIES, CHARACTERS, teamTexture, usedAnimations } from "./game/characterAssets";
import { MUSIC } from "./game/commonSounds";
import { GROUND_TEXTURES } from "./game/environment";
import { MIXAMO_ANIMATIONS } from "./game/mixamo";
import { NATURE_MODEL } from "./game/nature";
import { VILLAGE_MODEL } from "./game/village";

// Chargé sous Node par le script de déploiement, avec tout ce qu'il importe (Babylon compris) : aucun de ces modules ne
// doit lire import.meta.env à son chargement sans « ?. » (import.meta.env n'existe que sous Vite).
//
// Modèles et textures que le jeu charge (chemins dans public/), tirés des mêmes données que le jeu : lu par
// scripts/deploy-assets.ts, qui n'envoie en production que ces fichiers (les animations Mixamo non attribuées à une
// classe, les modèles des pages de développement… restent sur le poste).
export function productionModels(): string[] {
  const animations = usedAnimations();
  const paths = new Set<string>([VILLAGE_MODEL, NATURE_MODEL]);
  for (const file of Object.values(GROUND_TEXTURES)) paths.add(`models/ground/${file}`);
  for (const library of ANIMATION_LIBRARIES) paths.add(`models/${library}`);
  for (const [name, file] of Object.entries(MIXAMO_ANIMATIONS)) if (animations.has(name)) paths.add(`models/${file}`);
  for (const [classId, def] of Object.entries(CHARACTERS)) {
    for (const model of [def.model, ...def.weapons.map((weapon) => weapon.model)]) {
      // Un chemin absolu désigne un fichier hors de public/models (pages de développement) : jamais en production.
      if (model.startsWith("/")) throw new Error(`Modèle de ${classId} hors de public/models : ${model}`);
      paths.add(`models/${model}`);
    }
    for (const team of [0, 1]) paths.add(teamTexture(classId, team));
  }
  return [...paths].sort();
}

// Musiques jouées par le jeu (public/music/<id>.m4a).
export function productionMusic(): string[] {
  return [...new Set(Object.values(MUSIC))].sort();
}
