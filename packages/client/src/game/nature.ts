import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import { ARENA_SIZE, OPEN_AREAS, isInsideObstacle, terrainHeight } from "@arena/shared";
import { GROUND_SIZE, isGrass } from "./environment";
import { extendedHeight } from "./terrainMesh";
import { assetUrl } from "../assets";

export const NATURE_MODEL = "models/village/nature.glb";
// Graine du tirage : le décor est le même pour tous les joueurs, à chaque partie.
const SEED = 20261108;

const HALF_ARENA = ARENA_SIZE / 2;
const HALF_GROUND = GROUND_SIZE / 2;
// Forêt : pas d'arbre à moins de cette distance du bord de l'arène (ils cacheraient un joueur près du bord),
// seulement des buissons et des rochers.
const FOREST_START = 8;
// Les grands arbres tordus ferment l'horizon, au fond de la forêt.
const TWISTED_START = 22;

// Une variante de pièce et l'échelle qui la ramène à la taille voulue.
interface Variant {
  piece: string;
  scale: number;
}

const TREES: Variant[] = [
  ...[1, 2, 3, 4, 5].map((i) => ({ piece: `CommonTree_${i}`, scale: 1 })),
  ...[1, 2, 3, 4, 5].map((i) => ({ piece: `Pine_${i}`, scale: 1 })),
];
const TWISTED: Variant[] = [
  { piece: "TwistedTree_1", scale: 1 },
  { piece: "TwistedTree_3", scale: 1 },
];
const BUSHES: Variant[] = [
  { piece: "Bush_Common", scale: 1 },
  { piece: "Bush_Common_Flowers", scale: 1 },
];
const ROCKS: Variant[] = [1, 2, 3].map((i) => ({ piece: `Rock_Medium_${i}`, scale: 1 }));
// Dans la zone jouable, tout reste sous le genou (environ 0,5 m) : les pièces du pack sont bien plus grandes.
const SMALL_ROCKS: Variant[] = [1, 2, 3].map((i) => ({ piece: `Rock_Medium_${i}`, scale: 0.25 }));
const GRASS: Variant[] = [
  { piece: "Grass_Common_Short", scale: 0.35 },
  { piece: "Grass_Wispy_Short", scale: 0.4 },
];
const MEADOW: Variant[] = [
  { piece: "Grass_Common_Tall", scale: 0.3 },
  { piece: "Flower_3_Group", scale: 0.22 },
  { piece: "Flower_4_Group", scale: 0.2 },
  { piece: "Grass_Wispy_Short", scale: 0.45 },
];
const PEBBLES: Variant[] = [
  { piece: "Pebble_Round_1", scale: 1 },
  { piece: "Pebble_Round_2", scale: 1 },
  { piece: "Pebble_Square_1", scale: 1 },
];
const FOREST_FLOOR: Variant[] = [
  { piece: "Grass_Common_Tall", scale: 0.8 },
  { piece: "Plant_1", scale: 1 },
  { piece: "Mushroom_Common", scale: 1 },
  { piece: "Grass_Wispy_Short", scale: 0.9 },
];

// Générateur pseudo-aléatoire à graine (mulberry32) : même tirage partout.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distance au-delà du bord de l'arène (négative à l'intérieur).
function outside(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z)) - HALF_ARENA;
}

// Pente du relief en (x, z), pour poser des rochers sur les rampes des plateaux et des crêtes.
function slope(x: number, z: number): number {
  const dx = terrainHeight(x + 0.5, z) - terrainHeight(x - 0.5, z);
  const dz = terrainHeight(x, z + 0.5) - terrainHeight(x, z - 0.5);
  return Math.hypot(dx, dz);
}

function inMeadow(x: number, z: number): boolean {
  return OPEN_AREAS.some((a) => x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ);
}

// Nature autour et dans l'arène : forêt des bords, buissons, rochers, herbes, fleurs et cailloux.
// Chaque pièce est dessinée en une fois pour toutes ses copies (instances légères).
export class Nature {
  private placements = new Map<string, Matrix[]>();
  private rand = random(SEED);

  constructor(private scene: Scene) {}

  async load() {
    this.scatter();
    const options = { pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } };
    const container = await LoadAssetContainerAsync(assetUrl(NATURE_MODEL), this.scene, options);
    container.addAllToScene();
    const root = container.rootNodes[0];
    for (const node of root.getChildren()) {
      const matrices = this.placements.get(node.name);
      const meshes = node.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      for (const mesh of meshes) {
        // La pièce est ramenée au repère du monde (conversion glTF comprise), puis copiée à chaque place.
        mesh.setParent(null);
        mesh.bakeCurrentTransformIntoVertices();
        mesh.isPickable = false;
        if (!matrices?.length) {
          mesh.dispose();
          continue;
        }
        const buffer = new Float32Array(matrices.length * 16);
        matrices.forEach((matrix, i) => matrix.copyToArray(buffer, i * 16));
        mesh.thinInstanceSetBuffer("matrix", buffer, 16, true);
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.freezeWorldMatrix();
      }
    }
    root.dispose();
  }

  private add(variants: Variant[], x: number, z: number, scaleJitter = 0.2) {
    const variant = variants[Math.floor(this.rand() * variants.length)];
    const scale = variant.scale * (1 - scaleJitter / 2 + this.rand() * scaleJitter);
    const rotation = Quaternion.RotationAxis(Vector3.Up(), this.rand() * Math.PI * 2);
    const matrix = Matrix.Compose(new Vector3(scale, scale, scale), rotation, new Vector3(x, extendedHeight(x, z), z));
    const list = this.placements.get(variant.piece) ?? [];
    list.push(matrix);
    this.placements.set(variant.piece, list);
  }

  // Parcourt une grille de pas "cell" avec un décalage aléatoire dans chaque case.
  private grid(cell: number, from: number, to: number, visit: (x: number, z: number) => void) {
    for (let gz = from; gz < to; gz += cell) {
      for (let gx = from; gx < to; gx += cell) visit(gx + this.rand() * cell, gz + this.rand() * cell);
    }
  }

  private scatter() {
    // Forêt : arbres serrés au-delà de FOREST_START, grands arbres tordus au fond, sous-bois.
    this.grid(6.5, -HALF_GROUND, HALF_GROUND, (x, z) => {
      const d = outside(x, z);
      if (d < FOREST_START || this.rand() > 0.85) return;
      this.add(d > TWISTED_START && this.rand() < 0.12 ? TWISTED : TREES, x, z, 0.4);
    });
    this.grid(3, -HALF_GROUND, HALF_GROUND, (x, z) => {
      const d = outside(x, z);
      if (d < 1) return;
      // Lisière : buissons et rochers, bas, entre l'arène et les premiers arbres.
      if (d < FOREST_START + 2) {
        const r = this.rand();
        if (r < 0.35) this.add(BUSHES, x, z, 0.5);
        else if (r < 0.45) this.add(ROCKS, x, z, 0.6);
      } else if (this.rand() < 0.3) this.add(FOREST_FLOOR, x, z, 0.5);
    });

    // Zone jouable : sur l'herbe seulement, à l'écart des obstacles.
    const free = (x: number, z: number) => outside(x, z) < -0.5 && isGrass(x, z) && !isInsideObstacle({ x, z }, 0.6);
    this.grid(2.2, -HALF_ARENA, HALF_ARENA, (x, z) => {
      if (!free(x, z)) return;
      const r = this.rand();
      if (inMeadow(x, z)) {
        // Prairies : herbes hautes et fleurs, plus denses.
        if (r < 0.55) this.add(MEADOW, x, z, 0.4);
      } else if (slope(x, z) > 0.12 && r < 0.18) {
        // Rampes des plateaux et des crêtes : petits rochers.
        this.add(SMALL_ROCKS, x, z, 0.5);
      } else if (r < 0.3) {
        this.add(GRASS, x, z, 0.4);
      } else if (r < 0.34) {
        this.add(PEBBLES, x, z, 0.4);
      }
    });
  }
}
