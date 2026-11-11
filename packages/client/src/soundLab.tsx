import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MIN_PART, gameGroupsUsing, isPartOf, partName, pendingEdits, sameEdits, segmentsOf, type CatalogSound, type SoundEdits } from "./audio/soundEdits";

// Onglet « Sons » de animation-lab.html : parcourir et écouter le catalogue des sons, en retirer, et découper les
// pistes qui enchaînent plusieurs sons. Les fichiers écoutés sont ceux de public/dev-sounds
// (scripts/build-sound-catalog.mjs).

const seconds = (value: number) => `${value.toFixed(2).replace(".", ",")} s`;

// Lecteur : un seul son à la fois ; les fichiers décodés sont gardés.
class SoundPlayer {
  private context: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private source: AudioBufferSourceNode | null = null;
  onPlay: ((name: string | null, start: number, started: number) => void) | null = null;

  buffer(name: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(name);
    if (!buffer) {
      buffer = fetch(`/dev-sounds/${encodeURIComponent(name)}.m4a`)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
        .then((data) => this.ctx().decodeAudioData(data));
      // Un échec (fichier absent) n'est pas gardé : on pourra réessayer.
      buffer.catch(() => this.buffers.delete(name));
      this.buffers.set(name, buffer);
    }
    return buffer;
  }

  private token = 0;

  // Joue le fichier name, de start à end (secondes ; par défaut en entier). Un clic sur un autre son pendant le
  // chargement du premier l'emporte (seul le dernier demandé est joué).
  async play(name: string, start = 0, end?: number) {
    this.stop();
    const token = ++this.token;
    let buffer: AudioBuffer;
    try {
      buffer = await this.buffer(name);
    } catch {
      if (token === this.token) this.onPlay?.(null, 0, 0);
      return;
    }
    const ctx = this.ctx();
    await ctx.resume();
    if (token !== this.token) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0, start, end !== undefined ? Math.max(0.01, end - start) : undefined);
    source.onended = () => {
      if (this.source === source) {
        this.source = null;
        this.onPlay?.(null, 0, 0);
      }
    };
    this.source = source;
    this.onPlay?.(name, start, ctx.currentTime);
  }

  stop() {
    this.source?.stop();
    this.source = null;
    this.onPlay?.(null, 0, 0);
  }

  now(): number {
    return this.context?.currentTime ?? 0;
  }

  private ctx(): AudioContext {
    this.context ??= new AudioContext();
    return this.context;
  }
}

export const soundPlayer = new SoundPlayer();

// Liste des sons, filtrable par pack et par texte, avec ceux retirés en grisé.
export function SoundList(props: {
  sounds: CatalogSound[];
  edits: SoundEdits;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const { sounds, edits, selected, onSelect } = props;
  const [pack, setPack] = useState("");
  const [text, setText] = useState("");
  const [showRejected, setShowRejected] = useState(true);
  const packs = useMemo(() => [...new Set(sounds.map((s) => s.pack))].sort((a, b) => a.localeCompare(b)), [sounds]);
  const rejected = new Set(edits.rejected);
  const shown = sounds.filter(
    (s) =>
      (!pack || s.pack === pack) &&
      (!text || s.name.toLowerCase().includes(text.toLowerCase())) &&
      (showRejected || !rejected.has(s.name)),
  );
  return (
    <div className="lab-abilities sound-list">
      <div className="sound-filters">
        <select value={pack} onChange={(e) => setPack(e.target.value)}>
          <option value="">Tous les packs ({sounds.length})</option>
          {packs.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Chercher un son" value={text} onChange={(e) => setText(e.target.value)} />
        <label className="fx-check">
          <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
          Montrer les sons retirés
        </label>
        <small className="lab-hint">{shown.length} sons</small>
      </div>
      {shown.map((s) => {
        const cuts = edits.cuts[s.name]?.length ?? 0;
        return (
          <button
            key={s.name}
            className={`lab-ability ${s.name === selected ? "lab-ability-selected" : ""} ${rejected.has(s.name) ? "sound-rejected" : ""}`}
            onClick={() => {
              onSelect(s.name);
              void soundPlayer.play(s.name);
            }}
          >
            <span>{s.name}</span>
            <small>
              {seconds(s.duration)}
              {rejected.has(s.name) && " · retiré"}
              {s.split && " · piste découpée"}
              {s.parent && " · morceau"}
              {cuts > 0 && !s.split && ` · à découper en ${cuts + 1}`}
              {s.intact && " · intact (CC BY-ND)"}
            </small>
          </button>
        );
      })}
    </div>
  );
}

// Détection des silences : niveau sous lequel le son est jugé silencieux (dB), et durée minimale d'un silence qui
// sépare deux sons (secondes).
const DEFAULT_THRESHOLD = -42;
const DEFAULT_GAP = 0.2;
const FRAME = 0.01;

// Coupes proposées : au milieu de chaque silence assez long entre deux sons (pas au début ni à la fin).
function detectCuts(buffer: AudioBuffer, thresholdDb: number, minGap: number): number[] {
  const data = buffer.getChannelData(0);
  const frame = Math.max(1, Math.round(buffer.sampleRate * FRAME));
  const limit = 10 ** (thresholdDb / 20);
  const loud: boolean[] = [];
  for (let i = 0; i < data.length; i += frame) {
    let sum = 0;
    const end = Math.min(data.length, i + frame);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    loud.push(Math.sqrt(sum / Math.max(1, end - i)) > limit);
  }
  const cuts: number[] = [];
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  if (first < 0) return cuts;
  let silence = -1;
  for (let i = first; i <= last; i++) {
    if (!loud[i] && silence < 0) silence = i;
    if (loud[i] && silence >= 0) {
      if ((i - silence) * FRAME >= minGap) cuts.push(((silence + i) / 2) * FRAME);
      silence = -1;
    }
  }
  return cuts.map((t) => Math.round(t * 1000) / 1000);
}

// Réglages d'un son : écoute, forme d'onde avec ses coupes (clic : ajouter ; glisser : déplacer ; double-clic :
// retirer), détection automatique, morceaux à écouter ou à retirer, retrait du son entier.
export function SoundEditor(props: {
  sound: CatalogSound;
  edits: SoundEdits;
  onChange: (edits: SoundEdits) => void;
  // Ouvre un autre son (la piste d'origine d'un morceau).
  onSelect: (name: string) => void;
}) {
  const { sound, edits, onChange, onSelect } = props;
  // Un morceau déjà produit s'écoute dans sa piste d'origine (ses coupes se règlent sur celle-ci).
  const source = sound.parent ?? sound.name;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [failed, setFailed] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [gap, setGap] = useState(DEFAULT_GAP);
  const cuts = edits.cuts[source] ?? [];
  const duration = buffer?.duration ?? sound.duration;
  const segments = segmentsOf(duration, cuts);
  const rejected = new Set(edits.rejected);
  const usedBy = gameGroupsUsing(sound.file);
  const intact = !!sound.intact;
  const splitDone = !!sound.parent;

  useEffect(() => {
    setBuffer(null);
    setFailed(false);
    let alive = true;
    soundPlayer.buffer(source).then(
      (b) => alive && setBuffer(b),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [source]);

  // Forme d'onde : crête de chaque colonne de pixels.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;
    const width = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const height = (canvas.height = canvas.clientHeight * devicePixelRatio);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));
    ctx.fillStyle = "#7fb4e3";
    for (let x = 0; x < width; x++) {
      let peak = 0;
      for (let j = x * step; j < Math.min(data.length, (x + 1) * step); j++) peak = Math.max(peak, Math.abs(data[j]));
      const h = peak * height * 0.95;
      ctx.fillRect(x, (height - h) / 2, 1, Math.max(1, h));
    }
  }, [buffer]);

  // Tête de lecture pendant l'écoute.
  useEffect(() => {
    let frame = 0;
    let playing: { start: number; started: number } | null = null;
    soundPlayer.onPlay = (name, start, started) => {
      playing = name === source ? { start, started } : null;
    };
    const tick = () => {
      const head = headRef.current;
      if (head) {
        head.style.display = playing ? "block" : "none";
        if (playing) head.style.left = `${((playing.start + soundPlayer.now() - playing.started) / duration) * 100}%`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      soundPlayer.onPlay = null;
    };
  }, [source, duration]);

  // Les coupes changent : les morceaux retirés de cette piste ne correspondent plus, on les oublie. Les coupes trop
  // proches l'une de l'autre ou d'un bout sont fusionnées (pas de morceau de moins de MIN_PART).
  const setCuts = (next: number[]) => {
    const kept: number[] = [];
    for (const t of [...next].sort((a, b) => a - b).map((v) => Math.round(v * 1000) / 1000)) {
      if (t - (kept[kept.length - 1] ?? 0) >= MIN_PART && duration - t >= MIN_PART) kept.push(t);
    }
    const cutsMap = { ...edits.cuts };
    if (kept.length) cutsMap[source] = kept;
    else delete cutsMap[source];
    onChange({ cuts: cutsMap, rejected: edits.rejected.filter((name) => !isPartOf(name, source)) });
  };

  const toggleRejected = (name: string) =>
    onChange({ ...edits, rejected: rejected.has(name) ? edits.rejected.filter((n) => n !== name) : [...edits.rejected, name] });

  const timeAt = (event: { clientX: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration));
  };

  const dragCut = (index: number, event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const x0 = event.clientX;
    // Un double-clic (pour retirer la coupe) ne doit pas compter comme un glissement.
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - x0) > 3) setCuts(cuts.map((t, i) => (i === index ? timeAt(e) : t)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="sound-editor">
      <div className="sound-head">
        <div>
          <h3>{sound.name}</h3>
          <small className="lab-hint">
            {sound.pack} · {sound.file}
            {sound.parent && ` · morceau de ${sound.parent} (${seconds(sound.start ?? 0)} → ${seconds(sound.end ?? 0)})`}
          </small>
        </div>
        <div className="sound-actions">
          <button className="lab-play" onClick={() => void soundPlayer.play(source, sound.start ?? 0, sound.end)}>
            ▶ Écouter
          </button>
          <button
            disabled={usedBy.length > 0 && !rejected.has(sound.name)}
            title={usedBy.length ? `Utilisé par le jeu : ${usedBy.join(", ")}` : undefined}
            onClick={() => toggleRejected(sound.name)}
          >
            {rejected.has(sound.name) ? "Garder ce son" : "Retirer du catalogue"}
          </button>
        </div>
      </div>
      {usedBy.length > 0 && <p className="lab-hint">Utilisé par le jeu : {usedBy.join(", ")}.</p>}
      {failed && <p className="anim-error">Fichier d'écoute introuvable : lancez « node scripts/build-sound-catalog.mjs ».</p>}

      <div className="sound-wave">
        <canvas
          ref={canvasRef}
          onClick={(e) => {
            // Un clic écoute à partir de là ; avec Maj, ajoute une coupe.
            if (e.shiftKey && !intact && !splitDone) setCuts([...cuts, timeAt(e)]);
            else void soundPlayer.play(source, timeAt(e));
          }}
        />
        {!splitDone &&
          cuts.map((t, i) => (
            <div
              key={i}
              className="sound-cut"
              style={{ left: `${(t / duration) * 100}%` }}
              onPointerDown={(e) => dragCut(i, e)}
              onDoubleClick={() => setCuts(cuts.filter((_, j) => j !== i))}
              title={`Coupe à ${seconds(t)} : glisser pour déplacer, double-clic pour retirer`}
            />
          ))}
        <div ref={headRef} className="sound-head-mark" />
      </div>
      <small className="lab-hint">Clic : écouter à partir de là · Maj + clic : ajouter une coupe · glisser une coupe : la déplacer · double-clic : la retirer</small>

      {intact ? (
        <p className="lab-note">Licence CC BY-ND : ce son ne peut pas être découpé ni modifié.</p>
      ) : splitDone ? (
        <p className="lab-note">
          Ce son est un morceau d'une piste découpée.{" "}
          <button className="fx-link" onClick={() => onSelect(sound.parent!)}>
            Ouvrir la piste d'origine
          </button>{" "}
          pour revoir ses coupes ou garder un morceau retiré.
        </p>
      ) : (
        <div className="lab-controls sound-detect">
          <label className="lab-rate">
            Silence sous {threshold} dB
            <input type="range" min={-70} max={-15} step={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </label>
          <label className="lab-rate">
            Silence d'au moins {seconds(gap)}
            <input type="range" min={0.03} max={1} step={0.01} value={gap} onChange={(e) => setGap(Number(e.target.value))} />
          </label>
          <button disabled={!buffer} onClick={() => buffer && setCuts(detectCuts(buffer, threshold, gap))}>
            Proposer des coupes
          </button>
          <button disabled={!cuts.length} onClick={() => setCuts([])}>
            Ne pas découper
          </button>
        </div>
      )}

      {cuts.length > 0 && !splitDone && (
        <div className="sound-parts">
          <strong>{segments.length} morceaux</strong> (deviennent des sons à part une fois appliqués)
          {segments.map(([start, end], i) => {
            const name = partName(source, i);
            return (
              <div key={name} className={`sound-part ${rejected.has(name) ? "sound-rejected" : ""}`}>
                <button onClick={() => void soundPlayer.play(source, start, end)}>▶</button>
                <span>
                  {name} · {seconds(start)} → {seconds(end)}
                </span>
                <button onClick={() => toggleRejected(name)}>{rejected.has(name) ? "Garder" : "Retirer"}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Ce qui attend d'être appliqué au catalogue : enregistré, mais pas encore traité par le script.
export function SoundPending(props: { catalog: CatalogSound[]; saved: SoundEdits | null; draft: SoundEdits }) {
  const { catalog, saved, draft } = props;
  if (!saved) return null;
  const { rejected, cuts: split } = pendingEdits(catalog, saved);
  const unsaved = !sameEdits(saved, draft);
  return (
    <p className="lab-hint sound-pending">
      En attente : {rejected} son{rejected > 1 ? "s" : ""} à retirer, {split} piste{split > 1 ? "s" : ""} à (re)découper.
      {unsaved ? " Modifications non enregistrées." : ""} Après l'enregistrement, dites à Claude « applique les sons » : il
      met à jour le catalogue (les sons retirés vont dans assets-source/sounds-rejected).
    </p>
  );
}
