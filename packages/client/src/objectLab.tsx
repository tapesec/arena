import type { EffectAnchor } from "./game/abilityAnimations";
import { EFFECT_ANCHORS } from "./game/abilityEffects";
import { BUILTIN_OBJECTS, FORMS, type ObjectDef, type ObjectForm } from "./game/objects3d";
import { Slider, type EffectStatus } from "./particleLab";

// Onglet « Objets 3D » de animation-lab.html : liste des objets et réglages de l'objet choisi.

export function ObjectList(props: {
  ids: string[];
  defs: Record<string, ObjectDef>;
  selected: string;
  status: (id: string) => EffectStatus;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { ids, defs, selected, status, onSelect, onNew } = props;
  return (
    <div className="lab-abilities">
      <button className="lab-ability lab-new" onClick={onNew}>
        <span>+ Nouvel objet</span>
      </button>
      {ids.map((id) => {
        const state = status(id);
        return (
          <button key={id} className={`lab-ability ${id === selected ? "lab-ability-selected" : ""}`} onClick={() => onSelect(id)}>
            <span>{defs[id]?.label ?? BUILTIN_OBJECTS[id]?.label ?? id}</span>
            <small>
              {state === "code" && "objet du jeu"}
              {state === "saved" && (id in BUILTIN_OBJECTS ? "objet du jeu · modifié" : "créé")}
              {state === "draft" && "modifications non enregistrées"}
              {state === "new" && "nouveau, pas encore enregistré"}
            </small>
          </button>
        );
      })}
    </div>
  );
}

const AXES = ["x", "y", "z"] as const;

export function ObjectEditor(props: {
  id: string;
  def: ObjectDef;
  onChange: (def: ObjectDef) => void;
  anchor: EffectAnchor;
  onAnchor: (anchor: EffectAnchor) => void;
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
  const set = <K extends keyof ObjectDef>(key: K, value: ObjectDef[K]) => onChange({ ...def, [key]: value });
  const setAxis = (key: "size" | "tilt", axis: number, value: number) => {
    const next = [...def[key]] as [number, number, number];
    next[axis] = value;
    set(key, next);
  };
  const vertical = def.form === "cylinder" || def.form === "cone" || def.form === "crystal";
  return (
    <div className="fx-editor">
      <div className="fx-group">
        <label className="fx-field">
          <span>Nom</span>
          <input type="text" value={def.label} onChange={(e) => set("label", e.target.value)} />
        </label>
        <small className="lab-hint">Identifiant : {id} · aperçu rejoué en boucle</small>
        <label className="fx-field">
          <span>Aperçu accroché</span>
          <select value={props.anchor} onChange={(e) => props.onAnchor(e.target.value as EffectAnchor)}>
            {Object.entries(EFFECT_ANCHORS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="fx-group">
        <h4>Forme</h4>
        <div className="fx-row">
          <label className="fx-field">
            <span>Forme</span>
            <select value={def.form} onChange={(e) => set("form", e.target.value as ObjectForm)}>
              {Object.entries(FORMS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {(def.form === "cylinder" || def.form === "cone") && (
            <label className="fx-check">
              <input type="checkbox" checked={def.open} onChange={(e) => set("open", e.target.checked)} />
              Ouvert aux bouts
            </label>
          )}
        </div>
        {["Largeur", "Hauteur", "Profondeur"].map((label, axis) => (
          <Slider key={label} label={label} value={def.size[axis]} min={0.02} max={12} step={0.01} unit=" m" onChange={(v) => setAxis("size", axis, v)} />
        ))}
        {def.form === "torus" && <Slider label="Épaisseur (part du diamètre)" value={def.thickness} min={0.005} max={0.5} step={0.005} onChange={(v) => set("thickness", v)} />}
        {def.form === "cylinder" && <Slider label="Diamètre du haut (part du bas)" value={def.thickness} min={0} max={3} step={0.05} onChange={(v) => set("thickness", v)} />}
        {def.form === "crescent" && <Slider label="Épaisseur au milieu" value={def.thickness} min={0.02} max={0.8} step={0.01} onChange={(v) => set("thickness", v)} />}
        {vertical && <small className="lab-hint">Posé sur sa base, au point d'accroche.</small>}
        {AXES.map((axis, i) => (
          <Slider key={axis} label={`Inclinaison autour de ${axis}`} value={def.tilt[i]} min={-180} max={180} step={1} unit="°" onChange={(v) => setAxis("tilt", i, v)} />
        ))}
        <div className="fx-row">
          <label className="fx-check">
            <input type="checkbox" checked={def.billboard} onChange={(e) => set("billboard", e.target.checked)} />
            Tourné vers la caméra
          </label>
          <label className="fx-check">
            <input type="checkbox" checked={def.roll} onChange={(e) => set("roll", e.target.checked)} />
            Rotation au hasard
          </label>
        </div>
      </div>

      <div className="fx-group">
        <h4>Répétition en cercle</h4>
        <Slider label="Nombre" value={def.count} min={1} max={24} step={1} onChange={(v) => set("count", v)} />
        {def.count > 1 && (
          <>
            <Slider label="Rayon du cercle" value={def.ring} min={0} max={6} step={0.05} unit=" m" onChange={(v) => set("ring", v)} />
            <Slider label="Penchés vers l'extérieur" value={def.lean} min={-90} max={90} step={1} unit="°" onChange={(v) => set("lean", v)} />
          </>
        )}
        <Slider label="Tailles au hasard (écart)" value={def.variation} min={0} max={0.9} step={0.05} onChange={(v) => set("variation", v)} />
        {(def.variation > 0 || def.roll) && (
          <div className="fx-row">
            <span className="lab-hint">Tirage n° {def.seed}</span>
            <button onClick={() => set("seed", def.seed + 1)}>Autre tirage</button>
          </div>
        )}
      </div>

      <div className="fx-group">
        <h4>Rendu</h4>
        <div className="fx-row">
          <label className="fx-field">
            <span>Couleur</span>
            <input type="color" value={def.color} onChange={(e) => set("color", e.target.value)} />
          </label>
          <label className="fx-check">
            <input type="checkbox" checked={def.glow} onChange={(e) => set("glow", e.target.checked)} />
            Lumineux (sinon éclairé, avec reflets)
          </label>
          <label className="fx-check">
            <input type="checkbox" checked={def.additive} onChange={(e) => set("additive", e.target.checked)} />
            S'additionne à ce qui est derrière
          </label>
        </div>
        <Slider label="Opacité" value={def.alpha} min={0.02} max={1} step={0.01} onChange={(v) => set("alpha", v)} />
      </div>

      <div className="fx-group">
        <h4>Vie</h4>
        <Slider label="Durée de l'apparition" value={def.appear} min={0} max={3} step={0.05} unit=" s" onChange={(v) => set("appear", v)} />
        <Slider label="Taille au début (part de la taille)" value={def.appearScale} min={0} max={1.5} step={0.05} onChange={(v) => set("appearScale", v)} />
        <Slider
          label="Arrive de (hauteur : négative, sort du sol ; positive, descend du ciel)"
          value={def.appearRise}
          min={-3}
          max={12}
          step={0.1}
          unit=" m"
          onChange={(v) => set("appearRise", v)}
        />
        <label className="fx-check">
          <input type="checkbox" checked={def.unfoldDown} onChange={(e) => set("unfoldDown", e.target.checked)} />
          Se déploie vers le bas depuis son sommet (rayon qui descend du ciel)
        </label>
        <Slider label="Fondu d'entrée" value={def.fadeIn} min={0} max={3} step={0.05} unit=" s" onChange={(v) => set("fadeIn", v)} />
        <Slider label="Durée de vie (0 : tant que l'effet dure)" value={def.duration} min={0} max={30} step={0.05} unit=" s" onChange={(v) => set("duration", v)} />
        {def.duration > 0 && (
          <>
            <Slider label="Taille à la fin de la vie (×)" value={def.endScale} min={0} max={10} step={0.05} onChange={(v) => set("endScale", v)} />
            <Slider label="Opacité à la fin de la vie (×)" value={def.endAlpha} min={0} max={1} step={0.05} onChange={(v) => set("endAlpha", v)} />
            <Slider label="Commence à changer après (part de la vie)" value={def.lifeHold} min={0} max={0.95} step={0.05} onChange={(v) => set("lifeHold", v)} />
            <label className="fx-check">
              <input type="checkbox" checked={def.flatGrowth} onChange={(e) => set("flatGrowth", e.target.checked)} />
              Ne grandit qu'en largeur (garde sa hauteur)
            </label>
          </>
        )}
        <Slider label="Fondu de sortie" value={def.fadeOut} min={0} max={5} step={0.05} unit=" s" onChange={(v) => set("fadeOut", v)} />
      </div>

      <div className="fx-group">
        <h4>Mouvement</h4>
        <Slider label="Rotation (négative : sens inverse)" value={def.spin} min={-6} max={6} step={0.05} unit=" rad/s" onChange={(v) => set("spin", v)} />
        <Slider label="Flottement" value={def.bob} min={0} max={1} step={0.01} unit=" m" onChange={(v) => set("bob", v)} />
        {def.bob > 0 && <Slider label="Battements par seconde" value={def.bobSpeed} min={0.1} max={5} step={0.1} onChange={(v) => set("bobSpeed", v)} />}
        <Slider label="Pulsation de l'opacité" value={def.pulse} min={0} max={1} step={0.05} onChange={(v) => set("pulse", v)} />
      </div>

      <div className="fx-actions">
        <button onClick={props.onDuplicate}>Dupliquer</button>
        <button disabled={!props.canRevert} onClick={props.onRevert}>
          Annuler les modifications
        </button>
        {props.canBackToStart && <button onClick={props.onBackToStart}>Revenir à la version du jeu</button>}
        {props.canDelete && (
          <button
            disabled={props.usedBy.length > 0}
            onClick={props.onDelete}
            title={props.usedBy.length ? "Retirez d'abord l'objet des compétences qui l'utilisent" : undefined}
          >
            Supprimer l'objet
          </button>
        )}
      </div>
      {props.usedBy.length > 0 && <small className="lab-hint">Utilisé par : {props.usedBy.join(" · ")}</small>}
    </div>
  );
}
