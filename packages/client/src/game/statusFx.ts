import { Constants } from "@babylonjs/core/Engines/constants";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { RAMPART_RADIUS, getAbility, terrainHeight } from "@arena/shared";
import type { ParticleFactory, Recipe } from "./particles";
import { recipeById, setParticleEffectDefs, type ParticleEffectDef } from "./particleDefs";
import particleEffects from "./particleEffects.json";
import type { PlayerVisual } from "./PlayerVisual";
import { hasTunedEffects } from "./abilityAnimations";
import { AbilityEffectPlayer, TEAM_COLORS, type Scenery } from "./abilityEffects";
import { hexToRgb } from "./color";
import { TUNING } from "./tuning";

// Effets à particules réglés sur la page de réglage (ils remplacent ceux du code de même nom).
setParticleEffectDefs(particleEffects as unknown as Record<string, ParticleEffectDef>);
// Effet d'incantation prévu dans le code, sauf si le sort a ses effets réglés sur la page de réglage.
const codeCharge = (p: PlayerVisual, abilityId: string) =>
  p.state.castAbility === abilityId && !hasTunedEffects(TUNING, p.state.classId, abilityId);

// Hauteur de la tête des personnages (agrandis à 2,2 m), et du milieu du corps.
const HEAD = 2.35;
const BODY = 1.1;
// Étoiles du stun : nombre, rayon et vitesse de leur ronde (radians par seconde).
const STARS = 3;
const STAR_ORBIT = 0.45;
const STAR_SPEED = 4;
// Cristaux du root : nombre.
const CRYSTALS = 7;
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
  bubble: Mesh | null;
  // Cercles de la Nova de givre en cours d'incantation.
  nova: TransformNode | null;
  // Zone du Rempart au sol (en coordonnées du monde, pas rattachée à l'ancre) et temps écoulé depuis son apparition.
  rampartZone: Mesh | null;
  rampartAge: number;
  // Angle courant des créneaux (radians).
  rampartAngle: number;

  // Effets continus qui suivent le personnage (Rage, poussière du chant, notes du Barde), par nom.
  auras: Map<string, ParticleSystem>;
  // Effets du geste de compétence en cours (réglés sur animation-lab.html).
  abilityFx: AbilityEffectPlayer;
  body: Vector3;
  // Entre les mains (où se forme un trait en incantation) ; à défaut, au milieu du corps.
  hands: Vector3;
  lastX: number;
  lastZ: number;
}

// Auras continues : recette, point d'attache (pieds, corps, tête) et condition d'affichage.
interface Aura {
  recipe: Recipe;
  // État dont l'aura est le visuel : elle cède la place aux effets réglés pour cet état (voir StatusFx.isTuned).
  kind?: string;
  at: "feet" | "body" | "head" | "hands";
  active: (player: PlayerVisual, speed: number) => boolean;
}
// En dessous de cette vitesse (m/s), un personnage accéléré ne soulève pas de poussière.
const DUST_SPEED = 3;
const AURAS: Record<string, Aura> = {
  rage: { kind: "rage", recipe: recipeById("rageFlames"), at: "feet", active: (p) => p.hasEffect("rage") },
  dust: { recipe: recipeById("speedDust"), at: "feet", active: (p, speed) => (p.hasEffect("speed") || p.hasEffect("ballad")) && speed > DUST_SPEED },
  notes: { recipe: recipeById("notesAura"), at: "head", active: (p) => p.state.song !== "" },
  // Gardien : flammes du Rempart, traînée de la Charge, couronne dorée des alliés du Cri de ralliement.
  rampart: { kind: "rampart", recipe: recipeById("rampartFlames"), at: "feet", active: (p) => p.hasEffect("rampart") },
  charge: { recipe: recipeById("chargeStreak"), at: "body", active: (p) => p.state.charging },
  rally: { kind: "magicImmune", recipe: recipeById("rallyHalo"), at: "head", active: (p) => p.hasEffect("magicImmune") },
  // Arcaniste : la cible de la Brûlure brûle tant que dure le dot ; colonne et éclairs de la Puissance arcanique.
  burn: { kind: "burning", recipe: recipeById("burning"), at: "feet", active: (p) => p.hasEffect("burning") },
  burnSmoke: { kind: "burning", recipe: recipeById("burningSmoke"), at: "feet", active: (p) => p.hasEffect("burning") },
  arcaneColumn: { kind: "arcanePower", recipe: recipeById("arcaneColumn"), at: "feet", active: (p) => p.hasEffect("arcanePower") },
  arcaneSparks: { kind: "arcanePower", recipe: recipeById("arcaneSparks"), at: "feet", active: (p) => p.hasEffect("arcanePower") },
  // Trait de feu et Trait de givre en incantation : le trait se forme entre les mains.
  fireCharge: { recipe: recipeById("fireCharge"), at: "hands", active: (p) => codeCharge(p, "firebolt") },
  frostCharge: { recipe: recipeById("frostCharge"), at: "hands", active: (p) => codeCharge(p, "frostbolt") },
};
// Parcourues à chaque image pour chaque joueur : listes construites une fois.
const AURA_ENTRIES = Object.entries(AURAS);
const AURA_LIST = Object.values(AURAS);

// Incantation de la Nova de givre : cercles concentriques bleus qui s'élargissent depuis l'Arcaniste.
const NOVA_RINGS = 3;
const NOVA_RING_PERIOD = 1.2;
// Zone du Rempart au sol : durée de l'apparition et du fondu final (secondes), vitesse de rotation des créneaux
// (radians par seconde), hauteur au-dessus du sol (mètres).
const RAMPART_APPEAR = 0.5;
const RAMPART_FADE = 0.8;
const RAMPART_SPIN = 0.15;
// À l'apparition, les créneaux tournent beaucoup plus vite (vitesse en plus, en radians par seconde) puis ralentissent
// jusqu'à leur vitesse normale en RAMPART_SPIN_UP secondes, comme un rempart qui se dresse.
const RAMPART_SPIN_BOOST = 2.5;
const RAMPART_SPIN_UP = 0.8;
const RAMPART_LIFT = 0.12;
// Couleur de la zone (r,g,b) : bleue pour le camp du joueur, rouge pour l'adversaire (comme les tenues).
const RAMPART_ALLY = hexToRgb(TEAM_COLORS.ally);
const RAMPART_ENEMY = hexToRgb(TEAM_COLORS.enemy);

// États qui durent : volutes du mez, étoiles du stun, cristaux de glace du root, bulle irisée.
export class StatusFx {
  private statuses = new Map<PlayerVisual, PlayerStatus>();
  // Instant (en secondes, horloge de StatusFx) où la bulle de chaque joueur a été appliquée, par identifiant.
  private bubbleApplied = new Map<string, number>();
  private starMaterial: StandardMaterial;
  private iceMaterial: StandardMaterial;
  private bubbleMaterial: StandardMaterial;
  private rimMaterial: StandardMaterial;
  private novaMaterial: StandardMaterial;
  private novaRadius = getAbility("frostNova")?.radius ?? 15;
  // Les effets de l'état (kind) du joueur sont réglés sur la page de réglage : ses visuels du code (particules,
  // cristaux du root, bulle, étoiles du stun, zone du Rempart) ne sont plus joués.
  isTuned: ((playerId: string, kind: string) => boolean) | null = null;
  private time = 0;

  constructor(
    private scene: Scene,
    private particles: ParticleFactory,
    private scenery: Scenery = { marks: null, objects: null },
  ) {
    this.starMaterial = starMaterial(scene);
    this.iceMaterial = iceMaterial(scene);
    this.bubbleMaterial = bubbleMaterial(scene);
    this.rimMaterial = rimMaterial(scene);
    this.novaMaterial = novaMaterial(scene);
  }

  // localTeam : équipe du joueur local (zone du Rempart bleue pour son camp, rouge pour l'adversaire).
  update(dt: number, players: Iterable<PlayerVisual>, localTeam: number | null) {
    this.time += dt;
    const seen = new Set<PlayerVisual>();
    for (const player of players) {
      seen.add(player);
      const alive = player.isAlive;
      const mez = alive && player.hasEffect("mez");
      const stun = alive && player.hasEffect("stun");
      const root = alive ? remaining(player, "root") : 0;
      const bubble = alive && player.hasEffect("bubble");
      const aura = alive && AURA_LIST.some((a) => a.active(player, Infinity));
      const nova = alive && player.state.castAbility === "frostNova";
      const rampart = alive ? remaining(player, "rampart") : 0;
      const playing = player.playingAbility();
      let status = this.statuses.get(player);
      if (!status && !mez && !stun && !root && !bubble && !aura && !nova && !rampart && !playing) continue;
      status ??= this.track(player);
      const speed = Math.hypot(player.root.position.x - status.lastX, player.root.position.z - status.lastZ) / Math.max(dt, 1e-3);
      status.lastX = player.root.position.x;
      status.lastZ = player.root.position.z;
      status.anchor.position.copyFrom(player.root.position);
      status.anchor.rotation.y = player.root.rotation.y;
      status.feet.copyFrom(player.root.position);
      status.head.copyFrom(player.root.position).y += HEAD;
      status.body.copyFrom(player.root.position).y += BODY;
      if (!player.handsPosition(status.hands)) status.hands.copyFrom(status.body);
      this.updateAuras(status, alive, player, speed);
      status.abilityFx.update(player.character, playing, localTeam === null ? undefined : player.state.team === localTeam);
      this.updateMez(status, mez && !this.tuned(player, "mez"));
      this.updateStars(status, stun && !this.tuned(player, "stun"));
      this.updateRoot(status, this.tuned(player, "root") ? 0 : root, player);
      this.updateBubble(status, bubble && !this.tuned(player, "bubble"), this.time - (this.bubbleApplied.get(player.sessionId) ?? -Infinity));
      this.updateNova(status, nova);
      this.updateRampartZone(status, this.tuned(player, "rampart") ? 0 : rampart, dt, player.state.team === localTeam);
    }
    // Joueurs disparus (déconnectés, sortis du champ de vision).
    for (const [player, status] of this.statuses) {
      if (seen.has(player) && !player.root.isDisposed()) continue;
      this.updateMez(status, false);
      this.updateAuras(status, false, player, 0);
      status.abilityFx.stopAll();
      status.mist?.stop();
      status.rampartZone?.dispose(false, true);
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
    for (const status of this.statuses.values()) {
      // Arrête aussi les sons en boucle des gestes en cours.
      status.abilityFx.stopAll();
      status.anchor.dispose(false, false);
    }
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
      bubble: null,
      nova: null,
      rampartZone: null,
      rampartAge: 0,
      rampartAngle: 0,

      auras: new Map(),
      abilityFx: new AbilityEffectPlayer(this.particles, this.scenery),
      body: new Vector3(),
      hands: new Vector3(),
      lastX: player.root.position.x,
      lastZ: player.root.position.z,
    };
    this.statuses.set(player, status);
    return status;
  }

  private tuned(player: PlayerVisual, kind: string): boolean {
    return this.isTuned?.(player.sessionId, kind) ?? false;
  }

  // Démarre ou arrête chaque aura continue selon l'état du personnage.
  private updateAuras(status: PlayerStatus, alive: boolean, player: PlayerVisual, speed: number) {
    for (const [name, aura] of AURA_ENTRIES) {
      const active = alive && aura.active(player, speed) && !(aura.kind && this.tuned(player, aura.kind));
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
    if (active && !status.mez) status.mez = recipeById("mezHalo")(this.particles, status.head);
    if (!active && status.mez) {
      status.mez.emitter = status.head.clone();
      status.mez.stop();
      status.mez = null;
    }
  }

  // Étoiles dorées qui tournent autour de la tête.
  private updateStars(status: PlayerStatus, active: boolean) {
    if (active && !status.stars) {
      status.stars = new TransformNode("stunStars", this.scene);
      status.stars.parent = status.anchor;
      status.stars.position.y = HEAD + 0.1;
      for (let i = 0; i < STARS; i++) {
        const star = sharedForm(this.scene, "stunStar", () => CreatePlane("stunStar", { size: 0.32 }, this.scene));
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

  // Couronne de cristaux de glace aux pieds, tant que dure le root.
  private updateRoot(status: PlayerStatus, left: number, player: PlayerVisual) {
    if (left > 0 && !status.crystals) {
      status.crystals = crystalCrown(this.scene, this.iceMaterial);
      status.crystals.parent = status.anchor;
      if (!this.tuned(player, "root")) status.mist = recipeById("frostMist")(this.particles, status.feet);
    }
    if (left <= 0 && status.crystals) {
      status.crystals.dispose();
      status.crystals = null;
      if (status.mist) {
        status.mist.emitter = status.feet.clone();
        status.mist.stop();
        status.mist = null;
      }
    }
  }

  // Nova de givre en incantation : des anneaux bleus semi-transparents partent de l'Arcaniste jusqu'au bord de la
  // zone, l'un après l'autre, en s'estompant.
  private updateNova(status: PlayerStatus, active: boolean) {
    if (active && !status.nova) {
      status.nova = new TransformNode("novaRings", this.scene);
      status.nova.parent = status.anchor;
      for (let i = 0; i < NOVA_RINGS; i++) {
        const ring = CreateTorus("novaRing", { diameter: 2, thickness: 0.04, tessellation: 64 }, this.scene);
        ring.material = this.novaMaterial;
        ring.isPickable = false;
        ring.parent = status.nova;
        ring.position.y = 0.08;
        const disc = CreateDisc("novaDisc", { radius: 1, tessellation: 64 }, this.scene);
        disc.material = this.novaMaterial;
        disc.isPickable = false;
        disc.rotation.x = Math.PI / 2;
        disc.position.y = -0.03;
        disc.parent = ring;
        disc.visibility = 0.25;
      }
    }
    if (!active && status.nova) {
      status.nova.dispose();
      status.nova = null;
    }
    if (!status.nova) return;
    status.nova.getChildMeshes(true).forEach((ring, i) => {
      const phase = (this.time / NOVA_RING_PERIOD + i / NOVA_RINGS) % 1;
      ring.scaling.set(this.novaRadius * phase, 1, this.novaRadius * phase);
      ring.visibility = 0.8 * (1 - phase);
      for (const disc of ring.getChildMeshes()) disc.visibility = 0.2 * (1 - phase);
    });
  }

  // Rempart : la zone protégée (30 m) est marquée au sol, pour tous les joueurs : bord crénelé qui tourne et léger
  // voile vers l'intérieur, bleus pour un Rempart de son camp, rouges pour celui de l'adversaire (ally). Le Gardien est figé pendant tout l'effet : la zone épouse le
  // relief une fois pour toutes. left : temps restant du Rempart (0 quand il n'y en a pas, ou quand son état est réglé sur
  // la page de réglage : la zone réglée la remplace).
  private updateRampartZone(status: PlayerStatus, left: number, dt: number, ally: boolean) {
    if (left > 0 && !status.rampartZone) {
      status.rampartZone = terrainDisc(this.scene, status.feet.x, status.feet.z, RAMPART_RADIUS);
      // Un matériau par zone (texture comprise) : chaque Rempart tourne à son rythme, depuis son apparition.
      status.rampartZone.material = rampartZoneMaterial(this.scene, ally ? RAMPART_ALLY : RAMPART_ENEMY);
      status.rampartAge = 0;
      status.rampartAngle = Math.random() * Math.PI * 2;
    }
    if (left <= 0 && status.rampartZone) {
      status.rampartZone.dispose(false, true);
      status.rampartZone = null;
    }
    if (!status.rampartZone) return;
    status.rampartAge += dt;
    const boost = Math.max(0, 1 - status.rampartAge / RAMPART_SPIN_UP) ** 2;
    status.rampartAngle += dt * (RAMPART_SPIN + RAMPART_SPIN_BOOST * boost);
    ((status.rampartZone.material as StandardMaterial).diffuseTexture as DynamicTexture).wAng = status.rampartAngle;
    const appear = Math.min(1, status.rampartAge / RAMPART_APPEAR);
    status.rampartZone.visibility = Math.min(appear, left / RAMPART_FADE, 1) * (0.85 + Math.sin(this.time * 2.5) * 0.15);
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

// Modèles cachés des formes répétées (étoiles du stun, cristaux du root), un par scène : chaque exemplaire partage
// leur géométrie au lieu de la recalculer (bien plus rapide qu'un nouveau maillage à chaque contrôle).
const formModels = new WeakMap<Scene, Map<string, Mesh>>();
function sharedForm(scene: Scene, key: string, build: () => Mesh): Mesh {
  let models = formModels.get(scene);
  if (!models) formModels.set(scene, (models = new Map()));
  let model = models.get(key);
  if (!model || model.isDisposed()) {
    model = build();
    model.isPickable = false;
    model.setEnabled(false);
    models.set(key, model);
  }
  const mesh = new Mesh(key, scene);
  model.geometry?.applyToMesh(mesh);
  return mesh;
}

// Cristaux pointus, légèrement inclinés vers l'extérieur, en cercle autour des pieds.
function crystalCrown(scene: Scene, material: StandardMaterial): TransformNode {
  const crown = new TransformNode("rootCrystals", scene);
  for (let i = 0; i < CRYSTALS; i++) {
    const height = 0.55 + ((i * 37) % 10) / 20;
    // Cristal de hauteur 1, étiré à sa hauteur.
    const crystal = sharedForm(scene, "crystal", () => CreateCylinder("crystal", { height: 1, diameterTop: 0, diameterBottom: 0.28, tessellation: 4 }, scene));
    crystal.scaling.y = height;
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

// Anneaux de la Nova de givre : bleu glacé, lumineux, en mode additif.
function novaMaterial(scene: Scene): StandardMaterial {
  const material = new StandardMaterial("novaRing", scene);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = new Color3(0.35, 0.7, 1);
  material.disableLighting = true;
  material.alphaMode = Constants.ALPHA_ADD;
  material.backFaceCulling = false;
  material.alpha = 0.6;
  return material;
}

// Disque de rayon donné, centré en (x, z), qui épouse le relief du terrain (légèrement au-dessus).
function terrainDisc(scene: Scene, x: number, z: number, radius: number): Mesh {
  const size = radius * 2;
  const mesh = CreateGround("rampartZone", { width: size, height: size, subdivisions: Math.ceil(size / 1.5), updatable: true }, scene);
  mesh.position.set(x, 0, z);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = terrainHeight(x + positions[i], z + positions[i + 2]) + RAMPART_LIFT;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  mesh.refreshBoundingInfo();
  mesh.isPickable = false;
  return mesh;
}

// Zone du Rempart : texture transparente dessinée par le jeu. Bord crénelé comme le sommet d'une tour vue de
// dessus, voile rouge qui s'efface vers le centre.
function rampartZoneMaterial(scene: Scene, rgb: string): StandardMaterial {
  const size = 1024;
  const texture = new DynamicTexture("rampartZone", size, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  const r = c - 4;
  ctx.clearRect(0, 0, size, size);
  // Voile intérieur.
  const veil = ctx.createRadialGradient(c, c, r * 0.5, c, c, r * 0.94);
  veil.addColorStop(0, `rgba(${rgb},0)`);
  veil.addColorStop(1, `rgba(${rgb},0.22)`);
  ctx.fillStyle = veil;
  ctx.beginPath();
  ctx.arc(c, c, r * 0.94, 0, Math.PI * 2);
  ctx.fill();
  // Anneau du rempart, puis créneaux (merlons) sur son bord extérieur.
  ctx.fillStyle = `rgba(${rgb},0.85)`;
  ctx.beginPath();
  ctx.arc(c, c, r * 0.965, 0, Math.PI * 2);
  ctx.arc(c, c, r * 0.94, 0, Math.PI * 2, true);
  ctx.fill();
  const merlons = 40;
  for (let i = 0; i < merlons; i++) {
    const a0 = (i / merlons) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / merlons / 2;
    ctx.beginPath();
    ctx.arc(c, c, r, a0, a1);
    ctx.arc(c, c, r * 0.965, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
  texture.hasAlpha = true;
  texture.update();
  // Sans éclairage : la couleur est celle de la texture (diffuseTexture multipliée par emissiveColor blanc).
  const material = new StandardMaterial("rampartZone", scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.disableDepthWrite = true;
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
