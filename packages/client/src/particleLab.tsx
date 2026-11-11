import { useState } from "react";
import type { EffectAnchor } from "./game/abilityAnimations";
import { EFFECT_ANCHORS } from "./game/abilityEffects";
import { BUILTIN_DEFS, DEFAULT_DEF, type ParticleEffectDef } from "./game/particleDefs";
import type { ParticleTexture } from "./game/particles";
import type { GroundMarkDef } from "./game/groundMarks";
import type { ObjectDef } from "./game/objects3d";
import type { OverlayDef } from "./game/overlays2d";

// Onglet « Effets à particules » de animation-lab.html : liste des effets, réglages de l'effet choisi, demandes de
// nouveaux effets adressées à Claude (particle-requests.json, traitées dans Claude Code).

export interface ParticleRequest {
  id: string;
  date: string;
  // Type d'élément demandé (pour l'instant, les effets à particules).
  kind?: "particules" | "sol" | "objet" | "2d";
  prompt: string;
  // Variante d'un effet existant : l'effet sélectionné (point de départ), ses réglages et son accroche. Absents,
  // la demande porte sur un effet entièrement nouveau.
  effect?: string;
  def?: ParticleEffectDef | GroundMarkDef | ObjectDef | OverlayDef;
  anchor?: EffectAnchor;
  status: "en attente" | "fait";
  // Nom de l'effet créé, et mot de Claude.
  result?: string;
  note?: string;
}

const TEXTURES: Record<ParticleTexture, string> = {
  glow: "Lueur",
  spark: "Étincelle",
  note: "Note de musique",
  smoke: "Fumée",
  star: "Étoile",
  flake: "Flocon",
  ring: "Anneau",
  feather: "Plume",
  heart: "Cœur",
  moon: "Lune",
  cross: "Croix de santé",
};

const DIRECTIONS: Record<ParticleEffectDef["direction"], string> = {
  up: "Vers le haut",
  down: "Vers le bas",
  outward: "Depuis le centre",
  inward: "Vers le centre",
  random: "Au hasard",
};

export type EffectStatus = "code" | "saved" | "draft" | "new";

export function EffectList(props: {
  ids: string[];
  defs: Record<string, ParticleEffectDef>;
  selected: string;
  status: (id: string) => EffectStatus;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { ids, defs, selected, status, onSelect, onNew } = props;
  return (
    <div className="lab-abilities">
      <button className="lab-ability lab-new" onClick={onNew}>
        <span>+ Nouvel effet</span>
      </button>
      {ids.map((id) => {
        const state = status(id);
        return (
          <button key={id} className={`lab-ability ${id === selected ? "lab-ability-selected" : ""}`} onClick={() => onSelect(id)}>
            <span>{defs[id]?.label ?? BUILTIN_DEFS[id]?.label ?? id}</span>
            <small>
              {state === "code" && "effet du jeu"}
              {state === "saved" && (id in BUILTIN_DEFS ? "effet du jeu · modifié" : "créé")}
              {state === "draft" && "modifications non enregistrées"}
              {state === "new" && "nouveau, pas encore enregistré"}
            </small>
          </button>
        );
      })}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const { label, value, min, max, step, unit = "", onChange } = props;
  return (
    <label className="fx-field">
      <span>
        {label}{" "}
        <b>
          {format(value, step)}
          {unit}
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

// Deux curseurs (minimum, maximum), qui ne se croisent pas.
function Range(props: {
  label: string;
  value: [number, number];
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: [number, number]) => void;
}) {
  const { label, value, min, max, step, unit = "", onChange } = props;
  return (
    <label className="fx-field">
      <span>
        {label}{" "}
        <b>
          {format(value[0], step)} à {format(value[1], step)}
          {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[0]}
        onChange={(e) => onChange([Number(e.target.value), Math.max(value[1], Number(e.target.value))])}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[1]}
        onChange={(e) => onChange([Math.min(value[0], Number(e.target.value)), Number(e.target.value)])}
      />
    </label>
  );
}

function format(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals).replace(".", ",");
}

export function EffectEditor(props: {
  id: string;
  def: ParticleEffectDef;
  onChange: (def: ParticleEffectDef) => void;
  anchor: EffectAnchor;
  onAnchor: (anchor: EffectAnchor) => void;
  compare: boolean;
  onCompare: (compare: boolean) => void;
  canCompare: boolean;
  canRevert: boolean;
  onRevert: () => void;
  canBackToCode: boolean;
  onBackToCode: () => void;
  onDuplicate: () => void;
  canDelete: boolean;
  onDelete: () => void;
  // Compétences qui utilisent l'effet (il ne peut pas être supprimé tant qu'il y en a).
  usedBy: string[];
}) {
  const { id, def, onChange, anchor, onAnchor, compare, onCompare, canCompare } = props;
  const set = <K extends keyof ParticleEffectDef>(key: K, value: ParticleEffectDef[K]) => onChange({ ...def, [key]: value });
  const cylinder = def.shape === "cylinder";
  return (
    <div className="fx-editor">
      <div className="fx-group">
        <label className="fx-field">
          <span>Nom</span>
          <input type="text" value={def.label} onChange={(e) => set("label", e.target.value)} />
        </label>
        <small className="lab-hint">Identifiant : {id}</small>
        <div className="fx-row">
          <label className="fx-field">
            <span>Aperçu accroché</span>
            <select value={anchor} onChange={(e) => onAnchor(e.target.value as EffectAnchor)}>
              {Object.entries(EFFECT_ANCHORS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {canCompare && (
            <label className="fx-check">
              <input type="checkbox" checked={compare} onChange={(e) => onCompare(e.target.checked)} />
              Comparer avec la version du code
            </label>
          )}
        </div>
      </div>

      <div className="fx-group">
        <h4>Rendu</h4>
        <div className="fx-row">
          <label className="fx-field">
            <span>Image</span>
            <select value={def.texture} onChange={(e) => set("texture", e.target.value as ParticleTexture)}>
              {Object.entries(TEXTURES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="fx-field">
            <span>Mélange</span>
            <select value={def.blend} onChange={(e) => set("blend", e.target.value as ParticleEffectDef["blend"])}>
              <option value="add">Lumineux (brille)</option>
              <option value="normal">Opaque (fumée, notes)</option>
            </select>
          </label>
        </div>
        <ColorStops def={def} onChange={(colors) => set("colors", colors)} />
      </div>

      <div className="fx-group">
        <h4>Émission</h4>
        <label className="fx-field">
          <span>Mode</span>
          <select value={def.emission} onChange={(e) => set("emission", e.target.value as ParticleEffectDef["emission"])}>
            <option value="continuous">Continue</option>
            <option value="burst">Une seule gerbe</option>
          </select>
        </label>
        {def.emission === "continuous" ? (
          <>
            <Slider label="Débit" value={def.rate} min={1} max={600} step={1} unit=" /s" onChange={(v) => set("rate", v)} />
            <Slider
              label="Arrêt après (0 : tant que l'effet dure)"
              value={def.duration}
              min={0}
              max={5}
              step={0.05}
              unit=" s"
              onChange={(v) => set("duration", v)}
            />
            {def.duration === 0 && (
              <small className="lab-hint">
                Sur une compétence, l'effet s'arrête à la fin de sa barre. Lancé une seule fois par le jeu (impact, soin, buff), il s'arrête
                après 1 s.
              </small>
            )}
          </>
        ) : (
          <Slider label="Nombre de particules" value={def.count} min={1} max={300} step={1} onChange={(v) => set("count", v)} />
        )}
      </div>

      <div className="fx-group">
        <h4>Forme</h4>
        <label className="fx-field">
          <span>Naissance</span>
          <select value={def.shape} onChange={(e) => set("shape", e.target.value as ParticleEffectDef["shape"])}>
            <option value="sphere">Dans une boule</option>
            <option value="cylinder">Dans un cylindre vertical (anneau, colonne)</option>
            <option value="fingers">Doigts qui se referment (main)</option>
            <option value="wave">Vague qui part du centre et s'étend à l'horizontale</option>
          </select>
        </label>
        {def.shape === "wave" && (
          <>
            <Slider
              label="Portée de la vague (atteinte en fin de vie)"
              value={def.radius}
              min={0.2}
              max={15}
              step={0.1}
              unit=" m"
              onChange={(v) => set("radius", v)}
            />
            <Slider label="Hauteur" value={def.y} min={-1} max={6} step={0.05} unit=" m" onChange={(v) => set("y", v)} />
            <small className="lab-hint">Sur une zone, « À la taille de la zone » lui donne le rayon de la zone.</small>
          </>
        )}
        {(def.shape === "sphere" || def.shape === "cylinder") && (
          <label className="fx-check" title="Pour un projectile rapide : sans ça, il laisse un chapelet de boules">
            <input type="checkbox" checked={def.trail} onChange={(e) => set("trail", e.target.checked)} />
            Traînée (les particules naissent tout le long du chemin parcouru)
          </label>
        )}
        {def.shape === "fingers" && (
          <>
            <Slider label="Nombre de doigts" value={def.arms || 5} min={1} max={8} step={1} onChange={(v) => set("arms", v)} />
            <Slider
              label="Rayon (pied des doigts)"
              value={def.radius}
              min={0.1}
              max={3}
              step={0.01}
              unit=" m"
              onChange={(v) => set("radius", v)}
            />
            <Slider
              label="Longueur des doigts"
              value={def.height}
              min={0.2}
              max={6}
              step={0.05}
              unit=" m"
              onChange={(v) => set("height", v)}
            />
            <Slider label="Hauteur de départ" value={def.y} min={-1} max={6} step={0.05} unit=" m" onChange={(v) => set("y", v)} />
            <Slider
              label="Durée de fermeture"
              value={def.closeTime}
              min={0.05}
              max={4}
              step={0.05}
              unit=" s"
              onChange={(v) => set("closeTime", v)}
            />
            <Slider
              label="Fermeture finale (1 : les bouts se rejoignent)"
              value={def.closeAmount}
              min={0}
              max={1.3}
              step={0.05}
              onChange={(v) => set("closeAmount", v)}
            />
            <Slider
              label="Épaisseur des doigts"
              value={def.fingerWidth}
              min={0}
              max={0.5}
              step={0.01}
              unit=" m"
              onChange={(v) => set("fingerWidth", v)}
            />
            <Slider
              label="Rotation de la main"
              value={def.spin}
              min={-6}
              max={6}
              step={0.1}
              unit=" rad/s"
              onChange={(v) => set("spin", v)}
            />
          </>
        )}
        {def.shape !== "fingers" && def.shape !== "wave" && (
          <>
            <Slider
              label="Rayon"
              value={def.radius}
              min={0}
              max={15}
              step={0.01}
              unit=" m"
              onChange={(v) => onChange({ ...def, radius: v, innerRadius: Math.min(def.innerRadius, v) })}
            />
            <Slider
              label="Rayon intérieur (vide au centre)"
              value={def.innerRadius}
              min={0}
              max={def.radius}
              step={0.01}
              unit=" m"
              onChange={(v) => set("innerRadius", v)}
            />
            <Slider label="Hauteur de départ" value={def.y} min={-1} max={6} step={0.05} unit=" m" onChange={(v) => set("y", v)} />
            {cylinder && (
              <>
                <Slider
                  label="Hauteur du cylindre"
                  value={def.height}
                  min={0}
                  max={4}
                  step={0.05}
                  unit=" m"
                  onChange={(v) => set("height", v)}
                />
                <Slider
                  label="Points tournants (0 : tout le tour)"
                  value={def.arms}
                  min={0}
                  max={8}
                  step={1}
                  onChange={(v) => set("arms", v)}
                />
                {def.arms > 0 && (
                  <Slider
                    label="Vitesse de rotation"
                    value={def.spin}
                    min={-20}
                    max={20}
                    step={0.5}
                    unit=" rad/s"
                    onChange={(v) => set("spin", v)}
                  />
                )}
              </>
            )}
            <Slider label="Part au centre (cœur)" value={def.core} min={0} max={1} step={0.05} onChange={(v) => set("core", v)} />
          </>
        )}
      </div>

      <div className="fx-group">
        <h4>Mouvement</h4>
        <label className="fx-field">
          <span>Direction</span>
          <select value={def.direction} onChange={(e) => set("direction", e.target.value as ParticleEffectDef["direction"])}>
            {Object.entries(DIRECTIONS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Slider label="Écart au hasard" value={def.spread} min={0} max={1} step={0.05} onChange={(v) => set("spread", v)} />
        <Range label="Vitesse" value={def.speed} min={0} max={10} step={0.05} unit=" m/s" onChange={(v) => set("speed", v)} />
        <Slider
          label="Gravité (+ monte, − tombe)"
          value={def.gravity}
          min={-10}
          max={10}
          step={0.1}
          unit=" m/s²"
          onChange={(v) => set("gravity", v)}
        />
        <Range
          label="Rotation des particules"
          value={def.rotation}
          min={-10}
          max={10}
          step={0.1}
          unit=" rad/s"
          onChange={(v) => set("rotation", v)}
        />
      </div>

      <div className="fx-group">
        <h4>Vie et taille</h4>
        <Range label="Durée de vie" value={def.life} min={0.02} max={4} step={0.01} unit=" s" onChange={(v) => set("life", v)} />
        <Range label="Taille" value={def.size} min={0.01} max={2} step={0.01} unit=" m" onChange={(v) => set("size", v)} />
        <Slider
          label="Taille en fin de vie (× la taille de départ)"
          value={def.growth}
          min={0}
          max={4}
          step={0.05}
          onChange={(v) => set("growth", v)}
        />
        <label className="fx-check">
          <input type="checkbox" checked={def.optional} onChange={(e) => set("optional", e.target.checked)} />
          Secondaire (sacrifié quand trop d'effets sont à l'écran)
        </label>
      </div>

      <div className="fx-actions">
        <button onClick={props.onDuplicate}>Dupliquer</button>
        <button disabled={!props.canRevert} onClick={props.onRevert}>
          Annuler les modifications
        </button>
        {props.canBackToCode && <button onClick={props.onBackToCode}>Revenir à la version du code</button>}
        {props.canDelete && (
          <button
            disabled={props.usedBy.length > 0}
            onClick={props.onDelete}
            title={props.usedBy.length ? "Retirez d'abord l'effet des compétences qui l'utilisent" : undefined}
          >
            Supprimer l'effet
          </button>
        )}
      </div>
      {props.usedBy.length > 0 && <small className="lab-hint">Utilisé par : {props.usedBy.join(" · ")}</small>}
    </div>
  );
}

// Dégradé de couleur : 2 à 4 étapes, chacune avec sa position dans la vie, sa couleur et sa transparence.
function ColorStops(props: { def: ParticleEffectDef; onChange: (colors: ParticleEffectDef["colors"]) => void }) {
  const { def, onChange } = props;
  const colors = def.colors;
  const replace = (i: number, stop: ParticleEffectDef["colors"][number]) => onChange(colors.map((c, j) => (j === i ? stop : c)));
  const preview = `linear-gradient(to right, ${[...colors]
    .sort((a, b) => a.at - b.at)
    .map(
      (c) =>
        `${c.color}${Math.round(c.alpha * 255)
          .toString(16)
          .padStart(2, "0")} ${c.at * 100}%`,
    )
    .join(", ")})`;
  return (
    <div className="fx-colors">
      <span>Couleur au fil de la vie (naissance → mort)</span>
      <div className="fx-gradient" style={{ background: preview }} />
      {colors.map((stop, i) => (
        <div key={i} className="fx-stop">
          <input type="color" value={stop.color} onChange={(e) => replace(i, { ...stop, color: e.target.value })} />
          <label>
            à {Math.round(stop.at * 100)} %
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={stop.at}
              onChange={(e) => replace(i, { ...stop, at: Number(e.target.value) })}
            />
          </label>
          <label>
            opacité {Math.round(stop.alpha * 100)} %
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={stop.alpha}
              onChange={(e) => replace(i, { ...stop, alpha: Number(e.target.value) })}
            />
          </label>
          {colors.length > 2 && (
            <button title="Retirer cette couleur" onClick={() => onChange(colors.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {colors.length < 4 && (
        <button
          onClick={() =>
            onChange([...colors, { at: 0.5, color: colors.at(-1)?.color ?? "#ffffff", alpha: 0.5 }].sort((a, b) => a.at - b.at))
          }
        >
          + Couleur
        </button>
      )}
    </div>
  );
}

// Demandes d'effets à Claude : envoyées dans particle-requests.json, traitées quand on le lui dit dans le chat.
// Demande d'un nouvel effet à Claude, en haut de l'onglet : indépendante de l'effet réglé, sauf pour en demander une
// variante.
export function RequestsPanel(props: {
  requests: ParticleRequest[];
  selectedLabel: string;
  onSend: (prompt: string, variant: boolean) => void;
  // Ce qui est demandé : un effet à particules (par défaut), une marque au sol ou un objet 3D.
  kind?: "particules" | "sol" | "objet" | "2d";
}) {
  const [prompt, setPrompt] = useState("");
  const [variant, setVariant] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { selectedLabel, onSend, kind = "particules" } = props;
  const requests = props.requests.filter((request) => (request.kind ?? "particules") === kind);
  const words =
    kind === "sol"
      ? { title: "Demander une nouvelle marque au sol à Claude", example: "Ex. : un pentacle rouge qui s'allume trait par trait", selected: "la marque sélectionnée", created: "une nouvelle marque" }
      : kind === "2d"
        ? { title: "Demander un nouvel affichage 2D à Claude", example: "Ex. : des petits éclairs jaunes qui tournent au-dessus de la tête", selected: "l'affichage sélectionné", created: "un nouvel affichage" }
        : kind === "objet"
        ? { title: "Demander un nouvel objet 3D à Claude", example: "Ex. : trois épées de lumière qui tournent autour du personnage", selected: "l'objet sélectionné", created: "un nouvel objet" }
        : { title: "Demander un nouvel effet à Claude", example: "Ex. : des plumes dorées qui tombent en tournoyant autour du personnage", selected: "l'effet sélectionné", created: "un nouvel effet" };
  const listed = [...requests].reverse();
  const shown = showAll ? listed : listed.slice(0, 3);
  return (
    <div className="fx-requests">
      <h4>{words.title}</h4>
      <textarea
        placeholder={words.example}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
      />
      <label className="fx-check" title="Joint l'élément sélectionné à la demande, comme point de départ">
        <input type="checkbox" checked={variant} onChange={(e) => setVariant(e.target.checked)} />
        Partir de {words.selected} (« {selectedLabel} »)
      </label>
      <button
        disabled={!prompt.trim()}
        onClick={() => {
          onSend(prompt.trim(), variant);
          setPrompt("");
          setVariant(false);
        }}
      >
        Envoyer la demande
      </button>
      <small className="lab-hint">
        Claude crée {words.created} dans la liste, à régler ensuite. Dites-lui dans le chat : « regarde les demandes de l'atelier ».
      </small>
      {listed.length > 0 && (
        <ul>
          {shown.map((request) => (
            <li key={request.id} className={request.status === "fait" ? "fx-request-done" : ""}>
              <b>{request.status === "fait" ? "✓ Fait" : "En attente"}</b> — {request.prompt}
              {request.result && <em> → {request.result}</em>}
              {request.note && <div className="lab-hint">{request.note}</div>}
            </li>
          ))}
          {listed.length > 3 && (
            <li>
              <button className="fx-link" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Voir moins" : `Voir les ${listed.length} demandes`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function newEffectDef(): ParticleEffectDef {
  return structuredClone(DEFAULT_DEF);
}
