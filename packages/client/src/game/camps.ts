import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { START_ZONES, terrainHeight } from "@arena/shared";

// Couleurs vues par le joueur local, comme les tenues : son camp en bleu, celui d'en face en rouge.
const ALLY = Color3.FromHexString("#2c5cb8");
const ENEMY = Color3.FromHexString("#b8302c");
// Bannières de part et d'autre des sorties du camp, vers l'arène (angle depuis la direction du centre).
const BANNER_SPREAD = (50 * Math.PI) / 180;
const POLE_HEIGHT = 4.2;
// Matériau du tissu des bannières, peint à la couleur du camp.
const CLOTH = "MI_Banner";

// Pièce posée par rapport au centre du camp : distance et angle depuis la direction du coin de carte (vers
// l'extérieur), rotation propre.
interface CampProp {
  piece: string;
  distance: number;
  angle: number;
  rotation: number;
  y?: number;
}

// Réserve au fond du camp, côté coin de carte : rien qui dépasse 1 m, pour ne pas ressembler à un abri.
const SUPPLIES: CampProp[] = [
  { piece: "Crate_Wooden", distance: 5.5, angle: -0.25, rotation: 0.3 },
  { piece: "Crate_Wooden", distance: 6.3, angle: -0.12, rotation: -0.2 },
  { piece: "Barrel", distance: 5.8, angle: 0.08, rotation: 0 },
  { piece: "Barrel_Apples", distance: 6.4, angle: 0.18, rotation: 1 },
  { piece: "FarmCrate_Apple", distance: 5, angle: 0.3, rotation: 0.6 },
  { piece: "Bench", distance: 4.5, angle: -0.7, rotation: Math.PI / 2 },
  { piece: "Barrel", distance: 5.2, angle: 0.55, rotation: 0 },
];

// Une pièce du village copiée à sa place (voir Village.placePiece).
export type PlacePiece = (piece: string, x: number, y: number, z: number, rotation: number) => AbstractMesh[];

// Campements des zones de départ : limite du camp, bannières et réserve.
export class Camps {
  private rings: Mesh[] = [];
  private ringMaterials: StandardMaterial[] = [];
  private cloths: AbstractMesh[][] = [];
  private clothMaterials = new Map<string, PBRMaterial>();
  private localTeam = -1;

  constructor(private scene: Scene) {}

  build(place: PlacePiece) {
    const poleMaterial = new StandardMaterial("camp-pole", this.scene);
    poleMaterial.diffuseColor = Color3.FromHexString("#5a3d24");
    poleMaterial.specularColor = Color3.Black();

    START_ZONES.forEach((zone, team) => {
      const ground = terrainHeight(zone.x, zone.z);
      // Direction du coin de carte (vers l'extérieur) : le fond du camp.
      const outward = Math.atan2(zone.x, zone.z);
      const at = (distance: number, angle: number) => ({
        x: zone.x + Math.sin(outward + angle) * distance,
        z: zone.z + Math.cos(outward + angle) * distance,
      });

      // Limite du camp : on y est confiné pendant la préparation.
      const ring = CreateTorus(`camp-ring-${team}`, { diameter: zone.radius * 2, thickness: 0.12, tessellation: 96 }, this.scene);
      ring.position.set(zone.x, ground + 0.05, zone.z);
      ring.scaling.y = 0.2;
      const ringMaterial = new StandardMaterial(`camp-ring-${team}`, this.scene);
      ringMaterial.disableLighting = true;
      ringMaterial.alpha = 0.6;
      ring.material = ringMaterial;
      ring.isPickable = false;
      ring.freezeWorldMatrix();
      this.rings.push(ring);
      this.ringMaterials.push(ringMaterial);

      // Bannières de part et d'autre des sorties, tissu tourné vers l'arène.
      const cloths: AbstractMesh[] = [];
      for (const side of [-1, 1]) {
        const angle = Math.PI + side * BANNER_SPREAD;
        const { x, z } = at(zone.radius - 0.6, angle);
        const pole = CreateCylinder("camp-pole", { height: POLE_HEIGHT, diameter: 0.16, tessellation: 8 }, this.scene);
        pole.position.set(x, ground + POLE_HEIGHT / 2, z);
        pole.material = poleMaterial;
        pole.isPickable = false;
        pole.freezeWorldMatrix();
        // Le bras de la bannière part du mât, perpendiculaire à la direction de l'arène.
        const facing = outward + angle;
        for (const mesh of place("Banner_1", x, ground + POLE_HEIGHT - 0.3, z, facing + Math.PI)) {
          if (mesh.material?.name === CLOTH) cloths.push(mesh);
        }
      }
      this.cloths.push(cloths);

      for (const prop of SUPPLIES) {
        const { x, z } = at(prop.distance, prop.angle);
        place(prop.piece, x, ground + (prop.y ?? 0), z, outward + prop.rotation);
      }
    });
    this.applyColors();
  }

  // Recolore les camps selon l'équipe du joueur local.
  setLocalTeam(team: number) {
    if (team === this.localTeam) return;
    this.localTeam = team;
    this.applyColors();
  }

  private applyColors() {
    START_ZONES.forEach((_, zoneTeam) => {
      // Tant que l'équipe locale est inconnue, les camps gardent les couleurs des équipes 0 et 1.
      const ally = this.localTeam < 0 ? zoneTeam === 0 : zoneTeam === this.localTeam;
      const color = ally ? ALLY : ENEMY;
      const material = this.ringMaterials[zoneTeam];
      if (material) material.emissiveColor = color;
      for (const mesh of this.cloths[zoneTeam] ?? []) mesh.material = this.cloth(mesh.material as PBRMaterial, color);
    });
  }

  // Tissu peint d'une couleur unie : la texture est retirée, le relief gardé.
  private cloth(base: PBRMaterial, color: Color3): PBRMaterial {
    const original = (base.metadata?.original as PBRMaterial | undefined) ?? base;
    const key = color.toHexString();
    let material = this.clothMaterials.get(key);
    if (!material) {
      material = original.clone(`${CLOTH}-${key}`);
      material.albedoTexture = null;
      material.albedoColor = color.toLinearSpace();
      // Légère lueur propre : vu du côté à l'ombre, un tissu bleu paraîtrait noir.
      material.emissiveColor = color.scale(0.35);
      material.metadata = { original };
      this.clothMaterials.set(key, material);
    }
    return material;
  }
}
