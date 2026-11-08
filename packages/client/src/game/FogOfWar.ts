import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { ARENA_SIZE, VISION_RANGE, hasLineOfSight, type Position } from "@arena/shared";
import { createTerrainMesh } from "./terrainMesh";

// Une case par mètre : la texture est étirée sur l'arène, le filtrage adoucit les bords.
const CELLS = ARENA_SIZE;
// Recalcul de la zone visible (en secondes) : coûteux, inutile à chaque image.
const RECOMPUTE_INTERVAL = 0.15;
// Opacité du brouillard sur les zones non visibles.
const FOG_OPACITY = 0.62;
// Vitesse à laquelle une case s'éclaircit ou s'assombrit (fondu plutôt que saut).
const FADE_RATE = 6;
// Juste au-dessus du sol, sous les personnages.
const FOG_HEIGHT = 0.04;
const FOG_COLOR = [8, 10, 14];

// Brouillard de guerre affiché : assombrit le sol hors de la vue de son équipe.
// Mêmes règles que le serveur (voir computeTeamVisibility) : à portée de vue d'un allié vivant,
// sans obstacle entre eux.
export class FogOfWar {
  private mesh: Mesh;
  private texture: DynamicTexture;
  private image: ImageData;
  // Opacité voulue et opacité affichée de chaque case (0 = visible, 1 = dans le brouillard).
  private target = new Float32Array(CELLS * CELLS).fill(1);
  private shown = new Float32Array(CELLS * CELLS).fill(1);
  private recomputeTimer = 0;

  constructor(scene: Scene) {
    // Le brouillard épouse le relief, juste au-dessus du sol.
    this.mesh = createTerrainMesh("fog", scene, FOG_HEIGHT);
    this.mesh.isPickable = false;

    this.texture = new DynamicTexture("fogTexture", { width: CELLS, height: CELLS }, scene, false);
    this.texture.hasAlpha = true;
    const context = this.texture.getContext();
    this.image = context.getImageData(0, 0, CELLS, CELLS);
    for (let i = 0; i < CELLS * CELLS; i++) {
      this.image.data[i * 4] = FOG_COLOR[0];
      this.image.data[i * 4 + 1] = FOG_COLOR[1];
      this.image.data[i * 4 + 2] = FOG_COLOR[2];
      this.image.data[i * 4 + 3] = FOG_OPACITY * 255;
    }
    context.putImageData(this.image, 0, 0);
    this.texture.update();

    const material = new StandardMaterial("fogMaterial", scene);
    material.diffuseTexture = this.texture;
    material.useAlphaFromDiffuseTexture = true;
    material.disableLighting = true;
    material.emissiveColor = Color3.Black();
    material.specularColor = Color3.Black();
    this.mesh.material = material;
    this.setEnabled(false);
  }

  dispose() {
    this.texture.dispose();
    this.mesh.dispose();
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.mesh.isEnabled()) return;
    this.mesh.setEnabled(enabled);
    // À la réactivation, on repart d'un brouillard calculé tout de suite.
    if (enabled) this.recomputeTimer = 0;
  }

  // watchers : positions des alliés vivants (dont soi-même).
  update(dt: number, watchers: Position[]) {
    if (!this.mesh.isEnabled()) return;
    this.recomputeTimer -= dt;
    if (this.recomputeTimer <= 0) {
      this.recompute(watchers);
      this.recomputeTimer = RECOMPUTE_INTERVAL;
    }

    const step = 1 - Math.exp(-FADE_RATE * dt);
    let changed = false;
    for (let i = 0; i < this.shown.length; i++) {
      const delta = this.target[i] - this.shown[i];
      if (Math.abs(delta) < 0.002) continue;
      this.shown[i] += delta * step;
      this.image.data[i * 4 + 3] = this.shown[i] * FOG_OPACITY * 255;
      changed = true;
    }
    if (!changed) return;
    this.texture.getContext().putImageData(this.image, 0, 0);
    this.texture.update();
  }

  private recompute(watchers: Position[]) {
    const half = ARENA_SIZE / 2;
    const rangeSquared = VISION_RANGE * VISION_RANGE;
    for (let row = 0; row < CELLS; row++) {
      // La première ligne de la texture correspond au bord +z de l'arène.
      const z = half - (row + 0.5);
      for (let column = 0; column < CELLS; column++) {
        const cell = { x: -half + column + 0.5, z };
        let seen = false;
        for (const w of watchers) {
          const dx = cell.x - w.x;
          const dz = cell.z - w.z;
          if (dx * dx + dz * dz <= rangeSquared && hasLineOfSight(w, cell)) {
            seen = true;
            break;
          }
        }
        this.target[row * CELLS + column] = seen ? 0 : 1;
      }
    }
  }
}
