import { useEffect, useMemo, useRef, useState } from "react";
// Les poignées repèrent la souris par un rayon : ce module complète la scène (sinon, aucun clic ne les atteint).
import "@babylonjs/core/Culling/ray";
import { GizmoManager } from "@babylonjs/core/Gizmos/gizmoManager";
import { UtilityLayerRenderer } from "@babylonjs/core/Rendering/utilityLayerRenderer";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { CATALOG, genderOf } from "./appearanceData";
import {
  ACCESSORY_SOCKETS,
  GENDERS,
  PAIRED_SOCKETS,
  PART_SLOTS,
  RACES,
  WEAPON_SLOTS,
  accessoryKey,
  isMonster,
  monsterModel,
  weaponKey,
  type Appearance,
  type AppearanceFile,
  type Mount,
  type WeaponSlot,
} from "./game/appearance";

// Onglets « Apparence » et « Placement » de animation-lab.html (voir game/appearance.ts) : composer deux apparences
// par classe (une par camp) et placer armes et accessoires sur chaque modèle.

const CAMPS = ["Camp 1", "Camp 2"];

// Tenue de départ d'une nouvelle apparence : celle de la classe dans le jeu (scripts/build-assets.mjs).
const CLASS_OUTFITS: Record<string, string> = {
  gardien: "Male_Knight",
  lame: "Male_Ranger",
  arcaniste: "Female_Wizard",
  pretre: "Female_Noble",
  barde: "Male_Peasant",
};
// Emplacements où l'on ne porte qu'une pièce à la fois (les accessoires se cumulent).
const SINGLE_SLOTS = ["Head", "Body", "Arms", "Legs", "Feet"];
const WEAPON_PACKS = [...new Set(CATALOG.weapons.map((w) => w.pack))];

// Sans casque ni capuche : la tête du corps reste visible.
function newAppearance(classId: string): Appearance {
  const [gender, outfit] = (CLASS_OUTFITS[classId] ?? "Male_Peasant").split("_");
  const parts = SINGLE_SLOTS.filter((slot) => slot !== "Head")
    .map((slot) => CATALOG.parts.find((p) => p.gender === gender && p.outfit === outfit && p.slot === slot))
    .filter((p) => !!p)
    .map((p) => p.id);
  return { model: `Human_${gender}`, headOnly: true, parts, hair: [], weapons: [], accessories: [] };
}

function partLabel(id: string): string {
  // « Male_Knight_Body_Armor » → « Knight Armor ».
  const [, outfit, , ...rest] = id.split("_");
  return [outfit, ...rest].join(" ");
}

function weaponLabel(id: string): string {
  const weapon = CATALOG.weapons.find((w) => w.id === id);
  return weapon ? `${weapon.name.replace(/^HF_Wep_/, "").replace(/_/g, " ")} (${weapon.pack})` : id;
}

function accessoryLabel(id: string): string {
  return id.replace(/^HF_(Amr|Gear)_/, "").replace(/_01$/, "").replace(/_/g, " ");
}

// Fichiers nécessaires à une apparence, pour la liste des assets.
function appearanceAssets(appearance: Appearance): string[] {
  const assets = [
    isMonster(appearance.model)
      ? `Monstre ${appearance.model.slice("monster:".length)} (Fantasy Monsters Pack)`
      : `Corps ${appearance.model}${appearance.headOnly ? " (tête seule)" : " (entier)"} (${appearance.model.startsWith("Human") ? "Universal Base Characters" : "Fantasy Races"})`,
  ];
  if (!isMonster(appearance.model)) {
    for (const part of appearance.parts) assets.push(`Pièce ${part} (Modular Character Outfits – Fantasy)`);
    for (const hair of appearance.hair) assets.push(`Coiffure ${hair} (Universal Base Characters)`);
  }
  for (const weapon of appearance.weapons) assets.push(`Arme ${weaponLabel(weapon.item)}, ${WEAPON_SLOTS[weapon.slot].toLowerCase()}`);
  for (const id of appearance.accessories) assets.push(`Accessoire ${accessoryLabel(id)} (Hearthfold Armor & Wearables)`);
  return assets;
}

interface AbilityButtonsProps {
  abilities: { id: string; name: string }[];
  current: string;
  onPlay: (id: string) => void;
}

// Réglette de zoom : distance de la caméra au personnage (la molette de la souris la change aussi).
export interface ZoomControl {
  get: () => number;
  set: (radius: number) => void;
}

function ZoomSlider({ zoom }: { zoom: ZoomControl }) {
  const [radius, setRadius] = useState(zoom.get);
  // Suit la molette : la réglette reprend la distance réelle de la caméra.
  useEffect(() => {
    const timer = setInterval(() => setRadius(zoom.get()), 300);
    return () => clearInterval(timer);
  }, [zoom]);
  return (
    <label className="appearance-row">
      Zoom
      <input
        type="range"
        min={1.5}
        max={15}
        step={0.1}
        value={radius}
        onChange={(e) => {
          const value = Number(e.target.value);
          setRadius(value);
          zoom.set(value);
        }}
      />
      <span>{radius.toFixed(1)} m</span>
    </label>
  );
}

function AbilityButtons({ abilities, current, onPlay }: AbilityButtonsProps) {
  return (
    <>
      <h4>Compétences</h4>
      <div className="appearance-abilities">
        {abilities.map(({ id, name }) => (
          <button key={id} className={id === current ? "lab-tab-active" : ""} onClick={() => onPlay(id)}>
            {name}
          </button>
        ))}
      </div>
    </>
  );
}

export function AppearancePanel(props: {
  classId: string;
  camp: number;
  setCamp: (camp: number) => void;
  file: AppearanceFile;
  onChange: (file: AppearanceFile) => void;
  unsaved: boolean;
  onSave: () => void;
  abilities: AbilityButtonsProps;
  zoom: ZoomControl;
}) {
  const { classId, camp, file, onChange } = props;
  const variants = file.variants[classId] ?? [null, null];
  const appearance = variants[camp] ?? null;
  const update = (next: Appearance | null) => {
    const list = [...variants];
    list[camp] = next;
    onChange({ ...file, variants: { ...file.variants, [classId]: list } });
  };
  const patch = (changes: Partial<Appearance>) => appearance && update({ ...appearance, ...changes });
  const gender = appearance ? genderOf(appearance.model) : null;
  const body = appearance && !isMonster(appearance.model) ? CATALOG.bodies.find((b) => b.id === appearance.model) : null;
  const [weaponPack, setWeaponPack] = useState(WEAPON_PACKS[0]);
  const [weaponSlot, setWeaponSlot] = useState<WeaponSlot>("right");

  const setBody = (race: string, nextGender: string) => {
    if (!appearance) return;
    // Pièces de tenue reprises dans le nouveau genre quand elles existent.
    const parts = appearance.parts
      .map((id) => (gender && gender !== nextGender ? id.replace(`${gender}_`, `${nextGender}_`) : id))
      .filter((id) => CATALOG.parts.some((p) => p.id === id));
    patch({ model: `${race}_${nextGender}`, parts });
  };

  return (
    <div className="fx-side appearance-side">
      <div className="appearance-camps">
        {CAMPS.map((label, i) => (
          <button key={label} className={camp === i ? "lab-tab-active" : ""} onClick={() => props.setCamp(i)}>
            {label}
            {variants[i] ? "" : " (vide)"}
          </button>
        ))}
        <button className={props.unsaved ? "lab-save" : ""} disabled={!props.unsaved} onClick={props.onSave}>
          {props.unsaved ? "Enregistrer" : "Enregistré"}
        </button>
      </div>
      <ZoomSlider zoom={props.zoom} />
      {!appearance ? (
        <div>
          <p className="lab-note">Pas encore d'apparence pour ce camp : le personnage actuel du jeu est affiché.</p>
          <button onClick={() => update(newAppearance(classId))}>Créer une apparence</button>
          {variants[1 - camp] && <button onClick={() => update(structuredClone(variants[1 - camp]))}>Copier l'autre camp</button>}
        </div>
      ) : (
        <>
          <h4>Base</h4>
          <label className="appearance-row">
            Type
            <select
              value={isMonster(appearance.model) ? "monster" : "body"}
              onChange={(e) =>
                // Retour à une race : la tenue de départ de la classe, en gardant armes et accessoires.
                e.target.value === "monster"
                  ? patch({ model: monsterModel(CATALOG.monsters[0].id), parts: [], hair: [] })
                  : patch({ ...newAppearance(classId), weapons: appearance.weapons, accessories: appearance.accessories })
              }
            >
              <option value="body">Race (Quaternius)</option>
              <option value="monster">Monstre (tenue incluse)</option>
            </select>
          </label>
          {body ? (
            <>
              <label className="appearance-row">
                Race
                <select value={body.race} onChange={(e) => setBody(e.target.value, body.gender)}>
                  {Object.entries(RACES).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="appearance-row">
                Genre
                <select value={body.gender} onChange={(e) => setBody(body.race, e.target.value)}>
                  {Object.entries(GENDERS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="appearance-row">
                Corps
                <select value={appearance.headOnly ? "head" : "full"} onChange={(e) => patch({ headOnly: e.target.value === "head" })}>
                  <option value="head">Tête seule (la tenue couvre le reste)</option>
                  <option value="full">Corps entier</option>
                </select>
              </label>
              <h4>Tenue</h4>
              {SINGLE_SLOTS.map((slot) => {
                const options = CATALOG.parts.filter((p) => p.gender === gender && p.slot === slot);
                const current = appearance.parts.find((id) => options.some((p) => p.id === id)) ?? "";
                return (
                  <label key={slot} className="appearance-row">
                    {PART_SLOTS[slot]}
                    <select
                      value={current}
                      onChange={(e) => patch({ parts: [...appearance.parts.filter((id) => id !== current), ...(e.target.value ? [e.target.value] : [])] })}
                    >
                      <option value="">Aucune</option>
                      {options.map((p) => (
                        <option key={p.id} value={p.id}>
                          {partLabel(p.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              <div className="appearance-checks">
                <span>{PART_SLOTS.Acc}</span>
                {CATALOG.parts
                  .filter((p) => p.gender === gender && p.slot === "Acc")
                  .map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={appearance.parts.includes(p.id)}
                        onChange={(e) => patch({ parts: e.target.checked ? [...appearance.parts, p.id] : appearance.parts.filter((id) => id !== p.id) })}
                      />
                      {partLabel(p.id)}
                    </label>
                  ))}
              </div>
              <div className="appearance-checks">
                <span>Coiffure</span>
                {CATALOG.hair.map(({ id }) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={appearance.hair.includes(id)}
                      onChange={(e) => patch({ hair: e.target.checked ? [...appearance.hair, id] : appearance.hair.filter((h) => h !== id) })}
                    />
                    {id.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <label className="appearance-row">
              Monstre
              <select value={appearance.model.slice("monster:".length)} onChange={(e) => patch({ model: monsterModel(e.target.value) })}>
                {CATALOG.monsters.map(({ id }) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          )}

          <h4>Armes</h4>
          {appearance.weapons.map((weapon, i) => (
            <div key={`${weapon.item}-${i}`} className="appearance-item">
              <span>
                {weaponLabel(weapon.item)} · {WEAPON_SLOTS[weapon.slot]}
              </span>
              <button onClick={() => patch({ weapons: appearance.weapons.filter((_, j) => j !== i) })}>Retirer</button>
            </div>
          ))}
          <div className="appearance-add">
            <select value={weaponSlot} onChange={(e) => setWeaponSlot(e.target.value as WeaponSlot)}>
              {Object.entries(WEAPON_SLOTS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select value={weaponPack} onChange={(e) => setWeaponPack(e.target.value)}>
              {WEAPON_PACKS.map((pack) => (
                <option key={pack}>{pack}</option>
              ))}
            </select>
            <select
              value=""
              onChange={(e) =>
                e.target.value && patch({ weapons: [...appearance.weapons.filter((w) => w.slot !== weaponSlot), { item: e.target.value, slot: weaponSlot }] })
              }
            >
              <option value="">Ajouter une arme…</option>
              {CATALOG.weapons
                .filter((w) => w.pack === weaponPack)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {weaponLabel(w.id)}
                  </option>
                ))}
            </select>
          </div>

          <h4>Accessoires (par-dessus la tenue)</h4>
          {appearance.accessories.map((id) => (
            <div key={id} className="appearance-item">
              <span>{accessoryLabel(id)}</span>
              <button onClick={() => patch({ accessories: appearance.accessories.filter((a) => a !== id) })}>Retirer</button>
            </div>
          ))}
          <div className="appearance-add">
            <select value="" onChange={(e) => e.target.value && patch({ accessories: [...appearance.accessories, e.target.value] })}>
              <option value="">Ajouter un accessoire…</option>
              {Object.entries(ACCESSORY_SOCKETS).map(([socket, label]) => (
                <optgroup key={socket} label={label}>
                  {CATALOG.accessories
                    .filter((a) => a.socket === socket && !appearance.accessories.includes(a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {accessoryLabel(a.id)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <p className="lab-note">Placez armes et accessoires sur ce modèle dans l'onglet « Placement ».</p>

          <AbilityButtons {...props.abilities} />

          <h4>Assets nécessaires</h4>
          <ul className="appearance-assets">
            {appearanceAssets(appearance).map((asset) => (
              <li key={asset}>{asset}</li>
            ))}
          </ul>
          <button onClick={() => update(null)}>Supprimer cette apparence</button>
        </>
      )}
    </div>
  );
}

// Objet placé dans l'onglet « Placement » : le modèle, l'objet, et sa place (main, côté d'une paire).
export interface PlacementSelection {
  model: string;
  kind: "weapon" | "accessory";
  item: string;
  slot: string;
}

export const DEFAULT_PLACEMENT: PlacementSelection = { model: "Human_Male", kind: "weapon", item: CATALOG.weapons[0]?.id ?? "", slot: "right" };

// Apparence montrée pendant le placement : le modèle nu (corps entier), avec le seul objet réglé.
export function placementAppearance(selection: PlacementSelection): Appearance {
  return {
    model: selection.model,
    headOnly: false,
    parts: [],
    hair: [],
    weapons: selection.kind === "weapon" ? [{ item: selection.item, slot: selection.slot as WeaponSlot }] : [],
    accessories: selection.kind === "accessory" ? [selection.item] : [],
  };
}

export function placementKey(selection: PlacementSelection): string {
  return selection.kind === "weapon" ? weaponKey({ item: selection.item, slot: selection.slot as WeaponSlot }) : accessoryKey(selection.item, selection.slot as "r" | "l" | "c");
}

function readMount(node: TransformNode): Mount {
  const rotation = node.rotationQuaternion ? node.rotationQuaternion.toEulerAngles() : node.rotation;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {
    bone: (node.parent as TransformNode | null)?.name ?? "",
    position: [round(node.position.x), round(node.position.y), round(node.position.z)],
    rotation: [round(rotation.x), round(rotation.y), round(rotation.z)],
    scale: round(node.scaling.x),
  };
}

export function PlacementPanel(props: {
  selection: PlacementSelection;
  setSelection: (selection: PlacementSelection) => void;
  file: AppearanceFile;
  onChange: (file: AppearanceFile) => void;
  unsaved: boolean;
  onSave: () => void;
  scene: Scene | null;
  // Point d'attache de l'objet réglé, une fois le personnage chargé.
  node: TransformNode | null;
  // Recharge le personnage (après « Revenir au placement par défaut »).
  reload: () => void;
  abilities: AbilityButtonsProps;
  zoom: ZoomControl;
}) {
  const { selection, setSelection, file, onChange, node, scene } = props;
  const key = placementKey(selection);
  const saved = file.mounts[selection.model]?.[key];
  const [mode, setMode] = useState<"position" | "rotation">("position");
  const [scale, setScale] = useState(1);
  const weaponPack = CATALOG.weapons.find((w) => w.id === selection.item)?.pack ?? WEAPON_PACKS[0];

  // Lu au moment du geste (les poignées ne sont pas recréées à chaque placement gardé).
  const latest = useRef({ file, onChange, model: selection.model, key });
  latest.current = { file, onChange, model: selection.model, key };
  const store = (mount: Mount) => {
    const { file: current, onChange: change, model, key: itemKey } = latest.current;
    change({ ...current, mounts: { ...current.mounts, [model]: { ...current.mounts[model], [itemKey]: mount } } });
  };

  useEffect(() => setScale(node?.scaling.x ?? 1), [node]);

  // Poignées de la souris : déplacer ou tourner l'objet dans le repère de son os ; chaque geste est gardé.
  useEffect(() => {
    if (!scene || !node) return;
    // Couches propres à la scène du personnage : celles par défaut suivent la dernière scène créée dans la page.
    const layer = new UtilityLayerRenderer(scene);
    const depthLayer = new UtilityLayerRenderer(scene);
    depthLayer.utilityLayerScene.autoClearDepthAndStencil = false;
    const gizmos = new GizmoManager(scene, 1, layer, depthLayer);
    gizmos.usePointerToAttachGizmos = false;
    gizmos.positionGizmoEnabled = mode === "position";
    gizmos.rotationGizmoEnabled = mode === "rotation";
    gizmos.attachToNode(node);
    const position = gizmos.gizmos.positionGizmo;
    const rotation = gizmos.gizmos.rotationGizmo;
    if (position) position.updateGizmoRotationToMatchAttachedMesh = true;
    if (rotation) rotation.updateGizmoRotationToMatchAttachedMesh = true;
    const done = () => store(readMount(node));
    const observers = [position?.onDragEndObservable.add(done), rotation?.onDragEndObservable.add(done)];
    // La caméra ne tourne pas pendant qu'on tire une poignée.
    const camera = scene.activeCamera;
    const detach = () => camera?.detachControl();
    const attach = () => camera?.attachControl(true);
    const starts = [position?.onDragStartObservable.add(detach), rotation?.onDragStartObservable.add(detach)];
    const ends = [position?.onDragEndObservable.add(attach), rotation?.onDragEndObservable.add(attach)];
    // GizmoManager libère aussi les couches qu'on lui a données.
    return () => {
      for (const observer of [...observers, ...starts, ...ends]) observer?.remove();
      gizmos.dispose();
    };
    // store lit l'état courant (latest) : seuls l'objet et le mode recréent les poignées.
  }, [scene, node, mode]);

  const models = useMemo(
    () => [
      ...CATALOG.bodies.map((b) => ({ id: b.id, label: `${RACES[b.race]} ${GENDERS[b.gender].toLowerCase()}` })),
      ...CATALOG.monsters.map((m) => ({ id: monsterModel(m.id), label: `Monstre ${m.id}` })),
    ],
    [],
  );
  const accessory = selection.kind === "accessory" ? CATALOG.accessories.find((a) => a.id === selection.item) : null;
  const sides = accessory ? (PAIRED_SOCKETS.has(accessory.socket) ? { r: "Droite", l: "Gauche" } : { c: "Unique" }) : WEAPON_SLOTS;
  const placedCount = Object.keys(file.mounts[selection.model] ?? {}).length;

  return (
    <div className="fx-side appearance-side">
      <div className="appearance-camps">
        <strong>Placement</strong>
        <button className={props.unsaved ? "lab-save" : ""} disabled={!props.unsaved} onClick={props.onSave}>
          {props.unsaved ? "Enregistrer" : "Enregistré"}
        </button>
      </div>
      <ZoomSlider zoom={props.zoom} />
      <label className="appearance-row">
        Modèle
        <select value={selection.model} onChange={(e) => setSelection({ ...selection, model: e.target.value })}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <p className="lab-note">{placedCount} objet(s) déjà placé(s) sur ce modèle.</p>
      <label className="appearance-row">
        Objet
        <select
          value={selection.kind}
          onChange={(e) =>
            setSelection(
              e.target.value === "weapon"
                ? { ...selection, kind: "weapon", item: CATALOG.weapons[0].id, slot: "right" }
                : { ...selection, kind: "accessory", item: CATALOG.accessories[0].id, slot: PAIRED_SOCKETS.has(CATALOG.accessories[0].socket) ? "r" : "c" },
            )
          }
        >
          <option value="weapon">Arme</option>
          <option value="accessory">Accessoire</option>
        </select>
      </label>
      {selection.kind === "weapon" ? (
        <>
          <label className="appearance-row">
            Pack
            <select
              value={weaponPack}
              onChange={(e) => {
                const first = CATALOG.weapons.find((w) => w.pack === e.target.value);
                if (first) setSelection({ ...selection, item: first.id });
              }}
            >
              {WEAPON_PACKS.map((pack) => (
                <option key={pack}>{pack}</option>
              ))}
            </select>
          </label>
          <label className="appearance-row">
            Arme
            <select value={selection.item} onChange={(e) => setSelection({ ...selection, item: e.target.value })}>
              {CATALOG.weapons
                .filter((w) => w.pack === weaponPack)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {weaponLabel(w.id)}
                    {file.mounts[selection.model]?.[weaponKey({ item: w.id, slot: selection.slot as WeaponSlot })] ? " ✓" : ""}
                  </option>
                ))}
            </select>
          </label>
        </>
      ) : (
        <label className="appearance-row">
          Accessoire
          <select
            value={selection.item}
            onChange={(e) => {
              const next = CATALOG.accessories.find((a) => a.id === e.target.value)!;
              setSelection({ ...selection, item: next.id, slot: PAIRED_SOCKETS.has(next.socket) ? "r" : "c" });
            }}
          >
            {Object.entries(ACCESSORY_SOCKETS).map(([socket, label]) => (
              <optgroup key={socket} label={label}>
                {CATALOG.accessories
                  .filter((a) => a.socket === socket)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {accessoryLabel(a.id)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <label className="appearance-row">
        Place
        <select value={selection.slot} onChange={(e) => setSelection({ ...selection, slot: e.target.value })}>
          {Object.entries(sides).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <h4>Réglage</h4>
      {!node ? (
        <p className="lab-note">Chargement…</p>
      ) : (
        <>
          <div className="appearance-camps">
            <button className={mode === "position" ? "lab-tab-active" : ""} onClick={() => setMode("position")}>
              Déplacer
            </button>
            <button className={mode === "rotation" ? "lab-tab-active" : ""} onClick={() => setMode("rotation")}>
              Tourner
            </button>
          </div>
          <label className="appearance-row">
            Taille
            <input
              type="range"
              min={Math.log(0.001)}
              max={Math.log(5)}
              step={0.01}
              value={Math.log(Math.max(0.001, scale))}
              onChange={(e) => {
                const value = Math.exp(Number(e.target.value));
                setScale(value);
                node.scaling.setAll(value);
              }}
              onPointerUp={() => store(readMount(node))}
              onKeyUp={() => store(readMount(node))}
            />
            <span>{scale.toPrecision(3)}</span>
          </label>
          <p className="lab-note">
            Tirez les flèches (déplacer) ou les anneaux (tourner) sur l'objet. Os : {(node.parent as TransformNode | null)?.name}.{" "}
            {saved ? "Placement réglé." : "Placement par défaut (pas encore réglé)."}
          </p>
          {saved && (
            <button
              onClick={() => {
                const models = { ...file.mounts, [selection.model]: { ...file.mounts[selection.model] } };
                delete models[selection.model][key];
                onChange({ ...file, mounts: models });
                props.reload();
              }}
            >
              Revenir au placement par défaut
            </button>
          )}
        </>
      )}
      <AbilityButtons {...props.abilities} />
    </div>
  );
}
