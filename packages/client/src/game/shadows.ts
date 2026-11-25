import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

// Résolution de la carte d'ombres, et côté (en mètres) de la zone ombrée, centrée sur ce que regarde la caméra :
// limiter la zone garde des ombres nettes sur une carte de 100 m.
const MAP_SIZE = 2048;
// 86 m (60 m avant le 2026-11-21) : suit le recul de la caméra (+25 %, puis +15 %).
const AREA = 86;
// Distance à laquelle on place le soleil, en arrière du point regardé, et profondeur de la zone ombrée.
const SUN_DISTANCE = 60;
const DEPTH = 130;
// Les ombres laissent passer un peu de lumière (la lumière ambiante du ciel éclaire aussi les zones à l'ombre).
const DARKNESS = 0.35;

// Ombres portées du soleil : personnages et décor bâti les projettent ; le sol et le décor les reçoivent.
// La nature (des milliers de copies) et les effets n'en projettent pas : ils coûteraient trop cher.
export class Shadows {
  private generator: ShadowGenerator;
  // Du point regardé jusqu'au soleil.
  private toSun: Vector3;

  constructor(private sun: DirectionalLight) {
    this.toSun = sun.direction.clone().normalize().scale(-SUN_DISTANCE);
    sun.autoUpdateExtends = false;
    sun.autoCalcShadowZBounds = false;
    sun.shadowFrustumSize = AREA;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = DEPTH;

    this.generator = new ShadowGenerator(MAP_SIZE, sun);
    // Bords adoucis par filtrage matériel (WebGL 2), peu coûteux.
    this.generator.usePercentageCloserFiltering = true;
    this.generator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    // Décalages qui évitent les taches parasites (une surface qui s'ombre elle-même).
    this.generator.bias = 0.002;
    this.generator.normalBias = 0.02;
    this.generator.setDarkness(DARKNESS);
  }

  // Ces maillages projettent une ombre (retirés d'eux-mêmes quand ils sont détruits).
  cast(meshes: Iterable<AbstractMesh>) {
    for (const mesh of meshes) this.generator.addShadowCaster(mesh, false);
  }

  // Ces maillages reçoivent les ombres.
  receive(meshes: Iterable<AbstractMesh>) {
    for (const mesh of meshes) mesh.receiveShadows = true;
  }

  // La zone ombrée suit ce que regarde la caméra.
  update(focus: Vector3) {
    focus.addToRef(this.toSun, this.sun.position);
  }

  dispose() {
    this.generator.dispose();
  }
}
