import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { ARENA_SIZE, terrainHeight } from "@arena/shared";

// Au-delà de l'arène, le relief du bord se prolonge et s'aplatit sur cette distance.
const OUTSIDE_FADE = 20;

// Hauteur du sol, prolongée hors de l'arène : la hauteur du bord le plus proche, qui décroît en s'éloignant.
export function extendedHeight(x: number, z: number): number {
  const half = ARENA_SIZE / 2;
  const cx = Math.max(-half, Math.min(half, x));
  const cz = Math.max(-half, Math.min(half, z));
  const outside = Math.hypot(x - cx, z - cz);
  return terrainHeight(cx, cz) * Math.max(0, 1 - outside / OUTSIDE_FADE);
}

// Sol épousant le relief partagé avec le serveur (un sommet par mètre).
// offset : hauteur ajoutée, pour poser une couche au-dessus du sol (brouillard de guerre).
// size : côté du carré couvert, l'arène par défaut ; au-delà, le relief est prolongé (voir extendedHeight).
export function createTerrainMesh(name: string, scene: Scene, offset = 0, size = ARENA_SIZE): Mesh {
  const mesh = CreateGround(name, { width: size, height: size, subdivisions: size }, scene);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = extendedHeight(positions[i], positions[i + 2]) + offset;
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  // Normales recalculées pour que la lumière dessine les pentes.
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, mesh.getIndices(), normals);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals);
  mesh.refreshBoundingInfo();
  return mesh;
}
