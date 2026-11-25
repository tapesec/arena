import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

// Images des textures décodées hors du fil principal (ImageBitmap) : par défaut, Babylon passe par une balise <img> que
// le navigateur décode au moment de l'envoi à la carte graphique, en bloquant l'affichage 10 à 60 ms par texture. Au
// chargement (écran de choix, préchargement de l'arène), des dizaines de textures arrivent à la suite : les personnages
// du lobby saccadaient. Babylon retourne lui-même l'image (imageOrientation) comme il le fait pour une balise <img>.
export function decodeImagesOffThread(engine: AbstractEngine) {
  if (typeof createImageBitmap === "function") engine._features.forceBitmapOverHTMLImageElement = true;
}
