import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { Scene } from "@babylonjs/core/scene";

// Point projeté à l'écran, en pixels CSS du canvas (comme scene.pointerX). « visible » : devant la caméra et avant le
// plan lointain.
export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

// Projection de points du monde vers l'écran, appelée des dizaines de fois par image (pseudos, textes flottants, survol,
// flèche de la cible). La taille affichée du canvas est suivie par un ResizeObserver : la lire (clientWidth) juste après
// avoir déplacé un élément HTML forçait le navigateur à recalculer la mise en page, une fois par élément. Rien n'est
// alloué : le résultat est toujours le même objet, à lire avant l'appel suivant.
export class ScreenProjector {
  private cssWidth: number;
  private cssHeight: number;
  private observer: ResizeObserver | null = null;
  private viewport = new Viewport(0, 0, 1, 1);
  private world = new Vector3();
  private projected = new Vector3();
  private out: ScreenPoint = { x: 0, y: 0, visible: false };

  constructor(
    private scene: Scene,
    canvas: HTMLCanvasElement,
  ) {
    this.cssWidth = canvas.clientWidth;
    this.cssHeight = canvas.clientHeight;
    if (typeof ResizeObserver === "function") {
      this.observer = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1].contentRect;
        this.cssWidth = box.width;
        this.cssHeight = box.height;
      });
      this.observer.observe(canvas);
    }
  }

  get width(): number {
    return this.cssWidth;
  }

  get height(): number {
    return this.cssHeight;
  }

  // Projette le point (x, y, z) du monde avec les matrices actuelles de la scène.
  project(x: number, y: number, z: number): ScreenPoint {
    const out = this.out;
    const camera = this.scene.activeCamera;
    if (!camera) {
      out.visible = false;
      return out;
    }
    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    this.world.set(x, y, z);
    Vector3.ProjectToRef(
      this.world,
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobalToRef(width, height, this.viewport),
      this.projected,
    );
    // Le canvas peut être rendu à une résolution différente de sa taille affichée.
    out.x = (this.projected.x * this.cssWidth) / width;
    out.y = (this.projected.y * this.cssHeight) / height;
    out.visible = this.projected.z >= 0 && this.projected.z <= 1;
    return out;
  }

  dispose() {
    this.observer?.disconnect();
  }
}
