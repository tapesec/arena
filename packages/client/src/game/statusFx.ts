import { Constants } from "@babylonjs/core/Engines/constants";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { frostMist, mezHalo, notesAura, rageFlames, speedDust, type ParticleFactory, type Recipe } from "./particles";
import type { PlayerVisual } from "./PlayerVisual";

// Hauteur de la tête des personnages (agrandis à 2,2 m), et du milieu du corps.
const HEAD = 2.35;
const BODY = 1.1;
// Étoiles du stun : nombre, rayon et vitesse de leur ronde (radians par seconde).
const STARS = 3;
const STAR_ORBIT = 0.45;
const STAR_SPEED = 4;
// Cristaux du root : nombre, et taille restante quand le root est sur le point de finir.
const CRYSTALS = 7;
const MELTED = 0.25;
const BUBBLE_DIAMETER = 2.4;
// La bulle (un buff, comme le bladeturn de DAoC) ne se montre que lorsqu'elle se forme : 2 s, dont un fondu final.
const BUBBLE_SHOWN = 2;
const BUBBLE_FADE = 0.5;

// Affichage d'un personnage contrôlé ou protégé ; chaque élément n'est créé qu'au premier besoin.
interface PlayerStatus {
  // Point d'attache qui suit le personnage (position et orientation). Les effets n'ont pas le personnage pour
  // parent : à sa disparition, il détruit ses descendants avec leurs matériaux, or ceux-ci sont partagés.
  anchor: TransformNode;
  head: Vector3;
  feet: Vector3;
  mez: ParticleSystem | null;
  stars: TransformNode | null;
  crystals: TransformNode | null;
  mist: ParticleSystem | null;
  // Durée totale du root en cours, relevée à son apparition (le serveur n'envoie que le temps restant).
  rootDuration: number;
  bubble: Mesh | null;

  // Effets continus qui suivent le personnage (Rage, poussière du chant, notes du Barde), par nom.
  auras: Map<string, ParticleSystem>;
  body: Vector3;
  lastX: number;
  lastZ: number;
}

// Auras continues : recette, point d'attache (pieds, corps, tête) et condition d'affichage.
interface Aura {
  recipe: Recipe;
  at: "feet" | "body" | "head";
  active: (player: PlayerVisual, speed: number) => boolean;
}
// En dessous de cette vitesse (m/s), un personnage accéléré ne soulève pas de poussière.
const DUST_SPEED = 3;
const AURAS: Record<string, Aura> = {
  rage: { recipe: rageFlames, at: "feet", active: (p) => p.hasEffect("rage") },
  dust: { recipe: speedDust, at: "feet", active: (p, speed) => p.hasEffect("speed") && speed > DUST_SPEED },
  notes: { recipe: notesAura, at: "head", active: (p) => p.state.songActive },
};

// États qui durent : volutes du mez, étoiles du stun, cristaux de glace du root qui fondent, bulle irisée.
export class StatusFx {
  private statuses = new Map<PlayerVisual, PlayerStatus>();
  // Instant (en secondes, horloge de StatusFx) où la bulle de chaque joueur a été appliquée, par identifiant.
  private bubbleApplied = new Map<string, number>();
  private starMaterial: StandardMaterial;
  private iceMaterial: StandardMaterial;
  private bubbleMaterial: StandardMaterial;
  private rimMaterial: StandardMaterial;
  private time = 0;

  constructor(
    private scene: Scene,
    private particles: ParticleFactory,
  ) {
    this.starMaterial = starMaterial(scene);
    this.iceMaterial = iceMaterial(scene);
    this.bubbleMaterial = bubbleMaterial(scene);
    this.rimMaterial = rimMaterial(scene);
  }

  update(dt: number, players: Iterable<PlayerVisual>) {
    this.time += dt;
    const seen = new Set<PlayerVisual>();
    for (const player of players) {
      seen.add(player);
      const alive = player.isAlive;
      const mez = alive && player.hasEffect("mez");
      const stun = alive && player.hasEffect("stun");
      const root = alive ? remaining(player, "root") : 0;
      const bubble = alive && player.hasEffect("bubble");
      const aura = alive && (player.hasEffect("rage") || player.hasEffect("speed") || player.state.songActive);
      let status = this.statuses.get(player);
      if (!status && !mez && !stun && !root && !bubble && !aura) continue;
      status ??= this.track(player);
      const speed = Math.hypot(player.root.position.x - status.lastX, player.root.position.z - status.lastZ) / Math.max(dt, 1e-3);
      status.lastX = player.root.position.x;
      status.lastZ = player.root.position.z;
      status.anchor.position.copyFrom(player.root.position);
      status.anchor.rotation.y = player.root.rotation.y;
      status.feet.copyFrom(player.root.position);
      status.head.copyFrom(player.root.position).y += HEAD;
      status.body.copyFrom(player.root.position).y += BODY;
      this.updateAuras(status, alive, player, speed);
      this.updateMez(status, mez);
      this.updateStars(status, stun, player);
      this.updateRoot(status, root, player);
      this.updateBubble(status, bubble, this.time - (this.bubbleApplied.get(player.sessionId) ?? -Infinity));
    }
    // Joueurs disparus (déconnectés, sortis du champ de vision).
    for (const [player, status] of this.statuses) {
      if (seen.has(player) && !player.root.isDisposed()) continue;
      this.updateMez(status, false);
      this.updateAuras(status, false, player, 0);
      status.mist?.stop();
      // Détruit les effets du joueur, sans leurs matériaux partagés.
      status.anchor.dispose(false, false);
      this.statuses.delete(player);
    }
  }

  // L'Arcaniste vient de lancer sa bulle : elle se montre pendant 2 s.
  bubbleWasApplied(playerId: string) {
    this.bubbleApplied.set(playerId, this.time);
  }

  dispose() {
    for (const status of this.statuses.values()) status.anchor.dispose(false, false);
    this.statuses.clear();
  }

  private track(player: PlayerVisual): PlayerStatus {
    const anchor = new TransformNode("statusAnchor", this.scene);
    anchor.position.copyFrom(player.root.position);
    const status: PlayerStatus = {
      anchor,
      head: new Vector3(),
      feet: new Vector3(),
      mez: null,
      stars: null,
      crystals: null,
      mist: null,
      rootDuration: 0,
      bubble: null,

      auras: new Map(),
      body: new Vector3(),
      lastX: player.root.position.x,
      lastZ: player.root.position.z,
    };
    this.statuses.set(player, status);
    return status;
  }

  // Démarre ou arrête chaque aura continue selon l'état du personnage.
  private updateAuras(status: PlayerStatus, alive: boolean, player: PlayerVisual, speed: number) {
    for (const [name, aura] of Object.entries(AURAS)) {
      const active = alive && aura.active(player, speed);
      const system = status.auras.get(name);
      if (active && !system) {
        const created = aura.recipe(this.particles, status[aura.at]);
        if (created) status.auras.set(name, created);
      } else if (!active && system) {
        system.emitter = status[aura.at].clone();
        system.stop();
        status.auras.delete(name);
      }
    }
  }

  // Volutes violettes autour de la tête, tant que dure le mez (les « Zzz » sont affichés à part).
  private updateMez(status: PlayerStatus, active: boolean) {
    if (active && !status.mez) status.mez = mezHalo(this.particles, status.head);
    if (!active && status.mez) {
      status.mez.emitter = status.head.clone();
      status.mez.stop();
      status.mez = null;
    }
  }

  // Étoiles dorées qui tournent autour de la tête.
  private updateStars(status: PlayerStatus, active: boolean, player: PlayerVisual) {
    if (active && !status.stars) {
      status.stars = new TransformNode("stunStars", this.scene);
      status.stars.parent = status.anchor;
      status.stars.position.y = HEAD + 0.1;
      for (let i = 0; i < STARS; i++) {
        const star = CreatePlane("stunStar", { size: 0.32 }, this.scene);
        star.material = this.starMaterial;
        star.billboardMode = Mesh.BILLBOARDMODE_ALL;
        star.isPickable = false;
        star.parent = status.stars;
      }
    }
    if (!active && status.stars) {
      status.stars.dispose();
      status.stars = null;
    }
    // Une étoile tournée vers la caméra ignore la rotation de son parent : on place chacune sur son cercle.
    if (status.stars) {
      status.stars.getChildMeshes().forEach((star, i) => {
        const angle = this.time * STAR_SPEED + (i / STARS) * Math.PI * 2;
        star.position.set(Math.cos(angle) * STAR_ORBIT, Math.sin(angle * 2) * 0.05, Math.sin(angle) * STAR_ORBIT);
      });
    }
  }

  // Couronne de cristaux de glace aux pieds, qui rapetissent à mesure que la vitesse revient.
  private updateRoot(status: PlayerStatus, left: number, player: PlayerVisual) {
    if (left > 0 && !status.crystals) {
      status.crystals = crystalCrown(this.scene, this.iceMaterial);
      status.crystals.parent = status.anchor;
      status.mist = frostMist(this.particles, status.feet);
      status.rootDuration = left;
    }
    if (left <= 0 && status.crystals) {
      status.crystals.dispose();
      status.crystals = null;
      if (status.mist) {
        status.mist.emitter = status.feet.clone();
        status.mist.stop();
        status.mist = null;
      }
      status.rootDuration = 0;
      return;
    }
    if (!status.crystals) return;
    // Un root relancé repart de sa pleine durée.
    if (left > status.rootDuration) status.rootDuration = left;
    const solid = left / status.rootDuration;
    status.crystals.scaling.set(1, MELTED + (1 - MELTED) * solid, 1).scaleInPlace(0.6 + 0.4 * solid);
  }

  // Bulle irisée : un volume à peine teinté et un anneau lumineux sur son contour, toujours tourné vers la caméra.
  // Elle n'apparaît que 2 s après son lancement (voir bubbleWasApplied), pas quand un adversaire entre dans le
  // champ de vision avec sa bulle déjà posée. age : temps écoulé depuis le lancement.
  private updateBubble(status: PlayerStatus, active: boolean, age: number) {
    const shown = active && age >= 0 && age < BUBBLE_SHOWN;
    if (shown && !status.bubble) {
      status.bubble = CreateSphere("bubble", { diameter: BUBBLE_DIAMETER, segments: 24 }, this.scene);
      status.bubble.material = this.bubbleMaterial;
      status.bubble.isPickable = false;
      status.bubble.parent = status.anchor;
      status.bubble.position.y = BODY;
      const rim = CreateTorus("bubbleRim", { diameter: BUBBLE_DIAMETER - 0.05, thickness: 0.07, tessellation: 64 }, this.scene);
      rim.material = this.rimMaterial;
      rim.isPickable = false;
      // L'anneau est couché dans le plan de l'écran : tourné vers la caméra, il dessine le contour de la sphère.
      rim.rotation.x = Math.PI / 2;
      rim.bakeCurrentTransformIntoVertices();
      rim.billboardMode = Mesh.BILLBOARDMODE_ALL;
      rim.parent = status.bubble;
    }
    if (!shown && status.bubble) {
      status.bubble.dispose();
      status.bubble = null;
    }
    if (!status.bubble) return;
    // Apparition rapide, respiration légère, fondu final.
    const appear = Math.min(1, age / 0.2);
    const fade = Math.min(1, (BUBBLE_SHOWN - age) / BUBBLE_FADE);
    status.bubble.scaling.setAll((0.85 + 0.15 * appear) * (1 + Math.sin(this.time * 3) * 0.025));
    const visibility = Math.min(appear, fade);
    status.bubble.visibility = visibility;
    for (const child of status.bubble.getChildMeshes()) child.visibility = visibility;
    // Teinte qui tourne lentement entre le bleu, le violet et le rose (matériaux partagés : toutes les bulles ensemble).
    const hue = 265 + Math.sin(this.time * 0.8) * 45;
    Color3.HSVtoRGBToRef(hue, 0.55, 1, this.rimMaterial.emissiveColor);
    Color3.HSVtoRGBToRef(hue, 0.5, 0.8, this.bubbleMaterial.emissiveColor);
  }
}

// Temps restant d'un effet sur le personnage (0 s'il ne l'a pas).
function remaining(player: PlayerVisual, kind: string): number {
  for (const effect of player.state.effects) if (effect.kind === kind) return Math.max(effect.remaining, 0.01);
  return 0;
}

// Cristaux pointus, légèrement inclinés vers l'extérieur, en cercle autour des pieds.
function crystalCrown(scene: Scene, material: StandardMaterial): TransformNode {
  const crown = new TransformNode("rootCrystals", scene);
  for (let i = 0; i < CRYSTALS; i++) {
    const height = 0.55 + ((i * 37) % 10) / 20;
    const crystal = CreateCylinder("crystal", { height, diameterTop: 0, diameterBottom: 0.28, tessellation: 4 }, scene);
    crystal.material = material;
    crystal.isPickable = false;
    crystal.parent = crown;
    const angle = (i / CRYSTALS) * Math.PI * 2 + i * 0.3;
    const distance = 0.5 + (i % 3) * 0.08;
    crystal.position.set(Math.cos(angle) * distance, height / 2 - 0.05, Math.sin(angle) * distance);
    // Pointe inclinée vers l'extérieur.
    crystal.rotation.set(Math.sin(angle) * 0.35, i * 0.7, -Math.cos(angle) * 0.35);
  }
  return crown;
}

function iceMaterial(scene: Scene): StandardMaterial {
  const material = new StandardMaterial("rootIce", scene);
  material.diffuseColor = new Color3(0.6, 0.85, 1);
  material.emissiveColor = new Color3(0.25, 0.55, 0.9);
  material.specularColor = new Color3(1, 1, 1);
  material.specularPower = 64;
  material.alpha = 0.8;
  return material;
}

// Étoile dorée à cinq branches, dessinée par le jeu, lumineuse.
function starMaterial(scene: Scene): StandardMaterial {
  const size = 64;
  const texture = new DynamicTexture("stunStar", size, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? size * 0.48 : size * 0.2;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffe14a";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff8c0";
  ctx.stroke();
  texture.hasAlpha = true;
  texture.update();
  const material = new StandardMaterial("stunStar", scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.emissiveColor = new Color3(1, 0.85, 0.3);
  material.disableLighting = true;
  material.backFaceCulling = false;
  return material;
}

// Volume de la bulle : à peine teinté, très transparent, sans éclairage (ses reflets sont ceux de rimMaterial).
function bubbleMaterial(scene: Scene): StandardMaterial {
  const material = new StandardMaterial("bubble", scene);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = new Color3(0.5, 0.4, 0.8);
  material.disableLighting = true;
  material.alpha = 0.12;
  return material;
}

// Contour lumineux de la bulle, en mode additif.
function rimMaterial(scene: Scene): StandardMaterial {
  const material = new StandardMaterial("bubbleRim", scene);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = new Color3(0.6, 0.5, 1);
  material.disableLighting = true;
  material.alphaMode = Constants.ALPHA_ADD;
  material.alpha = 0.8;
  return material;
}
