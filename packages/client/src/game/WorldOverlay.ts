import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

// Durée de vie d'un texte flottant et distance parcourue vers le haut, en pixels.
const TEXT_DURATION = 1.2;
const TEXT_RISE = 45;
// Hauteur au-dessus des pieds où apparaissent textes et indicateurs.
const TEXT_HEIGHT = 2.2;
const INDICATOR_HEIGHT = 2.4;
// Au-delà, les textes les plus anciens disparaissent (évite d'encombrer l'écran en 8v8).
const MAX_TEXTS = 60;

export type FloatingTextStyle = "damageDealt" | "damageTaken" | "heal" | "info" | "control";
export type StatusIndicator = "mez" | "stun";

interface FloatingText {
  element: HTMLDivElement;
  anchor: TransformNode;
  age: number;
  // Petit décalage horizontal aléatoire pour que les textes simultanés ne se superposent pas.
  offsetX: number;
}

interface Indicator {
  element: HTMLDivElement;
  anchor: TransformNode;
  kind: StatusIndicator;
}

// Couche HTML posée sur le canvas : textes flottants (dégâts, soins…) et indicateurs de contrôle
// au-dessus des têtes. Pilotée par la boucle de jeu, pas par React, pour rester légère.
export class WorldOverlay {
  private texts: FloatingText[] = [];
  private pool: HTMLDivElement[] = [];
  private indicators = new Map<string, Indicator>();
  private projected = new Vector3();
  private worldPos = new Vector3();

  constructor(
    private container: HTMLElement,
    private scene: Scene,
  ) {}

  addText(anchor: TransformNode, text: string, style: FloatingTextStyle, big = false) {
    if (this.texts.length >= MAX_TEXTS) this.recycle(this.texts.shift()!);
    const element = this.pool.pop() ?? document.createElement("div");
    element.className = `float-text float-${style}${big ? " float-big" : ""}`;
    element.textContent = text;
    this.container.appendChild(element);
    this.texts.push({ element, anchor, age: 0, offsetX: (Math.random() - 0.5) * 40 });
  }

  // Affiche (ou retire, avec null) l'indicateur de contrôle d'un joueur.
  setIndicator(playerId: string, anchor: TransformNode, kind: StatusIndicator | null) {
    const current = this.indicators.get(playerId);
    if (current?.kind === kind) return;
    current?.element.remove();
    this.indicators.delete(playerId);
    if (!kind) return;

    const element = document.createElement("div");
    element.className = `status-indicator status-${kind}`;
    // Chaque lettre ou étoile est un élément à part, pour pouvoir l'animer en décalé.
    for (const symbol of kind === "mez" ? ["Z", "z", "z"] : ["★", "★", "★"]) {
      const span = document.createElement("span");
      span.textContent = symbol;
      element.appendChild(span);
    }
    this.container.appendChild(element);
    this.indicators.set(playerId, { element, anchor, kind });
  }

  // Les textes rattachés à un joueur disparu sont retirés à la prochaine mise à jour.
  removePlayer(playerId: string) {
    this.indicators.get(playerId)?.element.remove();
    this.indicators.delete(playerId);
  }

  update(dt: number) {
    for (const text of [...this.texts]) {
      text.age += dt;
      if (text.age >= TEXT_DURATION || text.anchor.isDisposed()) {
        this.removeText(text);
        continue;
      }
      const progress = text.age / TEXT_DURATION;
      const screen = this.toScreen(text.anchor, TEXT_HEIGHT);
      if (!screen) {
        text.element.style.opacity = "0";
        continue;
      }
      text.element.style.transform =
        `translate(${screen.x + text.offsetX}px, ${screen.y - progress * TEXT_RISE}px) translate(-50%, -50%)`;
      // Pleinement visible, puis s'estompe sur le dernier tiers.
      text.element.style.opacity = String(progress < 0.66 ? 1 : 1 - (progress - 0.66) / 0.34);
    }

    for (const indicator of this.indicators.values()) {
      const screen = this.toScreen(indicator.anchor, INDICATOR_HEIGHT);
      indicator.element.style.opacity = screen ? "1" : "0";
      if (screen) indicator.element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
    }
  }

  dispose() {
    for (const text of this.texts) text.element.remove();
    for (const indicator of this.indicators.values()) indicator.element.remove();
    this.texts = [];
    this.indicators.clear();
  }

  // Position à l'écran (en pixels CSS) d'un point situé à "height" au-dessus de l'ancre, ou null s'il est hors champ.
  private toScreen(anchor: TransformNode, height: number): { x: number; y: number } | null {
    const camera = this.scene.activeCamera;
    if (!camera) return null;
    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const renderHeight = engine.getRenderHeight();
    this.worldPos.copyFrom(anchor.getAbsolutePosition());
    this.worldPos.y += height;
    Vector3.ProjectToRef(
      this.worldPos,
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(width, renderHeight),
      this.projected,
    );
    if (this.projected.z < 0 || this.projected.z > 1) return null;
    // Le canvas peut être rendu à une résolution différente de sa taille affichée.
    const canvas = engine.getRenderingCanvas()!;
    return {
      x: (this.projected.x * canvas.clientWidth) / width,
      y: (this.projected.y * canvas.clientHeight) / renderHeight,
    };
  }

  private removeText(text: FloatingText) {
    this.texts = this.texts.filter((t) => t !== text);
    this.recycle(text);
  }

  // Les éléments sont réutilisés plutôt que recréés à chaque texte.
  private recycle(text: FloatingText) {
    text.element.remove();
    this.pool.push(text.element);
  }
}
