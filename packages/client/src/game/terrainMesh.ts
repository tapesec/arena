import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { ARENA_SIZE, terrainHeight } from "@arena/shared";

// Sol de l'arène épousant le relief partagé avec le serveur (un sommet par mètre).
// offset : hauteur ajoutée, pour poser une couche au-dessus du sol (grille, brouillard).
export function createTerrainMesh(name: string, scene: Scene, offset = 0): Mesh {
  const mesh = CreateGround(name, { width: ARENA_SIZE, height: ARENA_SIZE, subdivisions: ARENA_SIZE }, scene);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = terrainHeight(positions[i], positions[i + 2]) + offset;
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  // Normales recalculées pour que la lumière dessine les pentes.
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, mesh.getIndices(), normals);
  mesh.setVerticesData(VertexBuffer.NormalKind, normals);
  mesh.refreshBoundingInfo();
  return mesh;
}
