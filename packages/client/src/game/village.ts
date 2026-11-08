import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Ray } from "@babylonjs/core/Culling/ray";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/glTFFileLoader";
import { OBSTACLES, PLAZA, terrainHeight, type Obstacle } from "@arena/shared";
import { Camps } from "./camps";

const VILLAGE_URL = "/models/village/village.glb";

// Les pièces du village sont modulaires : murs de 2 m de large, étages de 3 m.
const MODULE = 2;
const STORY = 3;
// Un mur a sa face extérieure côté +z, à 9 cm de son origine (son épaisseur part vers l'intérieur).
const WALL_FACE = 0.09;
// L'intérieur sombre est en retrait des murs (leur épaisseur, plus un peu de marge).
const INTERIOR_INSET = 1;
// Opacité d'une maison qui se trouve entre la caméra et le joueur.
const FADED = 0.15;
const FADE_SPEED = 8;

type Style = "brick" | "plaster";

// Pièces de mur, par style.
const WALLS: Record<Style, { plain: string; window: string; door: string; corner: string }> = {
  brick: {
    plain: "Wall_UnevenBrick_Straight",
    window: "Wall_UnevenBrick_Window_Wide_Round",
    door: "Wall_UnevenBrick_Door_Round",
    corner: "Corner_Exterior_Brick",
  },
  plaster: {
    plain: "Wall_Plaster_WoodGrid",
    window: "Wall_Plaster_Window_Wide_Flat",
    door: "Wall_Plaster_Door_Flat",
    corner: "Corner_Exterior_Wood",
  },
};
// Les battants de porte ont leur origine sur la charnière : décalage qui les centre dans l'ouverture.
const DOOR_HINGE = 0.55;
// Ce qu'on pose dans l'ouverture d'un mur à fenêtre ou à porte, selon le style.
const FILLINGS: Record<string, string[]> = {
  Wall_UnevenBrick_Window_Wide_Round: ["Window_Wide_Round1", "WindowShutters_Wide_Round_Open"],
  Wall_Plaster_Window_Wide_Flat: ["Window_Wide_Flat1", "WindowShutters_Wide_Flat_Open"],
  Wall_UnevenBrick_Door_Round: ["Door_1_Round"],
  Wall_Plaster_Door_Flat: ["Door_1_Flat"],
};

// Une pièce posée : position et rotation autour de la verticale, dans le repère de l'objet qui la porte.
interface Placement {
  piece: string;
  // Décalage le long du mur (vers la droite vu de l'extérieur), appliqué après la rotation.
  shift?: number;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale?: number;
}

// Maison, muret, étal… : un objet du décor, fait de quelques maillages fusionnés, qui peut s'estomper.
interface DecorObject {
  meshes: Mesh[];
  // Intérieur sombre : masqué pendant que la maison est estompée (il la rendrait opaque).
  interior: Mesh | null;
  fades: boolean;
  opacity: number;
}

// Habille les obstacles de l'arène (voir OBSTACLES) avec les pièces du Medieval Village MegaKit.
export class Village {
  private objects: DecorObject[] = [];
  private templates = new Map<string, TransformNode>();
  private root: TransformNode | null = null;
  private ray = new Ray(Vector3.Zero(), Vector3.Up());
  private interiorMaterial: StandardMaterial | null = null;
  // Campements des zones de départ, posés avec les mêmes pièces.
  readonly camps: Camps;

  constructor(private scene: Scene) {
    this.camps = new Camps(scene);
  }

  async load() {
    const options = { pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } } };
    const container: AssetContainer = await LoadAssetContainerAsync(VILLAGE_URL, this.scene, options);
    container.addAllToScene();
    // Le nœud racine du chargeur convertit le repère glTF ; les pièces sont ses enfants, rangées par nom.
    this.root = container.rootNodes[0] as TransformNode;
    for (const node of this.root.getChildren()) this.templates.set(node.name, node as TransformNode);
    this.root.setEnabled(false);
    // Le chargeur fixe les matériaux opaques en mode "opaque", qui ignore la transparence par maillage :
    // on laisse Babylon décider, pour pouvoir estomper une maison (voir update).
    for (const material of container.materials) {
      const pbr = material as PBRMaterial;
      if (pbr.transparencyMode === PBRMaterial.PBRMATERIAL_OPAQUE) pbr.transparencyMode = null;
    }
    for (const obstacle of OBSTACLES) this.build(obstacle);
    this.camps.build((piece, x, y, z, rotation) => this.placePiece(piece, x, y, z, rotation));
  }

  // Estompe les maisons qui cachent le joueur à la caméra.
  update(dt: number, camera: Camera, focus: Vector3 | null) {
    if (focus) {
      this.ray.origin.copyFrom(camera.globalPosition);
      focus.subtractToRef(this.ray.origin, this.ray.direction);
      this.ray.length = this.ray.direction.length();
      this.ray.direction.normalize();
    }
    const step = Math.min(1, dt * FADE_SPEED);
    for (const object of this.objects) {
      if (!object.fades) continue;
      const hides = !!focus && object.meshes.some((mesh) => this.ray.intersectsBox(mesh.getBoundingInfo().boundingBox));
      object.opacity += ((hides ? FADED : 1) - object.opacity) * step;
      for (const mesh of object.meshes) mesh.visibility = object.opacity > 0.99 ? 1 : object.opacity;
      if (object.interior) object.interior.isVisible = object.opacity > 0.95;
    }
  }

  private build(obstacle: Obstacle) {
    const width = obstacle.halfWidth * 2;
    const depth = obstacle.halfDepth * 2;
    let placements: Placement[];
    let fades = false;
    switch (obstacle.kind) {
      case "house":
        placements = house(obstacle);
        fades = true;
        break;
      case "shed":
        placements = shed(width, depth);
        break;
      case "wall":
        placements = doubleWall(width, depth, "Wall_UnevenBrick_Straight");
        break;
      case "fence":
        placements = doubleWall(width, depth, "Wall_Plaster_WoodGrid");
        break;
      case "stall":
        // L'étal tourne le dos à la maison et fait face à la place.
        placements = [{ piece: "Stall_Empty", x: 0, y: 0, z: 0, rotation: facingPlaza(obstacle) }];
        break;
      case "crates":
        placements = crates();
        break;
    }
    const position = new Vector3(obstacle.x, terrainHeight(obstacle.x, obstacle.z), obstacle.z);
    const meshes = this.assemble(`decor-${obstacle.kind}`, placements, position);
    // Intérieur sombre : sans lui, on verrait l'herbe à travers les fenêtres et les portes.
    const interior = obstacle.kind === "house" || obstacle.kind === "shed" ? this.interior(obstacle, position) : null;
    this.objects.push({ meshes, interior, fades, opacity: 1 });
  }

  private interior(obstacle: Obstacle, position: Vector3): Mesh {
    const height = obstacle.kind === "house" && obstacle.halfWidth >= 4 && obstacle.halfDepth >= 4 ? 2 * STORY : STORY;
    const box = CreateBox(
      "decor-interior",
      { width: obstacle.halfWidth * 2 - INTERIOR_INSET, depth: obstacle.halfDepth * 2 - INTERIOR_INSET, height },
      this.scene,
    );
    box.position.set(position.x, position.y + height / 2, position.z);
    box.material = this.interiorMaterial ??= darkMaterial(this.scene);
    box.isPickable = false;
    return box;
  }

  // Pièce isolée, non fusionnée (pour pouvoir changer ses matériaux) : ses maillages.
  placePiece(piece: string, x: number, y: number, z: number, rotation: number): AbstractMesh[] {
    const holder = new TransformNode(piece, this.scene);
    this.instantiate({ piece, x, y, z, rotation }, holder);
    const meshes = holder.getChildMeshes(false);
    for (const mesh of meshes) {
      mesh.setEnabled(true);
      mesh.isPickable = false;
    }
    return meshes;
  }

  // Copie une pièce à sa place sous "parent", avec la conversion de repère du chargeur glTF.
  private instantiate(p: Placement, parent: TransformNode) {
    const template = this.templates.get(p.piece);
    if (!template) return;
    const anchor = new TransformNode(p.piece, this.scene);
    anchor.parent = parent;
    const shift = p.shift ?? 0;
    anchor.position.set(p.x + Math.cos(p.rotation) * shift, p.y, p.z - Math.sin(p.rotation) * shift);
    anchor.rotation.y = p.rotation;
    if (p.scale) anchor.scaling.setAll(p.scale);
    const frame = new TransformNode("frame", this.scene);
    frame.parent = anchor;
    frame.rotationQuaternion = this.root!.rotationQuaternion!.clone();
    frame.scaling.copyFrom(this.root!.scaling);
    template.instantiateHierarchy(frame, { doNotInstantiate: true });
  }

  // Copie les pièces à leur place, puis les fusionne : peu de maillages, donc peu d'appels de dessin.
  private assemble(name: string, placements: Placement[], position: Vector3): Mesh[] {
    const holder = new TransformNode(name, this.scene);
    holder.position.copyFrom(position);
    for (const p of placements) this.instantiate(p, holder);
    const meshes = holder.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    // Seuls des maillages aux mêmes données par sommet (normales, couleurs, UV…) peuvent être fusionnés.
    const groups = new Map<string, Mesh[]>();
    for (const mesh of meshes) {
      mesh.setEnabled(true);
      mesh.computeWorldMatrix(true);
      const key = mesh.getVerticesDataKinds().sort().join();
      groups.set(key, [...(groups.get(key) ?? []), mesh]);
    }
    const merged: Mesh[] = [];
    for (const group of groups.values()) {
      const mesh = Mesh.MergeMeshes(group, true, true, undefined, false, true);
      if (!mesh) continue;
      mesh.name = name;
      mesh.isPickable = false;
      merged.push(mesh);
    }
    holder.dispose();
    return merged;
  }
}

function darkMaterial(scene: Scene): StandardMaterial {
  const material = new StandardMaterial("decor-interior", scene);
  material.diffuseColor = new Color3(0.05, 0.04, 0.03);
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.emissiveColor = new Color3(0.04, 0.03, 0.025);
  return material;
}

// Fenêtre et volets, ou battant de porte, posés dans l'ouverture d'un mur.
function fillings(wall: string, at: { x: number; y: number; z: number }, rotation: number): Placement[] {
  return (FILLINGS[wall] ?? []).map((piece) => ({
    piece,
    ...at,
    rotation,
    shift: piece.startsWith("Door_") ? DOOR_HINGE : 0,
  }));
}

// Rotation qui tourne l'avant d'une pièce (+z) vers le centre de la place.
function facingPlaza(o: Obstacle): number {
  return Math.atan2(PLAZA.x - o.x, PLAZA.z - o.z);
}

// Les quatre côtés d'un rectangle centré : rotation qui tourne +z vers l'extérieur, longueur, distance au centre.
function sides(width: number, depth: number) {
  return [
    { rotation: 0, length: width, offset: depth / 2 },
    { rotation: Math.PI, length: width, offset: depth / 2 },
    { rotation: Math.PI / 2, length: depth, offset: width / 2 },
    { rotation: -Math.PI / 2, length: depth, offset: width / 2 },
  ];
}

// Position d'un module de mur : i-ème module le long du côté, face extérieure sur le bord du rectangle.
function wallPosition(rotation: number, length: number, offset: number, i: number, y: number) {
  const along = -length / 2 + MODULE / 2 + i * MODULE;
  const inward = offset - WALL_FACE;
  // Normale extérieure (sin, cos) et tangente (cos, -sin) pour une rotation autour de la verticale.
  const nx = Math.sin(rotation);
  const nz = Math.cos(rotation);
  return { x: nx * inward + nz * along, y, z: nz * inward - nx * along };
}

// Maison fermée : murs sur tous les côtés, fenêtres, une porte face à la place, toit de tuiles.
// Grande (8 × 8 m) : deux étages, pierre en bas et colombages en haut. Sinon un étage, en pierre si elle
// est plus profonde que large, en colombages sinon.
function house(o: Obstacle): Placement[] {
  const width = o.halfWidth * 2;
  const depth = o.halfDepth * 2;
  const big = width >= 8 && depth >= 8;
  const stories: Style[] = big ? ["brick", "plaster"] : [depth > width ? "brick" : "plaster"];
  const toPlaza = facingPlaza(o);
  // Le côté le plus tourné vers la place porte la porte, au rez-de-chaussée.
  const doorSide = sides(width, depth).reduce((best, side) =>
    Math.cos(side.rotation - toPlaza) > Math.cos(best.rotation - toPlaza) ? side : best,
  ).rotation;
  const placements: Placement[] = [];

  stories.forEach((style, story) => {
    const walls = WALLS[style];
    const y = story * STORY;
    for (const side of sides(width, depth)) {
      const count = side.length / MODULE;
      const facing = side.rotation === doorSide;
      for (let i = 0; i < count; i++) {
        const middle = i === Math.floor(count / 2);
        let piece = i % 2 === 1 ? walls.window : walls.plain;
        if (story === 0 && facing && middle) piece = walls.door;
        const at = wallPosition(side.rotation, side.length, side.offset, i, y);
        placements.push({ piece, ...at, rotation: side.rotation });
        placements.push(...fillings(piece, at, side.rotation));
      }
    }
    // Poteaux d'angle, qui cachent la jonction des murs.
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      placements.push({ piece: walls.corner, x: (sx * width) / 2, y, z: (sz * depth) / 2, rotation: Math.atan2(sx, sz) - Math.PI / 4 });
    }
  });

  placements.push(...roof(width, depth, stories.length * STORY));
  return placements;
}

// Toit de tuiles, faîtage le long du côté le plus long, pignons en pierre à ses deux bouts.
function roof(width: number, depth: number, y: number): Placement[] {
  const along = depth >= width;
  const span = along ? width : depth;
  const length = along ? depth : width;
  const piece = `Roof_RoundTiles_${span}x${length}`;
  const rotation = along ? 0 : Math.PI / 2;
  const gable = `Roof_Front_Brick${span}`;
  const placements: Placement[] = [{ piece, x: 0, y, z: 0, rotation }];
  // Pignons sur les deux bouts du faîtage, face extérieure sur le mur.
  for (const end of [0, Math.PI]) {
    const r = rotation + end;
    const inward = length / 2 - WALL_FACE;
    placements.push({ piece: gable, x: Math.sin(r) * inward, y, z: Math.cos(r) * inward, rotation: r });
  }
  return placements;
}

// Cabane : un module de mur par côté sur 4 m, porte d'un côté, petit toit.
function shed(width: number, depth: number): Placement[] {
  const placements: Placement[] = [];
  for (const side of sides(width, depth)) {
    for (let i = 0; i < side.length / MODULE; i++) {
      const piece = side.rotation === 0 && i === 0 ? "Wall_Plaster_Door_Flat" : "Wall_Plaster_Straight";
      const at = wallPosition(side.rotation, side.length, side.offset, i, 0);
      placements.push({ piece, ...at, rotation: side.rotation });
      placements.push(...fillings(piece, at, side.rotation));
    }
  }
  // Toit et pignons de 6 m, réduits à la taille de la cabane.
  const scale = Math.min(width, depth) / 6;
  placements.push({ piece: "Roof_RoundTiles_6x6", x: 0, y: STORY, z: 0, rotation: 0, scale });
  for (const rotation of [0, Math.PI]) {
    const inward = depth / 2 - WALL_FACE;
    placements.push({ piece: "Roof_Front_Brick6", x: Math.sin(rotation) * inward, y: STORY, z: Math.cos(rotation) * inward, rotation, scale });
  }
  return placements;
}

// Muret ou palissade : deux rangées de murs dos à dos (0,8 m d'épaisseur en tout), sur la longueur.
function doubleWall(width: number, depth: number, piece: string): Placement[] {
  const along = width >= depth;
  const length = along ? width : depth;
  const thickness = along ? depth : width;
  const base = along ? 0 : Math.PI / 2;
  const placements: Placement[] = [];
  for (const rotation of [base, base + Math.PI]) {
    for (let i = 0; i < length / MODULE; i++) {
      placements.push({ piece, ...wallPosition(rotation, length, thickness / 2, i, 0), rotation });
    }
  }
  return placements;
}

// Pile de caisses en pyramide sur 2 × 2 m (environ 3 m de haut), tonneaux au pied.
function crates(): Placement[] {
  const placements: Placement[] = [];
  for (const [x, z] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ]) {
    placements.push({ piece: "Prop_Crate", x, y: 0, z, rotation: (x + z) * 0.3 });
  }
  placements.push({ piece: "Prop_Crate", x: 0, y: 1.1, z: -0.3, rotation: 0.2 }, { piece: "Prop_Crate", x: 0.1, y: 1.1, z: 0.6, rotation: -0.4 });
  placements.push({ piece: "Prop_Crate", x: 0, y: 2.2, z: 0.1, rotation: 0.5 });
  return placements;
}

