import type { EffectAnchor } from "./game/abilityAnimations";
import { EFFECT_ANCHORS } from "./game/abilityEffects";
import { BUILTIN_OVERLAYS, LAYOUTS, type OverlayDef, type OverlayLayout } from "./game/overlays2d";
import { Slider, type EffectStatus } from "./particleLab";

// Onglet « Affichage 2D » de animation-lab.html : liste des affichages et réglages de celui choisi.

// Symboles proposés en un clic.
const SYMBOLS = ["★", "✦", "♥", "♪", "♫", "☾", "☀", "❄", "✚", "☠", "⚡", "!", "?", "Z", "💤"];

export function OverlayList(props: {
  ids: string[];
  defs: Record<string, OverlayDef>;
  selected: string;
  status: (id: string) => EffectStatus;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { ids, defs, selected, status, onSelect, onNew } = props;
  return (
    <div className="lab-abilities">
      <button className="lab-ability lab-new" onClick={onNew}>
        <span>+ Nouvel affichage</span>
      </button>
      {ids.map((id) => {
        const state = status(id);
        return (
          <button key={id} className={`lab-ability ${id === selected ? "lab-ability-selected" : ""}`} onClick={() => onSelect(id)}>
            <span>{defs[id]?.label ?? BUILTIN_OVERLAYS[id]?.label ?? id}</span>
            <small>
              {state === "code" && "affichage de départ"}
              {state === "saved" && (id in BUILTIN_OVERLAYS ? "affichage de départ · modifié" : "créé")}
              {state === "draft" && "modifications non enregistrées"}
              {state === "new" && "nouveau, pas encore enregistré"}
            </small>
          </button>
        );
      })}
    </div>
  );
}

export function OverlayEditor(props: {
  id: string;
  def: OverlayDef;
  onChange: (def: OverlayDef) => void;
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
  const set = <K extends keyof OverlayDef>(key: K, value: OverlayDef[K]) => onChange({ ...def, [key]: value });
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
        <h4>Texte</h4>
        <label className="fx-field">
          <span>Texte ou symbole{def.layout === "rise" ? " (les mots séparés par des espaces apparaissent à tour de rôle)" : ""}</span>
          <input type="text" value={def.text} onChange={(e) => set("text", e.target.value)} />
        </label>
        <div className="fx-symbols">
          {SYMBOLS.map((symbol) => (
            <button key={symbol} onClick={() => set("text", symbol)}>
              {symbol}
            </button>
          ))}
        </div>
        <div className="fx-row">
          <label className="fx-field">
            <span>Couleur</span>
            <input type="color" value={def.color} onChange={(e) => set("color", e.target.value)} />
          </label>
          <label className="fx-field">
            <span>Contour</span>
            <input type="color" value={def.outline} onChange={(e) => set("outline", e.target.value)} />
          </label>
          <label className="fx-check">
            <input type="checkbox" checked={def.bold} onChange={(e) => set("bold", e.target.checked)} />
            Gras
          </label>
          <label className="fx-check">
            <input type="checkbox" checked={def.glow} onChange={(e) => set("glow", e.target.checked)} />
            Lumineux
          </label>
        </div>
        <Slider label="Épaisseur du contour" value={def.outlineWidth} min={0} max={0.2} step={0.01} onChange={(v) => set("outlineWidth", v)} />
        <Slider label="Opacité" value={def.alpha} min={0.05} max={1} step={0.01} onChange={(v) => set("alpha", v)} />
        <label className="fx-check" title="Même taille à l'écran quelle que soit la distance, comme les « Zzz » du jeu">
          <input
            type="checkbox"
            checked={def.screen}
            // La taille change d'unité : on repart d'une valeur raisonnable.
            onChange={(e) => onChange({ ...def, screen: e.target.checked, size: e.target.checked ? 18 : 0.3 })}
          />
          Taille fixe à l'écran
        </label>
        {def.screen ? (
          <Slider label="Hauteur à l'écran" value={def.size} min={6} max={80} step={1} unit=" px" onChange={(v) => set("size", v)} />
        ) : (
          <Slider label="Hauteur" value={def.size} min={0.05} max={3} step={0.01} unit=" m" onChange={(v) => set("size", v)} />
        )}
      </div>

      <div className="fx-group">
        <h4>Disposition</h4>
        <label className="fx-field">
          <span>Disposition</span>
          <select value={def.layout} onChange={(e) => set("layout", e.target.value as OverlayLayout)}>
            {Object.entries(LAYOUTS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {def.layout === "orbit" && (
          <>
            <Slider label="Nombre" value={def.count} min={1} max={12} step={1} onChange={(v) => set("count", v)} />
            <Slider label="Rayon de la ronde" value={def.radius} min={0} max={3} step={0.05} unit=" m" onChange={(v) => set("radius", v)} />
            <Slider label="Vitesse (négative : sens inverse)" value={def.speed} min={-10} max={10} step={0.1} unit=" rad/s" onChange={(v) => set("speed", v)} />
          </>
        )}
        {def.layout === "rise" && (
          <>
            <Slider label="Un nouveau toutes les" value={def.interval} min={0.05} max={3} step={0.05} unit=" s" onChange={(v) => set("interval", v)} />
            <Slider label="Durée de vie de chacun" value={def.life} min={0.2} max={5} step={0.05} unit=" s" onChange={(v) => set("life", v)} />
            <Slider label="Monte de" value={def.rise} min={-1} max={3} step={0.05} unit=" m/s" onChange={(v) => set("rise", v)} />
            <Slider label="Ondule sur le côté" value={def.drift} min={0} max={1} step={0.01} unit=" m" onChange={(v) => set("drift", v)} />
            <Slider label="Taille à la fin de sa vie (×)" value={def.growth} min={0.1} max={4} step={0.05} onChange={(v) => set("growth", v)} />
          </>
        )}
      </div>

      <div className="fx-group">
        <h4>Vie et mouvement</h4>
        <Slider label="Durée de l'apparition" value={def.appear} min={0} max={3} step={0.05} unit=" s" onChange={(v) => set("appear", v)} />
        <Slider label="Taille au début (part de la taille)" value={def.appearScale} min={0} max={1.5} step={0.05} onChange={(v) => set("appearScale", v)} />
        <Slider label="Fondu d'entrée" value={def.fadeIn} min={0} max={3} step={0.05} unit=" s" onChange={(v) => set("fadeIn", v)} />
        <Slider label="Durée (0 : tant que l'effet dure)" value={def.duration} min={0} max={30} step={0.1} unit=" s" onChange={(v) => set("duration", v)} />
        <Slider label="Fondu de sortie" value={def.fadeOut} min={0} max={5} step={0.05} unit=" s" onChange={(v) => set("fadeOut", v)} />
        <Slider label="Flottement" value={def.bob} min={0} max={1} step={0.01} unit=" m" onChange={(v) => set("bob", v)} />
        {def.bob > 0 && <Slider label="Battements par seconde" value={def.bobSpeed} min={0.1} max={5} step={0.1} onChange={(v) => set("bobSpeed", v)} />}
        <Slider label="Pulsation" value={def.pulse} min={0} max={1} step={0.05} onChange={(v) => set("pulse", v)} />
        {def.pulse > 0 && <Slider label="Pulsations par seconde" value={def.pulseSpeed} min={0.1} max={5} step={0.1} onChange={(v) => set("pulseSpeed", v)} />}
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
            title={props.usedBy.length ? "Retirez d'abord l'affichage des compétences qui l'utilisent" : undefined}
          >
            Supprimer l'affichage
          </button>
        )}
      </div>
      {props.usedBy.length > 0 && <small className="lab-hint">Utilisé par : {props.usedBy.join(" · ")}</small>}
    </div>
  );
}
