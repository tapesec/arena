import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import { CLASS_LIST } from "@arena/shared";
import { CharacterAssets, type CharacterInstance } from "./game/characterAssets";
import catalog from "./animationCatalog.json";
import "./styles.css";

// Page de visualisation des animations (http://localhost:5173/animations.html), en développement seulement :
// toutes les animations d'une page sont jouées en boucle en même temps, chacune par un personnage, pour choisir
// celle d'une compétence. Elle charge les bibliothèques complètes, produites par scripts/build-animation-catalog.mjs.

interface AnimationEntry {
  name: string;
  pack: string;
  inGame: boolean;
  loop: boolean;
  category: string;
  description: string;
  usedFor: string;
}
// Triées par nom : les variantes (Sword_Heavy_A, Sword_Heavy_A_Rec…) se suivent.
const ANIMATIONS = (catalog as AnimationEntry[]).slice().sort((a, b) => a.name.localeCompare(b.name));
const CATEGORIES = [...new Set(ANIMATIONS.map((a) => a.category))];
const LIBRARIES = ["/dev-models/animations/UAL1_Standard.glb", "/dev-models/animations/UAL2.glb"];

// Disposition : une grille verticale de cases face à la caméra, une animation par case.
const COLUMNS = 6;
const PAGE_SIZE = 18;
const CELL_WIDTH = 3.2;
const CELL_HEIGHT = 3.4;
// Les noms s'affichent sous les pieds.
const LABEL_OFFSET = 0.25;
const VIEWS = { Face: 0, "Trois-quarts": Math.PI / 4, Profil: Math.PI / 2, Dos: Math.PI } as const;
type View = keyof typeof VIEWS;
const SPEEDS = [0.25, 0.5, 1, 2];

interface Cell {
  entry: AnimationEntry;
  holder: TransformNode;
  anchor: Vector3;
}

// La scène Babylon : une seule pour toute la page, les personnages y sont recréés à chaque changement de page.
class Stage {
  private engine: Engine;
  readonly scene: Scene;
  private camera: FreeCamera;
  private assets: CharacterAssets;
  private instances: CharacterInstance[] = [];
  private nodes: TransformNode[] = [];
  private build = 0;
  cells: Cell[] = [];
  onFrame: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.09, 0.1, 0.13, 1);
    new HemisphericLight("sky", new Vector3(0, 1, 0.3), this.scene).intensity = 0.9;
    const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.6), this.scene);
    sun.intensity = 1.6;
    // Caméra orthographique (sans perspective) légèrement plongeante : toutes les cases ont la même taille.
    this.camera = new FreeCamera("camera", new Vector3(0, 6, 40), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.setTarget(new Vector3(0, 0, 0));
    this.assets = new CharacterAssets(this.scene, LIBRARIES);
    this.engine.runRenderLoop(() => {
      this.scene.render();
      this.onFrame?.();
    });
    window.addEventListener("resize", this.resize);
  }

  private resize = () => {
    this.engine.resize();
    this.fit();
  };

  // Cadre la grille entière, quel que soit le format de la fenêtre.
  private fit() {
    const rows = Math.max(1, Math.ceil(this.cells.length / COLUMNS));
    const width = COLUMNS * CELL_WIDTH;
    const height = rows * CELL_HEIGHT;
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const halfHeight = Math.max(height / 2, width / aspect / 2) + 0.3;
    const halfWidth = halfHeight * aspect;
    this.camera.orthoTop = halfHeight;
    this.camera.orthoBottom = -halfHeight;
    this.camera.orthoLeft = -halfWidth;
    this.camera.orthoRight = halfWidth;
  }

  async show(entries: AnimationEntry[], classId: string, view: View, speed: number): Promise<string | null> {
    const build = ++this.build;
    this.clear();
    const rows = Math.max(1, Math.ceil(entries.length / COLUMNS));
    this.cells = entries.map((entry, i) => {
      const column = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);
      // La caméra regarde vers -z : la gauche de l'écran est du côté des x positifs.
      const x = ((COLUMNS - 1) / 2 - column) * CELL_WIDTH;
      const y = ((rows - 1) / 2 - row) * CELL_HEIGHT - CELL_HEIGHT / 2 + 0.3;
      const holder = new TransformNode(`cell-${entry.name}`, this.scene);
      holder.position.set(x, y, 0);
      holder.rotation.y = VIEWS[view];
      this.nodes.push(holder);
      const disc = CreateDisc(`floor-${entry.name}`, { radius: 1.1, tessellation: 32 }, this.scene);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(x, y, 0);
      disc.material = this.floorMaterial();
      this.nodes.push(disc);
      return { entry, holder, anchor: new Vector3(x, y - LABEL_OFFSET, 0) };
    });
    this.fit();
    try {
      for (const cell of this.cells) {
        const instance = await this.assets.create(classId, cell.holder, new Set([cell.entry.name]));
        if (build !== this.build) {
          instance?.dispose();
          return null;
        }
        if (!instance) continue;
        instance.setTeam(0);
        this.instances.push(instance);
        const group = instance.animations.get(cell.entry.name);
        group?.start(true, speed);
      }
    } catch {
      // Un chargement abandonné (page changée, scène fermée) n'est pas une erreur.
      if (build !== this.build || this.disposed) return null;
      return "Bibliothèques complètes introuvables : lancez « node scripts/build-animation-catalog.mjs » à la racine du projet.";
    }
    return null;
  }

  private floor: StandardMaterial | null = null;
  private floorMaterial() {
    if (!this.floor) {
      this.floor = new StandardMaterial("floor", this.scene);
      this.floor.diffuseColor = new Color3(0.22, 0.24, 0.28);
      this.floor.specularColor = Color3.Black();
    }
    return this.floor;
  }

  setView(view: View) {
    for (const cell of this.cells) cell.holder.rotation.y = VIEWS[view];
  }

  setSpeed(speed: number) {
    for (const instance of this.instances) for (const group of instance.animations.values()) group.speedRatio = speed;
  }

  // Rejoue toutes les animations depuis le début, en même temps.
  restart() {
    for (const instance of this.instances) for (const group of instance.animations.values()) group.goToFrame(group.from);
  }

  // Position à l'écran (en pixels CSS) du nom d'une case.
  labelPosition(cell: Cell): { x: number; y: number } {
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const projected = Vector3.Project(cell.anchor, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(width, height));
    const ratio = this.canvas.clientWidth / Math.max(1, width);
    return { x: projected.x * ratio, y: projected.y * ratio };
  }

  private clear() {
    for (const instance of this.instances) instance.dispose();
    for (const node of this.nodes) node.dispose(false, false);
    this.instances = [];
    this.nodes = [];
    this.cells = [];
  }

  private disposed = false;
  dispose() {
    this.disposed = true;
    window.removeEventListener("resize", this.resize);
    this.clear();
    this.engine.dispose();
  }
}

function AnimationViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [classId, setClassId] = useState("gardien");
  const [category, setCategory] = useState("Combat");
  const [inGame, setInGame] = useState<"all" | "yes" | "no">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<View>("Trois-quarts");
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase();
    return ANIMATIONS.filter(
      (a) =>
        (category === "Toutes" || a.category === category) &&
        (inGame === "all" || a.inGame === (inGame === "yes")) &&
        (!text || a.name.toLowerCase().includes(text) || a.description.toLowerCase().includes(text)),
    );
  }, [category, inGame, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = useMemo(() => filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE), [filtered, current]);

  useEffect(() => {
    const stage = new Stage(canvasRef.current!);
    stageRef.current = stage;
    // Accès depuis la console, pour régler les armes en main.
    Object.assign(window, { stage });
    // Les noms suivent les cases à chaque image (elles bougent quand la fenêtre change de taille).
    stage.onFrame = () => {
      const labels = labelsRef.current?.children;
      if (!labels) return;
      stage.cells.forEach((cell, i) => {
        const label = labels[i] as HTMLElement | undefined;
        if (!label) return;
        const { x, y } = stage.labelPosition(cell);
        label.style.transform = `translate(${x}px, ${y}px) translateX(-50%)`;
      });
    };
    return () => stage.dispose();
  }, []);

  // La vitesse et la vue courantes sont lues au moment de reconstruire, sans relancer la reconstruction.
  const settings = useRef({ view, speed });
  settings.current = { view, speed };
  useEffect(() => {
    void stageRef.current?.show(shown, classId, settings.current.view, settings.current.speed).then((message) => {
      setError(message);
    });
  }, [shown, classId]);
  useEffect(() => stageRef.current?.setView(view), [view]);
  useEffect(() => stageRef.current?.setSpeed(speed), [speed]);

  const copy = (name: string) => {
    void navigator.clipboard?.writeText(name);
    setCopied(name);
    setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500);
  };

  return (
    <div className="anim-viewer">
      <div className="anim-toolbar">
        <strong>Animations</strong>
        <label>
          Classe
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            {CLASS_LIST.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Catégorie
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option>Toutes</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Dans le jeu
          <select
            value={inGame}
            onChange={(e) => {
              setInGame(e.target.value as "all" | "yes" | "no");
              setPage(0);
            }}
          >
            <option value="all">Toutes</option>
            <option value="yes">Oui</option>
            <option value="no">Non</option>
          </select>
        </label>
        <input
          type="search"
          placeholder="Rechercher (nom, description)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <label>
          Vue
          <select value={view} onChange={(e) => setView(e.target.value as View)}>
            {Object.keys(VIEWS).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Vitesse
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                ×{String(s).replace(".", ",")}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => stageRef.current?.restart()}>Rejouer</button>
        <span className="anim-pages">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            ◀
          </button>
          Page {current + 1} / {pages} · {filtered.length} animations
          <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            ▶
          </button>
        </span>
      </div>
      <div className="anim-stage">
        <canvas ref={canvasRef} className="anim-canvas" />
        <div ref={labelsRef} className="anim-labels">
          {shown.map((a) => (
            <button
              key={a.name}
              className={`anim-label ${a.inGame ? "anim-label-ingame" : ""}`}
              title={`${a.description}${a.usedFor ? `\nDans le jeu : ${a.usedFor}` : ""}\nCliquer pour copier le nom`}
              onClick={() => copy(a.name)}
            >
              {copied === a.name ? "Copié !" : a.name}
            </button>
          ))}
        </div>
        {error && <div className="anim-error">{error}</div>}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AnimationViewer />
  </StrictMode>,
);
