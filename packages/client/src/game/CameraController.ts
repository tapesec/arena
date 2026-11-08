import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

// Vue isométrique : caméra en diagonale, inclinée d'environ 55° par rapport à la verticale.
const DEFAULT_ALPHA = (-3 * Math.PI) / 4;
const BETA = 0.95;
const DEFAULT_RADIUS = 32;
const MIN_RADIUS = 16;
const MAX_RADIUS = 55;

// Radians de rotation par pixel de déplacement de la souris.
const ROTATION_SPEED = 0.006;
// Fraction de zoom par cran de molette (deltaY ≈ 100 par cran).
const ZOOM_SPEED = 0.001;

// Vitesse à laquelle la caméra se replace dans le dos du personnage quand il pivote.
const FOLLOW_RATE = 10;

// Caméra qui suit le joueur, placée dans son dos. Clic droit maintenu : la souris tourne la caméra
// (et le personnage avec elle, voir Game). Molette pour zoomer.
export class CameraController {
  readonly camera: ArcRotateCamera;
  private dragging = false;
  private lastX = 0;

  constructor(
    scene: Scene,
    private canvas: HTMLCanvasElement,
    // Prévenu quand le clic droit est enfoncé ou relâché.
    private onSteerChange: (steering: boolean) => void = () => {},
  ) {
    this.camera = new ArcRotateCamera("camera", DEFAULT_ALPHA, BETA, DEFAULT_RADIUS, Vector3.Zero(), scene);
    this.camera.fov = 0.6;

    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("contextmenu", this.preventDefault);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("contextmenu", this.preventDefault);
    this.canvas.removeEventListener("wheel", this.handleWheel);
  }

  // Direction du "haut de l'écran" dans le monde, dans la convention partagée avec le serveur.
  // La caméra regarde vers (-cos α, -sin α), qu'on exprime sous la forme (sin yaw, cos yaw).
  get yaw(): number {
    return Math.atan2(-Math.cos(this.camera.alpha), -Math.sin(this.camera.alpha));
  }

  // Clic droit maintenu.
  get steering(): boolean {
    return this.dragging;
  }

  follow(position: Vector3) {
    this.camera.target.copyFrom(position);
  }

  // Replace progressivement la caméra dans le dos d'un personnage orienté selon facing.
  // Inverse de yaw : la caméra regarde vers (sin facing, cos facing) quand α = atan2(-cos, -sin).
  followFacing(facing: number, dt: number) {
    const targetAlpha = Math.atan2(-Math.cos(facing), -Math.sin(facing));
    const delta = Math.atan2(Math.sin(targetAlpha - this.camera.alpha), Math.cos(targetAlpha - this.camera.alpha));
    this.camera.alpha += delta * (1 - Math.exp(-FOLLOW_RATE * dt));
  }

  // Zoom par défaut ; l'orientation est remise par défaut seulement si on ne suit pas de personnage.
  reset(facing?: number) {
    this.camera.alpha = facing === undefined ? DEFAULT_ALPHA : Math.atan2(-Math.cos(facing), -Math.sin(facing));
    this.camera.radius = DEFAULT_RADIUS;
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 2) return;
    this.dragging = true;
    this.lastX = event.clientX;
    this.canvas.setPointerCapture(event.pointerId);
    this.onSteerChange(true);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.camera.alpha -= (event.clientX - this.lastX) * ROTATION_SPEED;
    this.lastX = event.clientX;
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (event.button !== 2) return;
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.releasePointerCapture(event.pointerId);
    this.onSteerChange(false);
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const radius = this.camera.radius * (1 + event.deltaY * ZOOM_SPEED);
    this.camera.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, radius));
  };

  // Le clic droit sert à tourner la caméra : pas de menu contextuel du navigateur.
  private preventDefault = (event: Event) => event.preventDefault();
}
