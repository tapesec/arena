import { StrictMode, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Scene } from "@babylonjs/core/scene";
import { CLASS_LIST, CLASSES, getAbility, type ClassId } from "@arena/shared";
import {
  MAX_RATE,
  MIN_RATE,
  castTimeOf,
  clampAbilityAnimation,
  effectsOf,
  shiftEffect,
  releaseTime,
  suggestedAbilityAnimation,
  type AbilityAnimation,
  type AnimationEffect,
  type AnimationTuning,
  type EffectAnchor,
  type EffectKey,
  type ClassAnimationTuning,
} from "./game/abilityAnimations";
import { CharacterAnimator, framesPerSecond } from "./game/CharacterAnimator";
import { CharacterAssets, type CharacterAnimationSet, type CharacterInstance } from "./game/characterAssets";
import { AbilityEffectPlayer, EFFECT_ANCHORS, EFFECT_RECIPES } from "./game/abilityEffects";
import { ParticleFactory } from "./game/particles";
import catalog from "./animationCatalog.json";
import "./styles.css";

// Page de réglage des animations de compétence (http://localhost:5173/animation-lab.html), en développement
// seulement. Pour chaque compétence d'une classe : l'animation, la portion jouée et la vitesse, sur une timeline.
// Les réglages sont gardés en brouillon dans le navigateur, puis enregistrés dans src/game/animationTuning.json,
// que le jeu lit (voir AbilityAnimation pour leur sens).

const LIBRARIES = ["/dev-models/animations/UAL1.glb", "/dev-models/animations/UAL2.glb"];
const DRAFT_KEY = "arena.animationLab.draft";
const SELECTION_KEY = "arena.animationLab.selection";
// Pause dans la pose normale entre deux lectures « comme en jeu ».
const IDLE_PAUSE = 0.8;
// Pas de la timeline : une image d'animation à 60 images/s.
const SNAP = 1 / 60;

const IN_GAME = new Set((catalog as { name: string; inGame: boolean }[]).filter((a) => a.inGame).map((a) => a.name));

interface FrameInfo {
  // Position de lecture dans l'animation sélectionnée (secondes), null si elle ne joue pas.
  playhead: number | null;
  // Progression de l'incantation simulée (0 à 1), null hors incantation.
  cast: number | null;
}

class Stage {
  private engine: Engine;
  private scene: Scene;
  private assets: CharacterAssets;
  private holder: TransformNode;
  private fx: ParticleFactory;
  private instance: CharacterInstance | null = null;
  private animator: CharacterAnimator | null = null;
  private build = 0;
  // Réglage montré, partagé avec l'animateur (le même objet est modifié à chaque changement).
  private tuning: ClassAnimationTuning = {};
  private abilityId = "";
  private entry: AbilityAnimation | null = null;
  private mode: "play" | "scrub" = "scrub";
  private scrubTime = 0;
  private cycle: { phase: "idle" | "cast" | "after"; time: number } = { phase: "idle", time: 0 };
  // Animation figée pour la pose montrée (sans fondu), tant qu'on ne relance pas la lecture.
  private frozen: AnimationGroup | null = null;
  private effects: AbilityEffectPlayer;
  onFrame: ((info: FrameInfo) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.09, 0.1, 0.13, 1);
    new HemisphericLight("sky", new Vector3(0, 1, 0.3), this.scene).intensity = 0.9;
    const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.6), this.scene);
    sun.intensity = 1.6;
    // Trois-quarts face (le personnage regarde vers +z) ; la souris tourne autour, la molette rapproche.
    const camera = new ArcRotateCamera("camera", Math.PI / 3, 1.25, 5.5, new Vector3(0, 1.1, 0), this.scene);
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 12;
    camera.wheelPrecision = 40;
    camera.attachControl(canvas, true);
    const floor = CreateDisc("floor", { radius: 1.4, tessellation: 48 }, this.scene);
    floor.rotation.x = Math.PI / 2;
    const material = new StandardMaterial("floor", this.scene);
    material.diffuseColor = new Color3(0.22, 0.24, 0.28);
    material.specularColor = Color3.Black();
    floor.material = material;
    this.holder = new TransformNode("holder", this.scene);
    this.assets = new CharacterAssets(this.scene, LIBRARIES);
    this.fx = new ParticleFactory(this.scene);
    this.effects = new AbilityEffectPlayer(this.fx);
    this.scene.onBeforeRenderObservable.add(() => this.tick(Math.min(this.engine.getDeltaTime() / 1000, 0.1)));
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", this.resize);
  }

  private resize = () => this.engine.resize();

  async load(classId: string): Promise<CharacterInstance | null> {
    const build = ++this.build;
    this.effects.stopAll();
    this.animator = null;
    this.frozen = null;
    this.instance?.dispose();
    this.instance = null;
    const instance = await this.assets.create(classId, this.holder);
    if (build !== this.build) {
      instance?.dispose();
      return null;
    }
    if (!instance) return null;
    instance.setTeam(0);
    this.instance = instance;
    this.restart();
    return instance;
  }

  // Durée d'une animation, en secondes.
  clipLength(name: string): number {
    const group = this.instance?.animations.get(name);
    return group ? (group.to - group.from) / framesPerSecond(group) : 0;
  }

  select(abilityId: string, entry: AbilityAnimation | null) {
    const changed = abilityId !== this.abilityId || entry?.animation !== this.entry?.animation;
    this.abilityId = abilityId;
    this.entry = entry;
    for (const key of Object.keys(this.tuning)) delete this.tuning[key];
    if (entry) this.tuning[abilityId] = entry;
    if (this.mode === "scrub") this.showFrame();
    else if (changed) this.restart();
  }

  // Lecture comme en jeu : pose normale, incantation, départ du sort, fin du geste, puis on recommence.
  play() {
    this.mode = "play";
    this.restart();
  }

  // Pose figée à un instant de l'animation sélectionnée.
  scrub(time: number) {
    this.mode = "scrub";
    this.scrubTime = time;
    this.showFrame();
  }

  get playing(): boolean {
    return this.mode === "play";
  }

  private restart() {
    const instance = this.instance;
    if (!instance) return;
    this.effects.stopAll();
    for (const group of instance.animations.values()) group.stop();
    this.frozen = null;
    // Nouvel animateur : il remet les fondus que la pose figée retire.
    this.animator = new CharacterAnimator(instance.animations, instance.set, this.tuning);
    this.cycle = { phase: "idle", time: IDLE_PAUSE - 0.3 };
    if (this.mode === "scrub") this.showFrame();
  }

  private showFrame() {
    const instance = this.instance;
    const group = this.entry && instance?.animations.get(this.entry.animation);
    if (!instance || !group) return;
    if (this.frozen !== group) {
      for (const other of instance.animations.values()) other.stop();
      group.enableBlending = false;
      group.start(false, 1, group.from, group.to);
      group.pause();
      this.frozen = group;
    }
    group.goToFrame(group.from + this.scrubTime * framesPerSecond(group));
    instance.setStowed(true);
    this.onFrame?.({ playhead: this.scrubTime, cast: null });
  }

  private tick(dt: number) {
    this.fx.update();
    const instance = this.instance;
    const animator = this.animator;
    const entry = this.entry;
    // Pose figée : les effets actifs à cet instant sont montrés à leur place.
    if (this.mode === "scrub" && instance && entry && this.frozen) {
      this.effects.update(instance, { abilityId: this.abilityId, entry, time: this.scrubTime });
    }
    if (this.mode !== "play" || !instance || !animator || !entry) return;
    const castTime = castTimeOf(this.abilityId);
    const cycle = this.cycle;
    cycle.time += dt;
    if (cycle.phase === "idle" && cycle.time >= IDLE_PAUSE) {
      cycle.time = 0;
      if (castTime > 0) cycle.phase = "cast";
      else {
        animator.ability(this.abilityId);
        cycle.phase = "after";
      }
    } else if (cycle.phase === "cast" && cycle.time >= castTime) {
      cycle.time = 0;
      animator.ability(this.abilityId);
      cycle.phase = "after";
    } else if (cycle.phase === "after" && cycle.time > 0.2 && (!animator.performingAbility || cycle.time > 10)) {
      cycle.phase = "idle";
      cycle.time = 0;
    }
    const casting = cycle.phase === "cast";
    animator.update({
      alive: true,
      castAbility: casting ? this.abilityId : "",
      castElapsed: casting ? cycle.time : 0,
      castDuration: castTime,
      stunned: false,
      rooted: false,
      charging: false,
      rampart: false,
      forward: 0,
      right: 0,
    });
    instance.setStowed(casting || animator.performingAbility);
    this.effects.update(instance, animator.playingAbility());
    const group = instance.animations.get(entry.animation);
    const frame = group?.isPlaying ? group.animatables[0]?.masterFrame : undefined;
    this.onFrame?.({
      playhead: group && frame !== undefined ? (frame - group.from) / framesPerSecond(group) : null,
      cast: casting ? Math.min(1, cycle.time / castTime) : null,
    });
  }

  disposed = false;
  dispose() {
    this.disposed = true;
    this.build++;
    window.removeEventListener("resize", this.resize);
    this.instance?.dispose();
    this.fx.dispose();
    this.engine.dispose();
  }
}

// Compétences d'une classe, dans l'ordre de sa barre, puis celles qui n'y sont pas mais ont une animation (la
// Bulle, l'impact de la Charge).
function abilityIds(classId: ClassId, set: CharacterAnimationSet | null): string[] {
  const ids = [...CLASSES[classId].abilities];
  if (set) {
    for (const id of [...Object.keys(set.castGestures ?? {}), ...Object.keys(set.abilities)]) {
      if (id !== "default" && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function abilityName(id: string): string {
  if (id === "chargeImpact") return "Charge (impact à l'arrivée)";
  return getAbility(id)?.name ?? id;
}

// Compétences jouées par une posture tenue pendant tout l'effet (course de la Charge, garde du Rempart).
function isStance(set: CharacterAnimationSet | null, id: string): boolean {
  return set?.abilities[id] === "";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundEntry(entry: AbilityAnimation): AbilityAnimation {
  const rounded: AbilityAnimation = { animation: entry.animation, start: round(entry.start), rate: round(entry.rate), end: round(entry.end) };
  if (entry.effects) {
    rounded.effects = entry.effects.map((effect) => ({
      recipe: effect.recipe,
      start: round(effect.start),
      end: round(effect.end),
      anchor: effect.anchor,
      offset: effect.offset.map(round) as [number, number, number],
      ...(effect.keys && {
        keys: effect.keys.map((key) => ({ time: round(key.time), anchor: key.anchor, offset: key.offset.map(round) as [number, number, number] })),
      }),
    }));
  }
  return rounded;
}

// Réglages sans classe vide, dans un ordre stable (pour comparer et enregistrer).
function normalized(tuning: AnimationTuning): AnimationTuning {
  const result: AnimationTuning = {};
  for (const classId of Object.keys(tuning).sort()) {
    const entries = tuning[classId];
    const ids = Object.keys(entries).sort();
    if (ids.length) result[classId] = Object.fromEntries(ids.map((id) => [id, roundEntry(entries[id])]));
  }
  return result;
}

function sameEntry(a: AbilityAnimation | undefined, b: AbilityAnimation | undefined): boolean {
  return JSON.stringify(a && roundEntry(a)) === JSON.stringify(b && roundEntry(b));
}

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible (navigation privée) : le brouillon n'est simplement pas gardé.
  }
}

const seconds = (value: number) => `${value.toFixed(2).replace(".", ",")} s`;

function AnimationLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const castBarRef = useRef<HTMLDivElement>(null);
  const initial = readStorage<{ classId: ClassId; abilityId: string }>(SELECTION_KEY);
  const [classId, setClassId] = useState<ClassId>(initial?.classId ?? "arcaniste");
  const [abilityId, setAbilityId] = useState(initial?.abilityId ?? "firebolt");
  const [instance, setInstance] = useState<CharacterInstance | null>(null);
  const [saved, setSaved] = useState<AnimationTuning | null>(null);
  const [draft, setDraft] = useState<AnimationTuning>({});
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedEffect, setSelectedEffect] = useState(0);
  // Instant montré en pose figée (secondes dans l'animation) : là où se pose un nouveau point clé.
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = instance?.set ?? null;
  const castTime = castTimeOf(abilityId);
  const stage = stageRef.current;
  const clipLength = (name: string) => stage?.clipLength(name) ?? 0;

  useEffect(() => {
    const created = new Stage(canvasRef.current!);
    stageRef.current = created;
    Object.assign(window, { lab: created });
    created.onFrame = ({ playhead, cast }) => {
      const head = playheadRef.current;
      if (head) {
        head.style.display = playhead === null ? "none" : "block";
        if (playhead !== null) head.style.left = `${(playhead / Math.max(1e-3, Number(head.dataset.length))) * 100}%`;
      }
      const bar = castBarRef.current;
      if (bar) {
        bar.style.visibility = cast === null ? "hidden" : "visible";
        (bar.firstElementChild as HTMLElement).style.width = `${(cast ?? 0) * 100}%`;
      }
    };
    return () => created.dispose();
  }, []);

  // Réglages enregistrés, et brouillon du navigateur s'il y en a un.
  useEffect(() => {
    void fetch("/__animation-tuning")
      .then((response) => (response.ok ? (response.json() as Promise<AnimationTuning>) : Promise.reject(new Error(String(response.status)))))
      .then((tuning) => {
        setSaved(tuning);
        setDraft(readStorage<AnimationTuning>(DRAFT_KEY) ?? tuning);
      })
      .catch(() => setError("Impossible de lire les réglages : la page doit être servie par le serveur de développement (npm run dev)."));
  }, []);

  useEffect(() => {
    if (!saved) return;
    const dirty = JSON.stringify(normalized(draft)) !== JSON.stringify(normalized(saved));
    writeStorage(DRAFT_KEY, dirty ? draft : null);
  }, [draft, saved]);

  useEffect(() => writeStorage(SELECTION_KEY, { classId, abilityId }), [classId, abilityId]);

  useEffect(() => {
    setInstance(null);
    const stage = stageRef.current;
    void stage?.load(classId).then(
      (loaded) => loaded && setInstance(loaded),
      // Un chargement abandonné (scène fermée, classe changée) n'est pas une erreur.
      () => stageRef.current === stage && !stage?.disposed && setError("Bibliothèques complètes introuvables : lancez « node scripts/build-animation-catalog.mjs » à la racine du projet."),
    );
  }, [classId]);

  const ids = useMemo(() => abilityIds(classId, set), [classId, set]);
  // Une compétence d'une autre classe (classe changée) : on prend la première de la nouvelle.
  useEffect(() => {
    if (!ids.includes(abilityId)) setAbilityId(ids[0]);
  }, [ids, abilityId]);

  const stance = isStance(set, abilityId);
  const tuned = draft[classId]?.[abilityId];
  const savedEntry = saved?.[classId]?.[abilityId];
  const entry = useMemo(() => {
    if (!instance || stance) return null;
    const base = tuned ?? suggestedAbilityAnimation(instance.set, abilityId, (name) => stageRef.current?.clipLength(name) ?? 0);
    if (!base) return null;
    // Effets montrés tels que le jeu les jouera : ceux du réglage, sinon ceux prévus dans le code.
    const withEffects = { ...base, effects: effectsOf(base, abilityId) };
    return clampAbilityAnimation(withEffects, castTime, stageRef.current?.clipLength(base.animation) ?? 0);
  }, [instance, stance, tuned, abilityId, castTime]);
  const length = entry ? clipLength(entry.animation) : 0;

  useEffect(() => {
    stageRef.current?.select(abilityId, entry);
  }, [abilityId, entry]);

  const animations = useMemo(() => {
    if (!instance) return [];
    const text = filter.trim().toLowerCase();
    return [...instance.animations.keys()]
      .filter((name) => !text || name.toLowerCase().includes(text) || name === entry?.animation)
      .sort((a, b) => a.localeCompare(b));
  }, [instance, filter, entry?.animation]);

  const update = (next: AbilityAnimation) => {
    const clamped = roundEntry(clampAbilityAnimation(next, castTime, clipLength(next.animation)));
    setDraft((d) => ({ ...d, [classId]: { ...d[classId], [abilityId]: clamped } }));
  };

  const removeEntry = () =>
    setDraft((d) => {
      const entries = { ...d[classId] };
      delete entries[abilityId];
      return { ...d, [classId]: entries };
    });

  const revert = () => {
    if (savedEntry) setDraft((d) => ({ ...d, [classId]: { ...d[classId], [abilityId]: savedEntry } }));
    else removeEntry();
  };

  const chooseAnimation = (name: string) => {
    const clip = clipLength(name);
    const rate = castTime > 0 ? Math.min(1, clip / castTime) : 1;
    const end = castTime > 0 ? Math.min(clip, castTime * rate + 0.5) : clip;
    // Les effets gardent leur place par rapport au début du geste.
    const shift = -(entry?.start ?? 0);
    const effects = entry?.effects?.map((effect) => shiftEffect(effect, shift));
    update({ animation: name, start: 0, rate, end, effects });
  };

  const scrub = (time: number) => {
    setCursor(Math.max(0, Math.min(length, time)));
    stageRef.current?.scrub(Math.max(0, Math.min(length, time)));
    setPlaying(false);
  };

  const togglePlay = () => {
    const current = stageRef.current;
    if (!current) return;
    if (current.playing) current.scrub(entry?.start ?? 0);
    else current.play();
    setPlaying(current.playing);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || (event.target as HTMLElement).closest("input, select, textarea")) return;
      event.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const save = async () => {
    const tuning = normalized(draft);
    const response = await fetch("/__animation-tuning", { method: "POST", body: JSON.stringify(tuning) });
    if (!response.ok) {
      setMessage(`Échec de l'enregistrement : ${await response.text()}`);
      return;
    }
    setSaved(tuning);
    setDraft(tuning);
    setMessage("Enregistré dans src/game/animationTuning.json : le jeu l'utilise au prochain chargement.");
    setTimeout(() => setMessage(null), 4000);
  };

  const status = (cls: ClassId, id: string): "saved" | "draft" | "" => {
    const d = draft[cls]?.[id];
    const s = saved?.[cls]?.[id];
    if (!sameEntry(d, s)) return "draft";
    return s ? "saved" : "";
  };
  const unsaved = saved !== null && JSON.stringify(normalized(draft)) !== JSON.stringify(normalized(saved));

  const release = entry ? releaseTime(entry, castTime) : 0;
  const screenAfter = entry ? (entry.end - (castTime > 0 ? release : entry.start)) / entry.rate : 0;

  return (
    <div className="anim-viewer">
      <div className="anim-toolbar">
        <strong>Réglage des animations</strong>
        <label>
          Classe
          <select value={classId} onChange={(e) => setClassId(e.target.value as ClassId)}>
            {CLASS_LIST.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <span className="lab-hint">Souris : tourner autour · molette : zoom · espace : lecture</span>
        <span className="anim-pages">
          {message && <span className="lab-message">{message}</span>}
          <button disabled={!unsaved} onClick={() => void save()} className={unsaved ? "lab-save" : ""}>
            {unsaved ? "Enregistrer" : "Tout est enregistré"}
          </button>
        </span>
      </div>
      <div className="lab-body">
        <div className="lab-abilities">
          {ids.map((id) => {
            const state = status(classId, id);
            const cast = castTimeOf(id);
            return (
              <button
                key={id}
                className={`lab-ability ${id === abilityId ? "lab-ability-selected" : ""} ${isStance(set, id) ? "lab-ability-stance" : ""}`}
                onClick={() => setAbilityId(id)}
              >
                <span>{abilityName(id)}</span>
                <small>
                  {cast > 0 ? `incantation ${seconds(cast)}` : "instantané"}
                  {state === "saved" && " · réglé"}
                  {state === "draft" && " · modifié"}
                </small>
              </button>
            );
          })}
        </div>
        <div className="anim-stage">
          <canvas ref={canvasRef} className="anim-canvas" />
          <div ref={castBarRef} className="lab-castbar" style={{ visibility: "hidden" }}>
            <div />
            <span>{abilityName(abilityId)}</span>
          </div>
          {!instance && !error && <div className="lab-loading">Chargement des animations…</div>}
          {error && <div className="anim-error">{error}</div>}
        </div>
      </div>
      <div className="lab-panel">
        {stance ? (
          <p className="lab-note">
            {abilityName(abilityId)} est jouée par une posture tenue pendant tout l'effet (voir stances dans characterAssets.ts) :
            elle ne se règle pas ici.
          </p>
        ) : entry ? (
          <>
            <div className="lab-controls">
              <button className="lab-play" onClick={togglePlay}>
                {playing ? "⏸ Pause" : "▶ Jouer comme en jeu"}
              </button>
              <label>
                Animation
                <select value={entry.animation} onChange={(e) => chooseAnimation(e.target.value)}>
                  {animations.map((name) => (
                    <option key={name} value={name}>
                      {name}
                      {IN_GAME.has(name) ? " ✓" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <input type="search" placeholder="Filtrer les animations" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <label className="lab-rate">
                Vitesse ×{entry.rate.toFixed(2).replace(".", ",")}
                <input
                  type="range"
                  min={MIN_RATE}
                  max={MAX_RATE}
                  step={0.01}
                  value={entry.rate}
                  onChange={(e) => {
                    const rate = Number(e.target.value);
                    // Sort incanté : le début reste en place, la suite du geste garde sa longueur.
                    const shift = castTime > 0 ? castTime * (rate - entry.rate) : 0;
                    update({ ...entry, rate, end: entry.end + shift });
                  }}
                />
              </label>
              <button disabled={sameEntry(tuned, savedEntry)} onClick={revert} title="Revenir au réglage enregistré">
                Annuler les modifications
              </button>
              <button disabled={!tuned} onClick={removeEntry} title="Supprimer le réglage : le jeu reprend le calage prévu dans le code">
                Revenir au calage du code
              </button>
            </div>
            <Timeline
              length={length}
              castTime={castTime}
              entry={entry}
              playheadRef={playheadRef}
              onChange={update}
              onScrub={scrub}
            />
            <EffectsPanel
              length={length}
              castTime={castTime}
              entry={entry}
              selected={selectedEffect}
              onSelect={setSelectedEffect}
              cursor={cursor}
              playing={playing}
              onChange={(effects) => update({ ...entry, effects })}
              onScrub={scrub}
            />
            <div className="lab-summary">
              {castTime > 0 ? (
                <>
                  Début {seconds(entry.start)} · départ du sort {seconds(release)} · fin {seconds(entry.end)} — à l'écran :
                  incantation {seconds(castTime)}, puis {seconds(screenAfter)} après le départ du sort
                </>
              ) : (
                <>
                  Début {seconds(entry.start)} · fin {seconds(entry.end)} — à l'écran : {seconds(screenAfter)}
                </>
              )}
              {!tuned && " · calage actuel du code (pas encore réglé)"}
            </div>
          </>
        ) : (
          <p className="lab-note">Chargement…</p>
        )}
      </div>
    </div>
  );
}

type Drag = "move" | "start" | "release" | "end" | "scrub";

// Timeline de l'animation entière. Sort incanté : la fenêtre d'incantation (début → départ du sort, sa longueur
// suit la vitesse) puis la suite du geste jusqu'à la fin. Compétence instantanée : la portion jouée.
function Timeline(props: {
  length: number;
  castTime: number;
  entry: AbilityAnimation;
  playheadRef: RefObject<HTMLDivElement | null>;
  onChange: (entry: AbilityAnimation) => void;
  onScrub: (time: number) => void;
}) {
  const { length, castTime, entry, playheadRef, onChange, onScrub } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const casting = castTime > 0;
  const release = releaseTime(entry, castTime);
  const percent = (time: number) => `${(time / Math.max(length, 1e-3)) * 100}%`;
  const snap = (time: number) => Math.round(time / SNAP) * SNAP;

  const begin = (kind: Drag, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    const width = track.getBoundingClientRect().width;
    const left = track.getBoundingClientRect().left;
    const x0 = event.clientX;
    const e0 = entry;
    const r0 = release;
    const apply = (clientX: number) => {
      const d = snap(((clientX - x0) / width) * length);
      if (kind === "scrub") {
        onScrub(snap(((clientX - left) / width) * length));
        return;
      }
      let next = e0;
      if (kind === "move") {
        const shift = Math.max(-e0.start, Math.min(d, length - Math.max(r0, e0.end)));
        next = {
          ...e0,
          start: e0.start + shift,
          end: e0.end + shift,
          effects: e0.effects?.map((effect) => shiftEffect(effect, shift)),
        };
      } else if (kind === "start" && casting) {
        // Le départ du sort reste en place : la fenêtre s'étire, la vitesse change.
        const start = Math.min(r0 - castTime * MIN_RATE, Math.max(r0 - castTime * MAX_RATE, 0, e0.start + d));
        next = { ...e0, start, rate: (r0 - start) / castTime };
      } else if (kind === "start") {
        next = { ...e0, start: Math.max(0, Math.min(e0.end - SNAP, e0.start + d)) };
      } else if (kind === "release") {
        const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, (r0 + d - e0.start) / castTime));
        next = { ...e0, rate, end: e0.end + (e0.start + castTime * rate - r0) };
      } else {
        next = { ...e0, end: Math.max(casting ? r0 : e0.start + SNAP, Math.min(length, e0.end + d)) };
      }
      onChange(next);
      // La pose montrée suit le bord déplacé, ou le pointeur quand on glisse toute la fenêtre.
      const pointer = snap(((clientX - left) / width) * length);
      const shown = kind === "end" ? next.end : kind === "release" ? releaseTime(next, castTime) : kind === "move" ? pointer : next.start;
      onScrub(Math.min(length, shown));
    };
    if (kind === "scrub") apply(event.clientX);
    // Un clic sur la fenêtre montre la pose à cet endroit.
    if (kind === "move") onScrub(snap(((event.clientX - left) / width) * length));
    const move = (e: PointerEvent) => apply(e.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ticks = [];
  for (let t = 0; t <= length + 1e-6; t += 0.25) {
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    ticks.push(
      <div key={t} className={`lab-tick ${whole ? "lab-tick-major" : ""}`} style={{ left: percent(t) }}>
        {whole && <span>{t} s</span>}
      </div>,
    );
  }

  return (
    <div className="lab-timeline">
      <div ref={trackRef} className="lab-track" onPointerDown={(e) => begin("scrub", e)}>
        {ticks}
        {casting ? (
          <>
            <div
              className="lab-range lab-range-cast"
              style={{ left: percent(entry.start), width: percent(release - entry.start) }}
              onPointerDown={(e) => begin("move", e)}
              title="Incantation : glisser pour déplacer la portion jouée"
            >
              <span>Incantation {seconds(castTime)}</span>
              <div className="lab-handle lab-handle-left" onPointerDown={(e) => begin("start", e)} title="Début (étire la fenêtre : change la vitesse)" />
              <div className="lab-handle lab-handle-right" onPointerDown={(e) => begin("release", e)} title="Départ du sort (change la vitesse)" />
            </div>
            <div className="lab-range lab-range-after" style={{ left: percent(release), width: percent(entry.end - release) }}>
              <div className="lab-handle lab-handle-right" onPointerDown={(e) => begin("end", e)} title="Fin du geste" />
            </div>
          </>
        ) : (
          <div
            className="lab-range lab-range-cast"
            style={{ left: percent(entry.start), width: percent(entry.end - entry.start) }}
            onPointerDown={(e) => begin("move", e)}
            title="Portion jouée : glisser pour la déplacer"
          >
            <span>Geste</span>
            <div className="lab-handle lab-handle-left" onPointerDown={(e) => begin("start", e)} title="Début" />
            <div className="lab-handle lab-handle-right" onPointerDown={(e) => begin("end", e)} title="Fin" />
          </div>
        )}
        <div ref={playheadRef} className="lab-playhead" data-length={length} />
      </div>
    </div>
  );
}

// Déplacement à la souris sur une piste : delta et position du pointeur, en secondes d'animation.
function dragOnTrack(event: ReactPointerEvent, track: HTMLElement | null, length: number, onMove: (delta: number, at: number) => void) {
  event.preventDefault();
  event.stopPropagation();
  if (!track) return;
  const { left, width } = track.getBoundingClientRect();
  const x0 = event.clientX;
  const snap = (time: number) => Math.round(time / SNAP) * SNAP;
  const move = (e: PointerEvent) => onMove(snap(((e.clientX - x0) / width) * length), snap(((e.clientX - left) / width) * length));
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  // Un simple clic agit déjà (pose montrée à l'endroit cliqué ou au début de l'effet).
  onMove(0, snap(((event.clientX - left) / width) * length));
}

// Réglage du décalage d'un effet (mètres) : un double-clic remet à zéro.
const OFFSETS: { label: string; min: number; max: number }[] = [
  { label: "Gauche ← → droite", min: -1.5, max: 1.5 },
  { label: "Bas ↓ ↑ haut", min: -1.5, max: 2.5 },
  { label: "Arrière ← → avant", min: -1.5, max: 1.5 },
];

// Piste des effets à particules (une ligne par effet, à glisser comme la fenêtre d'incantation) et réglages de
// l'effet sélectionné.
function EffectsPanel(props: {
  length: number;
  castTime: number;
  entry: AbilityAnimation;
  selected: number;
  onSelect: (index: number) => void;
  cursor: number;
  playing: boolean;
  onChange: (effects: AnimationEffect[]) => void;
  onScrub: (time: number) => void;
}) {
  const { length, castTime, entry, selected, onSelect, cursor, playing, onChange, onScrub } = props;
  const effects = entry.effects ?? [];
  const tracks = useRef<(HTMLDivElement | null)[]>([]);
  const [selectedKey, setSelectedKey] = useState(0);
  const percent = (time: number) => `${(time / Math.max(length, 1e-3)) * 100}%`;
  const current = effects[Math.min(selected, effects.length - 1)];
  const index = effects.indexOf(current);
  const keys = current?.keys ?? [];
  const keyIndex = Math.min(selectedKey, keys.length - 1);
  const key = keys[keyIndex];
  // Ce que règlent l'accroche et les curseurs : le point clé sélectionné, ou l'effet entier s'il n'en a pas.
  const place: { anchor: EffectAnchor; offset: [number, number, number] } | undefined = key ?? current;

  const replace = (i: number, effect: AnimationEffect) => onChange(effects.map((e, j) => (j === i ? effect : e)));

  const setPlace = (anchor: EffectAnchor, offset: [number, number, number]) => {
    if (!current) return;
    if (key) replace(index, { ...current, keys: keys.map((k, j) => (j === keyIndex ? { ...k, anchor, offset } : k)) });
    else replace(index, { ...current, anchor, offset });
  };

  const begin = (i: number, kind: "move" | "start" | "end", event: ReactPointerEvent) => {
    onSelect(i);
    const e0 = effects[i];
    dragOnTrack(event, tracks.current[i], length, (d, at) => {
      let next = e0;
      if (kind === "move") next = shiftEffect(e0, Math.max(entry.start - e0.start, Math.min(d, entry.end - e0.end)));
      else if (kind === "start") next = { ...e0, start: Math.min(e0.keys?.[0]?.time ?? e0.end - SNAP, e0.end - SNAP, e0.start + d) };
      else next = { ...e0, end: Math.max(e0.keys?.at(-1)?.time ?? e0.start + SNAP, e0.start + SNAP, e0.end + d) };
      if (next !== e0 || kind !== "move") replace(i, next);
      // Un clic (ou un glissement) sur la barre montre la pose sous le pointeur.
      onScrub(kind === "end" ? next.end : kind === "start" ? next.start : at);
    });
  };

  // Point clé déplacé dans le temps, sans dépasser ses voisins ni sortir de l'effet.
  const beginKey = (i: number, k: number, event: ReactPointerEvent) => {
    onSelect(i);
    setSelectedKey(k);
    const e0 = effects[i];
    const list = e0.keys ?? [];
    const k0 = list[k];
    const min = k > 0 ? list[k - 1].time + SNAP : e0.start;
    const max = k < list.length - 1 ? list[k + 1].time - SNAP : e0.end;
    dragOnTrack(event, tracks.current[i], length, (d) => {
      const time = Math.min(max, Math.max(min, k0.time + d));
      replace(i, { ...e0, keys: list.map((kk, j) => (j === k ? { ...kk, time } : kk)) });
      onScrub(time);
    });
  };

  const add = () => {
    const end = castTime > 0 ? releaseTime(entry, castTime) : entry.end;
    onChange([...effects, { recipe: "fireCharge", start: entry.start, end, anchor: "hands", offset: [0, 0, 0] }]);
    onSelect(effects.length);
    setSelectedKey(0);
  };

  // Nouveau point clé à l'instant montré, avec l'accroche et le décalage du point clé le plus proche (ou de l'effet).
  const addKey = () => {
    if (!current) return;
    const time = Math.min(current.end, Math.max(current.start, cursor));
    const existing = keys.findIndex((k) => Math.abs(k.time - time) < SNAP / 2);
    if (existing >= 0) {
      setSelectedKey(existing);
      return;
    }
    const nearest = keys.reduce<EffectKey | null>((best, k) => (!best || Math.abs(k.time - time) < Math.abs(best.time - time) ? k : best), null);
    const source = nearest ?? current;
    const created: EffectKey = { time, anchor: source.anchor, offset: [...source.offset] };
    const list = [...keys, created].sort((a, b) => a.time - b.time);
    replace(index, { ...current, keys: list });
    setSelectedKey(list.indexOf(created));
  };

  // Sans son dernier point clé, l'effet garde la position de celui-ci.
  const removeKey = () => {
    if (!current || !key) return;
    const list = keys.filter((_, j) => j !== keyIndex);
    if (list.length) replace(index, { ...current, keys: list });
    else {
      const rest = { ...current, anchor: key.anchor, offset: key.offset };
      delete rest.keys;
      replace(index, rest);
    }
    setSelectedKey(Math.max(0, keyIndex - 1));
  };

  return (
    <div className="lab-effects">
      <div className="lab-effects-head">
        <strong>Effets</strong>
        <button onClick={add}>+ Ajouter un effet</button>
      </div>
      {effects.map((effect, i) => (
        <div
          key={i}
          ref={(el) => {
            tracks.current[i] = el;
          }}
          className="lab-effect-track"
          onPointerDown={(e) => dragOnTrack(e, tracks.current[i], length, (_d, at) => onScrub(at))}
        >
          <div className="lab-effect-portion" style={{ left: percent(entry.start), width: percent(entry.end - entry.start) }} />
          <div
            className={`lab-range lab-range-effect ${i === index ? "lab-range-effect-selected" : ""}`}
            style={{ left: percent(effect.start), width: percent(effect.end - effect.start) }}
            onPointerDown={(e) => begin(i, "move", e)}
          >
            <span>{EFFECT_RECIPES[effect.recipe]?.label ?? effect.recipe}</span>
            <div className="lab-handle lab-handle-left" onPointerDown={(e) => begin(i, "start", e)} title="Début de l'effet" />
            <div className="lab-handle lab-handle-right" onPointerDown={(e) => begin(i, "end", e)} title="Fin de l'effet" />
          </div>
          {(effect.keys ?? []).map((k, j) => (
            <div
              key={j}
              className={`lab-key ${i === index && j === keyIndex ? "lab-key-selected" : ""}`}
              style={{ left: percent(k.time) }}
              onPointerDown={(e) => beginKey(i, j, e)}
              title={`Point clé à ${seconds(k.time)} : ${EFFECT_ANCHORS[k.anchor]}`}
            />
          ))}
        </div>
      ))}
      {current && place && (
        <div className="lab-controls lab-effect-controls">
          <label>
            Effet
            <select value={current.recipe} onChange={(e) => replace(index, { ...current, recipe: e.target.value })}>
              {Object.entries(EFFECT_RECIPES).map(([id, { label }]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={addKey} disabled={playing} title="Ajoute un point clé à l'instant montré (mettre la lecture en pause)">
            + Point clé ici
          </button>
          <span className="lab-key-label">
            {key ? `Point clé ${keyIndex + 1}/${keys.length} à ${seconds(key.time)}` : "Position de tout l'effet"}
          </span>
          <label>
            Accroché
            <select value={place.anchor} onChange={(e) => setPlace(e.target.value as EffectAnchor, place.offset)}>
              {Object.entries(EFFECT_ANCHORS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {OFFSETS.map(({ label, min, max }, axis) => (
            <label key={axis} className="lab-offset" title="Double-clic : remettre à zéro">
              {label} {place.offset[axis].toFixed(2).replace(".", ",")} m
              <input
                type="range"
                min={min}
                max={max}
                step={0.01}
                value={place.offset[axis]}
                onChange={(e) => {
                  const offset = [...place.offset] as [number, number, number];
                  offset[axis] = Number(e.target.value);
                  setPlace(place.anchor, offset);
                }}
                onDoubleClick={() => {
                  const offset = [...place.offset] as [number, number, number];
                  offset[axis] = 0;
                  setPlace(place.anchor, offset);
                }}
              />
            </label>
          ))}
          <span className="lab-hint">
            {seconds(current.start)} → {seconds(current.end)}
          </span>
          {key && <button onClick={removeKey}>Supprimer le point clé</button>}
          <button onClick={() => onChange(effects.filter((_, j) => j !== index))}>Supprimer l'effet</button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AnimationLab />
  </StrictMode>,
);
