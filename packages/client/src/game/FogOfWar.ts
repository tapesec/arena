import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { ARENA_SIZE, EYE_HEIGHT, OBSTACLES, VISION_RANGE, terrainHeight, type Position } from "@arena/shared";
import { createTerrainMesh } from "./terrainMesh";

// Une case par mètre : la texture est étirée sur l'arène, le filtrage adoucit les bords.
const CELLS = ARENA_SIZE;
// Le champ de vision d'un allié n'est recalculé que s'il s'est déplacé d'au moins cette distance.
const RECOMPUTE_DISTANCE = 0.75;
// Nombre maximal de champs de vision recalculés par image : le coût est étalé, sans pic.
const MAX_RECOMPUTES_PER_FRAME = 2;
// Opacité du brouillard sur les zones non visibles.
const FOG_OPACITY = 0.62;
// Vitesse à laquelle une case s'éclaircit ou s'assombrit (fondu plutôt que saut).
const FADE_RATE = 6;
// Juste au-dessus du sol, sous les personnages.
const FOG_HEIGHT = 0.04;
const FOG_COLOR = [8, 10, 14];

export interface FogWatcher extends Position {
  id: string;
}

// Champ de vision d'un allié, calculé depuis la position indiquée.
interface Viewshed {
  x: number;
  z: number;
  // 1 pour chaque case visible.
  cells: Uint8Array;
}

// Brouillard de guerre affiché : assombrit le sol hors de la vue de son équipe.
// Mêmes règles que le serveur (voir computeTeamVisibility) : à portée de vue d'un allié vivant,
// sans obstacle ni relief entre eux. Chaque allié a son champ de vision, recalculé quand il bouge.
export class FogOfWar {
  private mesh: Mesh;
  private texture: DynamicTexture;
  private image: ImageData;
  // Opacité voulue et opacité affichée de chaque case (0 = visible, 1 = dans le brouillard).
  private target = new Float32Array(CELLS * CELLS).fill(1);
  private shown = new Float32Array(CELLS * CELLS).fill(1);
  private viewsheds = new Map<string, Viewshed>();
  private targetDirty = true;

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
    // À la réactivation, on repart de champs de vision recalculés.
    if (enabled) {
      this.viewsheds.clear();
      this.targetDirty = true;
    }
  }

  // watchers : alliés vivants (dont soi-même).
  update(dt: number, watchers: FogWatcher[]) {
    if (!this.mesh.isEnabled()) return;
    this.updateViewsheds(watchers);
    if (this.targetDirty) {
      this.combineViewsheds();
      this.targetDirty = false;
    }
    this.fade(dt);
  }

  // Recalcule les champs de vision des alliés qui ont bougé, les plus déplacés d'abord.
  private updateViewsheds(watchers: FogWatcher[]) {
    const present = new Set(watchers.map((w) => w.id));
    for (const id of this.viewsheds.keys()) {
      if (!present.has(id)) {
        this.viewsheds.delete(id);
        this.targetDirty = true;
      }
    }
    const moved = watchers
      .map((w) => {
        const known = this.viewsheds.get(w.id);
        return { watcher: w, distance: known ? Math.hypot(w.x - known.x, w.z - known.z) : Infinity };
      })
      .filter((m) => m.distance >= RECOMPUTE_DISTANCE)
      .sort((a, b) => b.distance - a.distance)
      .slice(0, MAX_RECOMPUTES_PER_FRAME);
    for (const { watcher } of moved) {
      this.viewsheds.set(watcher.id, computeViewshed(watcher));
      this.targetDirty = true;
    }
  }

  private combineViewsheds() {
    this.target.fill(1);
    for (const { cells } of this.viewsheds.values()) {
      for (let i = 0; i < cells.length; i++) if (cells[i]) this.target[i] = 0;
    }
  }

  private fade(dt: number) {
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
}

// Nombre de rayons lancés depuis chaque allié : assez pour ne sauter aucune case à portée de vue.
const RAY_COUNT = 360;
// Pas d'avancée le long d'un rayon, en mètres.
const RAY_STEP = 0.5;

// Cases visibles depuis une position, par lancer de rayons : le long de chaque rayon, une case est visible
// si un personnage qui s'y tiendrait dépasse la pente la plus haute rencontrée avant lui (même règle que
// la ligne de vue du serveur, à hauteur des yeux). Un obstacle arrête le rayon.
function computeViewshed(from: Position): Viewshed {
  const cells = new Uint8Array(CELLS * CELLS);
  const half = ARENA_SIZE / 2;
  const range = VISION_RANGE;
  const nearbyObstacles = OBSTACLES.filter(
    (o) => Math.abs(o.x - from.x) <= range + o.halfWidth && Math.abs(o.z - from.z) <= range + o.halfDepth,
  );
  const eye = terrainHeight(from.x, from.z) + EYE_HEIGHT;
  markCell(cells, from.x, from.z);

  for (let ray = 0; ray < RAY_COUNT; ray++) {
    const angle = (ray / RAY_COUNT) * Math.PI * 2;
    const dirX = Math.sin(angle);
    const dirZ = Math.cos(angle);
    let horizon = -Infinity;
    for (let d = RAY_STEP; d <= range; d += RAY_STEP) {
      const x = from.x + dirX * d;
      const z = from.z + dirZ * d;
      if (x < -half || x > half || z < -half || z > half) break;
      if (nearbyObstacles.some((o) => Math.abs(x - o.x) <= o.halfWidth && Math.abs(z - o.z) <= o.halfDepth)) break;
      const ground = terrainHeight(x, z);
      if ((ground + EYE_HEIGHT - eye) / d >= horizon) markCell(cells, x, z);
      horizon = Math.max(horizon, (ground - eye) / d);
    }
  }
  return { x: from.x, z: from.z, cells };
}

function markCell(cells: Uint8Array, x: number, z: number) {
  const half = ARENA_SIZE / 2;
  const column = Math.min(CELLS - 1, Math.max(0, Math.floor(x + half)));
  // La première ligne de la texture correspond au bord +z de l'arène.
  const row = Math.min(CELLS - 1, Math.max(0, Math.floor(half - z)));
  cells[row * CELLS + column] = 1;
}
