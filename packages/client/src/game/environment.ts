import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";
import { TerrainMaterial } from "@babylonjs/materials/terrain/terrainMaterial";
import { PLAZA, START_ZONES } from "@arena/shared";
import { assetUrl } from "../assets";
import { createTerrainMesh } from "./terrainMesh";

// Textures du sol (dans public/models/ground/).
export const GROUND_TEXTURES = { grass: "grass.webp", dirt: "dirt.webp", paving: "paving.webp" };
// Le sol déborde largement de l'arène (100 m) : la forêt des bords y sera posée.
export const GROUND_SIZE = 200;
// Taille, en mètres, d'une répétition des textures de sol.
const GRASS_TILE = 8;
const PAVING_TILE = 4;
// Résolution de la carte qui dit où mettre l'herbe, la terre et les pavés (environ 20 cm par pixel).
const MIX_RESOLUTION = 1024;

// Chemins de terre des zones de départ vers les entrées de la place, définis pour la première équipe
// et reproduits par symétrie (rotation de 180° autour du centre) pour la seconde.
const PATHS: [number, number][][] = [
  // Vers la large entrée sud, en passant sous la grande maison.
  [
    [-32, -32],
    [-20, -26],
    [-7, -22],
    [-4, -12],
  ],
  // Vers la ruelle ouest, en longeant la grande maison.
  [
    [-32, -32],
    [-26, -18],
    [-20, -9],
    [-12, -8.5],
  ],
];
const PATH_WIDTH = 3;

// Vrai si le sol est de l'herbe en (x, z) : ni chemin, ni place, ni zone de départ (marge comprise).
export function isGrass(x: number, z: number, margin = 0.5): boolean {
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.radius + margin) return false;
  if (START_ZONES.some((zone) => Math.hypot(x - zone.x, z - zone.z) < zone.radius + margin)) return false;
  for (const path of PATHS) {
    for (const sign of [1, -1]) {
      for (let i = 1; i < path.length; i++) {
        const [ax, az] = path[i - 1];
        const [bx, bz] = path[i];
        if (distanceToSegment(x, z, sign * ax, sign * az, sign * bx, sign * bz) < PATH_WIDTH / 2 + margin) return false;
      }
    }
  }
  return true;
}

function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

// Direction de la lumière du soleil (vers le bas) ; le soleil du ciel est placé à l'opposé.
const SUN_DIRECTION = new Vector3(-0.5, -1, 0.3).normalize();
// Couleur de l'horizon : fond du ciel et brume au loin.
const HORIZON = new Color3(0.72, 0.82, 0.9);

export function createLights(scene: Scene): DirectionalLight {
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  // Ciel bleuté au-dessus, reflet vert de l'herbe en dessous.
  hemi.diffuse = new Color3(0.8, 0.88, 1);
  hemi.groundColor = new Color3(0.35, 0.42, 0.28);
  const sun = new DirectionalLight("sun", SUN_DIRECTION, scene);
  // Lumière chaude de fin d'après-midi.
  sun.diffuse = new Color3(1, 0.93, 0.8);
  sun.intensity = 0.95;
  return sun;
}

// Ciel dégradé avec le soleil, et brume légère qui fond l'horizon.
export function createSky(scene: Scene) {
  scene.clearColor = Color4.FromColor3(HORIZON);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = HORIZON;
  scene.fogStart = 90;
  scene.fogEnd = 260;

  const material = new SkyMaterial("skyMaterial", scene);
  material.backFaceCulling = false;
  material.fogEnabled = false;
  material.luminance = 1;
  material.turbidity = 6;
  material.rayleigh = 1.6;
  material.useSunPosition = true;
  material.sunPosition = SUN_DIRECTION.scale(-100);
  const box = CreateBox("sky", { size: 1000 }, scene);
  box.material = material;
  box.infiniteDistance = true;
  box.isPickable = false;
  // Le ciel couvre tout l'écran : inutile d'effacer la couleur avant chaque image (la profondeur l'est toujours).
  scene.autoClear = false;
}

// Sol texturé : herbe partout, terre sur les chemins et les zones de départ, pavés sur la place.
export function createGround(scene: Scene): Mesh {
  const ground = createTerrainMesh("ground", scene, 0, GROUND_SIZE);
  ground.isPickable = false;
  ground.freezeWorldMatrix();

  const material = new TerrainMaterial("groundMaterial", scene);
  material.mixTexture = createMixTexture(scene);
  material.diffuseTexture1 = tiled(scene, GROUND_TEXTURES.grass, GRASS_TILE);
  material.diffuseTexture2 = tiled(scene, GROUND_TEXTURES.dirt, GRASS_TILE);
  material.diffuseTexture3 = tiled(scene, GROUND_TEXTURES.paving, PAVING_TILE);
  material.specularColor = Color3.Black();
  ground.material = material;
  return ground;
}

function tiled(scene: Scene, file: string, tile: number): Texture {
  const texture = new Texture(assetUrl(`models/ground/${file}`), scene);
  texture.uScale = texture.vScale = GROUND_SIZE / tile;
  return texture;
}

// Carte de mélange : rouge pour l'herbe, vert pour la terre, bleu pour les pavés. Les bords sont adoucis par un flou.
function createMixTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture("groundMix", MIX_RESOLUTION, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const scale = MIX_RESOLUTION / GROUND_SIZE;
  // Du monde (x, z) au pixel : x vers la droite, z vers le bas de l'image (la texture est retournée à l'affichage).
  const toPixel = (x: number, z: number): [number, number] => [(x + GROUND_SIZE / 2) * scale, (GROUND_SIZE / 2 + z) * scale];

  ctx.fillStyle = "rgb(255, 0, 0)";
  ctx.fillRect(0, 0, MIX_RESOLUTION, MIX_RESOLUTION);
  ctx.filter = `blur(${Math.round(scale * 0.6)}px)`;

  ctx.fillStyle = ctx.strokeStyle = "rgb(0, 255, 0)";
  ctx.lineWidth = PATH_WIDTH * scale;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const path of PATHS) {
    for (const sign of [1, -1]) {
      ctx.beginPath();
      path.forEach(([x, z], i) => {
        const [px, py] = toPixel(sign * x, sign * z);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }
  for (const zone of START_ZONES) {
    const [px, py] = toPixel(zone.x, zone.z);
    ctx.beginPath();
    ctx.arc(px, py, zone.radius * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgb(0, 0, 255)";
  const [px, py] = toPixel(PLAZA.x, PLAZA.z);
  ctx.beginPath();
  ctx.arc(px, py, PLAZA.radius * scale, 0, Math.PI * 2);
  ctx.fill();

  texture.update(false);
  return texture;
}
