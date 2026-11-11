import { BUILTIN_MARKS, PATTERNS, type GroundMarkDef, type GroundPattern } from "./game/groundMarks";
import { Slider, type EffectStatus } from "./particleLab";

// Onglet « Marques au sol » de animation-lab.html : liste des marques et réglages de la marque choisie.

export function MarkList(props: {
  ids: string[];
  defs: Record<string, GroundMarkDef>;
  selected: string;
  status: (id: string) => EffectStatus;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { ids, defs, selected, status, onSelect, onNew } = props;
  return (
    <div className="lab-abilities">
      <button className="lab-ability lab-new" onClick={onNew}>
        <span>+ Nouvelle marque</span>
      </button>
      {ids.map((id) => {
        const state = status(id);
        return (
          <button key={id} className={`lab-ability ${id === selected ? "lab-ability-selected" : ""}`} onClick={() => onSelect(id)}>
            <span>{defs[id]?.label ?? BUILTIN_MARKS[id]?.label ?? id}</span>
            <small>
              {state === "code" && "marque de départ"}
              {state === "saved" && (id in BUILTIN_MARKS ? "marque de départ · modifiée" : "créée")}
              {state === "draft" && "modifications non enregistrées"}
              {state === "new" && "nouvelle, pas encore enregistrée"}
            </small>
          </button>
        );
      })}
    </div>
  );
}

// Dessins qui ont un nombre d'éléments, et ceux tirés au hasard (graine).
const COUNTED: GroundPattern[] = ["runes", "rays", "cracks", "crenels"];
const SEEDED: GroundPattern[] = ["runes", "cracks"];

export function MarkEditor(props: {
  id: string;
  def: GroundMarkDef;
  onChange: (def: GroundMarkDef) => void;
  canRevert: boolean;
  onRevert: () => void;
  canBackToStart: boolean;
  onBackToStart: () => void;
  onDuplicate: () => void;
  canDelete: boolean;
  onDelete: () => void;
  usedBy: string[];
}) {
  const { id, def, onChange } = props;
  const set = <K extends keyof GroundMarkDef>(key: K, value: GroundMarkDef[K]) => onChange({ ...def, [key]: value });
  return (
    <div className="fx-editor">
      <div className="fx-group">
        <label className="fx-field">
          <span>Nom</span>
          <input type="text" value={def.label} onChange={(e) => set("label", e.target.value)} />
        </label>
        <small className="lab-hint">Identifiant : {id} · aperçu sous le personnage, rejoué en boucle</small>
      </div>

      <div className="fx-group">
        <h4>Dessin</h4>
        <div className="fx-row">
          <label className="fx-field">
            <span>Forme</span>
            <select value={def.pattern} onChange={(e) => set("pattern", e.target.value as GroundPattern)}>
              {Object.entries(PATTERNS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="fx-field">
            <span>Couleur</span>
            <input type="color" value={def.color} onChange={(e) => set("color", e.target.value)} />
          </label>
          <label className="fx-check">
            <input type="checkbox" checked={def.glow} onChange={(e) => set("glow", e.target.checked)} />
            Lumineux
          </label>
        </div>
        <Slider label="Opacité" value={def.alpha} min={0.05} max={1} step={0.01} onChange={(v) => set("alpha", v)} />
        <Slider label="Rayon" value={def.radius} min={0.2} max={15} step={0.1} unit=" m" onChange={(v) => set("radius", v)} />
        <Slider
          label={def.pattern === "disc" ? "Début du bord flou (part du rayon)" : "Rayon intérieur (part du rayon)"}
          value={def.inner}
          min={0}
          max={0.98}
          step={0.01}
          onChange={(v) => set("inner", v)}
        />
        {COUNTED.includes(def.pattern) && (
          <Slider label="Nombre" value={def.count} min={1} max={def.pattern === "crenels" ? 80 : 40} step={1} onChange={(v) => set("count", v)} />
        )}
        {def.pattern !== "disc" && (
          <Slider label="Épaisseur des traits (part du rayon)" value={def.thickness} min={0.005} max={0.2} step={0.005} onChange={(v) => set("thickness", v)} />
        )}
        {SEEDED.includes(def.pattern) && (
          <div className="fx-row">
            <span className="lab-hint">Tirage n° {def.seed}</span>
            <button onClick={() => set("seed", def.seed + 1)}>Autre tirage</button>
          </div>
        )}
      </div>

      <div className="fx-group">
        <h4>Apparition et disparition</h4>
        <Slider label="Durée de l'apparition" value={def.appear} min={0} max={3} step={0.05} unit=" s" onChange={(v) => set("appear", v)} />
        <Slider label="Taille au début (part de la taille)" value={def.appearScale} min={0} max={1} step={0.05} onChange={(v) => set("appearScale", v)} />
        <Slider label="Fondu d'entrée" value={def.fadeIn} min={0} max={3} step={0.05} unit=" s" onChange={(v) => set("fadeIn", v)} />
        <Slider label="Fondu de sortie" value={def.fadeOut} min={0} max={5} step={0.05} unit=" s" onChange={(v) => set("fadeOut", v)} />
        <Slider label="S'efface après (0 : à la fin de l'effet)" value={def.duration} min={0} max={30} step={0.1} unit=" s" onChange={(v) => set("duration", v)} />
      </div>

      <div className="fx-group">
        <h4>Mouvement</h4>
        <Slider label="Rotation (négative : sens inverse)" value={def.spin} min={-3} max={3} step={0.05} unit=" rad/s" onChange={(v) => set("spin", v)} />
        <Slider label="Pulsation" value={def.pulse} min={0} max={1} step={0.05} onChange={(v) => set("pulse", v)} />
        {def.pulse > 0 && (
          <Slider label="Battements par seconde" value={def.pulseSpeed} min={0.1} max={5} step={0.1} onChange={(v) => set("pulseSpeed", v)} />
        )}
      </div>

      <div className="fx-actions">
        <button onClick={props.onDuplicate}>Dupliquer</button>
        <button disabled={!props.canRevert} onClick={props.onRevert}>
          Annuler les modifications
        </button>
        {props.canBackToStart && <button onClick={props.onBackToStart}>Revenir à la version de départ</button>}
        {props.canDelete && (
          <button
            disabled={props.usedBy.length > 0}
            onClick={props.onDelete}
            title={props.usedBy.length ? "Retirez d'abord la marque des compétences qui l'utilisent" : undefined}
          >
            Supprimer la marque
          </button>
        )}
      </div>
      {props.usedBy.length > 0 && <small className="lab-hint">Utilisé par : {props.usedBy.join(" · ")}</small>}
    </div>
  );
}
