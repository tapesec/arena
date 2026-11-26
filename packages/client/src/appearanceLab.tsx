import { useEffect, useMemo, useRef, useState } from "react";
// Les poignées repèrent la souris par un rayon : ce module complète la scène (sinon, aucun clic ne les atteint).
import "@babylonjs/core/Culling/ray";
import { GizmoManager } from "@babylonjs/core/Gizmos/gizmoManager";
import { UtilityLayerRenderer } from "@babylonjs/core/Rendering/utilityLayerRenderer";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { CATALOG, colorZones, genderOf, hairFor, outfitTexture, outfitsOf, sanitizedAppearance, type ColorZone } from "./appearanceData";
import { mainHues } from "./game/textureTint";
import {
  ACCESSORY_SOCKETS,
  GENDERS,
  PAIRED_SOCKETS,
  PART_SLOTS,
  PLAY_FRAME,
  PLAY_SLOT,
  RACES,
  WEAPON_SLOTS,
  accessoryKey,
  isFantasyRace,
  isInstrument,
  CUSTOM_MODELS,
  customModel,
  isCustom,
  isMonster,
  monsterModel,
  playKey,
  weaponKey,
  type Appearance,
  type AppearanceFile,
  type ItemColors,
  type Mount,
  type OutfitColor,
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
const BODY_RACES = [...new Set(CATALOG.bodies.map((b) => b.race))];
// Teinte proposée quand on choisit une couleur de cheveux (les coiffures des humains sont grises, faites pour être
// teintées).
const DEFAULT_HAIR_COLOR = "#5a3a22";



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
      : isCustom(appearance.model)
        ? `Modèle complet ${CUSTOM_MODELS[appearance.model.slice("custom:".length)] ?? appearance.model} (Tripo)`
      : `Corps ${appearance.model}${appearance.headOnly ? " (tête seule)" : " (entier)"} (${appearance.model.startsWith("Human") ? "Universal Base Characters" : "Fantasy Races"})`,
  ];
  if (!isMonster(appearance.model) && !isCustom(appearance.model)) {
    for (const part of appearance.parts) assets.push(`Pièce ${part} (Modular Character Outfits – Fantasy)`);
    for (const hair of appearance.hair) assets.push(`Coiffure ${hair} (Universal Base Characters)`);
    if (appearance.hairColor) assets.push(`Cheveux teints en ${appearance.hairColor}`);
    for (const [outfit, color] of Object.entries(appearance.outfitColors ?? {})) {
      if (outfitsOf(appearance).includes(outfit)) assets.push(`Tenue ${outfit} : couleur ${color.variant}${color.tint ? `, teinte ${color.tint}` : ""}`);
    }
    if (appearance.skin) assets.push(`Peau : couleur ${appearance.skin}`);
    if (appearance.raceHairColor) assets.push(`Cheveux de la race : couleur ${appearance.raceHairColor}`);
  }
  for (const weapon of appearance.weapons) {
    assets.push(`Arme ${weaponLabel(weapon.item)}, ${WEAPON_SLOTS[weapon.slot].toLowerCase()}${colorsLabel(appearance, weapon.item)}`);
  }
  for (const id of appearance.accessories) assets.push(`Accessoire ${accessoryLabel(id)} (Hearthfold Armor & Wearables)${colorsLabel(appearance, id)}`);
  return assets;
}

// Couleurs changées d'un objet, pour la liste des assets (« , couleurs : Steel #aa0000, couleur 2 #… »).
function colorsLabel(appearance: Appearance, item: string): string {
  const colors = appearance.itemColors?.[item];
  if (!colors) return "";
  const zones = colorZones(item);
  return `, couleurs : ${Object.entries(colors)
    .map(([zone, color]) => `${zoneLabel(zones, zone)} ${color}`)
    .join(", ")}`;
}

// Nom d'une zone de couleur : le matériau (sans le préfixe MI_), ou « Couleur n » (rang de la case de palette dans
// l'objet, la principale en premier).
function zoneLabel(zones: ColorZone[], zone: string): string {
  if (zone.startsWith("m:")) return zone.slice(2).replace(/^MI_/, "");
  return `Couleur ${zones.findIndex((z) => z.id === zone) + 1}`;
}

interface AbilityButtonsProps {
  abilities: { id: string; name: string }[];
  // Compétence jouée en boucle ; null : pose d'attente.
  current: string | null;
  onPlay: (id: string) => void;
  onRest: () => void;
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

function AbilityButtons({ abilities, current, onPlay, onRest }: AbilityButtonsProps) {
  return (
    <>
      <h4>Compétences</h4>
      <div className="appearance-abilities">
        <button className={current === null ? "lab-tab-active" : ""} onClick={onRest} title="Arrêter la compétence : pose d'attente">
          Idle
        </button>
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
  // Apparence nettoyée (coiffures, couleurs, armes d'un fichier modifié à la main) : c'est elle qu'on modifie.
  const stored = variants[camp] ?? null;
  const appearance = stored && sanitizedAppearance(stored);
  const update = (next: Appearance | null) => {
    const list = [...variants];
    list[camp] = next;
    onChange({ ...file, variants: { ...file.variants, [classId]: list } });
  };
  const patch = (changes: Partial<Appearance>) => appearance && update({ ...appearance, ...changes });
  // Objet dont les couleurs sont dépliées (une arme ou un accessoire à la fois).
  const [coloring, setColoring] = useState<string | null>(null);
  const colorsOf = (item: string) => appearance?.itemColors?.[item] ?? {};
  const setItemColors = (item: string, colors: ItemColors) => patch({ itemColors: { ...appearance?.itemColors, [item]: colors } });
  const colorButton = (item: string) =>
    colorZones(item).length > 0 && (
      <button className={coloring === item ? "lab-tab-active" : ""} onClick={() => setColoring(coloring === item ? null : item)} title="Changer les couleurs de l'objet">
        Couleurs{Object.keys(colorsOf(item)).length ? " •" : ""}
      </button>
    );
  const gender = appearance ? genderOf(appearance.model) : null;
  const body = appearance && !isMonster(appearance.model) && !isCustom(appearance.model) ? CATALOG.bodies.find((b) => b.id === appearance.model) : null;
  const [weaponPack, setWeaponPack] = useState(WEAPON_PACKS[0]);
  const [weaponSlot, setWeaponSlot] = useState<WeaponSlot>("right");
  // Place proposée pour la prochaine arme : la première libre (main droite, main gauche, dos).
  const usedSlots = (appearance?.weapons ?? []).map((w) => w.slot).join(",");
  useEffect(() => {
    const used = usedSlots.split(",");
    setWeaponSlot((Object.keys(WEAPON_SLOTS) as WeaponSlot[]).find((slot) => !used.includes(slot)) ?? "right");
  }, [usedSlots, classId, camp]);
  // Change une arme de place ; une arme déjà à cette place prend l'ancienne place de la première.
  const moveWeapon = (index: number, slot: WeaponSlot) => {
    if (!appearance) return;
    const from = appearance.weapons[index].slot;
    const other = appearance.weapons.findIndex((w, j) => j !== index && w.slot === slot);
    patch({ weapons: appearance.weapons.map((w, i) => (i === index ? { ...w, slot } : i === other ? { ...w, slot: from } : w)) });
  };

  const setBody = (race: string, nextGender: string) => {
    if (!appearance) return;
    // Pièces de tenue reprises dans le nouveau genre quand elles existent.
    const parts = appearance.parts
      .map((id) => (gender && gender !== nextGender ? id.replace(`${gender}_`, `${nextGender}_`) : id))
      .filter((id) => CATALOG.parts.some((p) => p.id === id));
    // Coiffures gardées si elles vont au nouveau corps : la version « Teen » pour le corps jeune, la version adulte
    // sinon, à condition d'exister dans ce genre.
    const valid = hairFor(race, nextGender);
    const hair = appearance.hair
      .map((id) => id.replace(/_Teen$/, "") + (race === "HumanTeen" ? "_Teen" : ""))
      .filter((id) => valid.some((h) => h.id === id));
    patch({ model: `${race}_${nextGender}`, parts, hair });
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
      <AbilityButtons {...props.abilities} />
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
              value={isMonster(appearance.model) ? "monster" : isCustom(appearance.model) ? "custom" : "body"}
              onChange={(e) =>
                // Retour à une race : la tenue de départ de la classe, en gardant armes et accessoires.
                e.target.value !== "body"
                  ? patch({
                      model: e.target.value === "monster" ? monsterModel(CATALOG.monsters[0].id) : customModel(Object.keys(CUSTOM_MODELS)[0]),
                      parts: [],
                      hair: [],
                      skin: undefined,
                      raceHairColor: undefined,
                      outfitColors: undefined,
                      hairColor: undefined,
                      raceHair: undefined,
                    })
                  : patch({
                      ...newAppearance(classId),
                      raceHair: undefined,
                      hairColor: undefined,
                      skin: undefined,
                      raceHairColor: undefined,
                      outfitColors: undefined,
                      weapons: appearance.weapons,
                      accessories: appearance.accessories,
                    })
              }
            >
              <option value="body">Race (Quaternius)</option>
              <option value="monster">Monstre (tenue incluse)</option>
              <option value="custom">Modèle complet (Tripo, habillé)</option>
            </select>
          </label>
          {body ? (
            <>
              <label className="appearance-row">
                Race
                <select value={body.race} onChange={(e) => setBody(e.target.value, body.gender)}>
                  {BODY_RACES.map((id) => (
                    <option key={id} value={id}>
                      {RACES[id] ?? id}
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
              <HairControls appearance={sanitizedAppearance(appearance)} race={body.race} gender={body.gender} patch={patch} />
              <ColorControls appearance={appearance} race={body.race} hasSkins={!!body.skins} patch={patch} />
            </>
          ) : isCustom(appearance.model) ? (
            <label className="appearance-row">
              Modèle
              <select value={appearance.model.slice("custom:".length)} onChange={(e) => patch({ model: customModel(e.target.value) })}>
                {Object.entries(CUSTOM_MODELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
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
            <div key={`${weapon.item}-${i}`}>
              <div className="appearance-item">
                <span>{weaponLabel(weapon.item)}</span>
                <span className="appearance-variants">
                  {colorButton(weapon.item)}
                  <select value={weapon.slot} onChange={(e) => moveWeapon(i, e.target.value as WeaponSlot)} title="Changer de place (échange avec l'arme qui y est)">
                    {Object.entries(WEAPON_SLOTS).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                        {id !== weapon.slot && appearance.weapons.some((w) => w.slot === id) ? " (échange)" : ""}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => patch({ weapons: appearance.weapons.filter((_, j) => j !== i) })}>Retirer</button>
                </span>
              </div>
              {/* Une arme tenue deux fois : ses couleurs (partagées) se règlent sous la première. */}
              {coloring === weapon.item && appearance.weapons.findIndex((w) => w.item === weapon.item) === i && (
                <ItemColorControls item={weapon.item} colors={colorsOf(weapon.item)} onChange={(colors) => setItemColors(weapon.item, colors)} />
              )}
            </div>
          ))}
          <div className="appearance-add">
            <select value={weaponSlot} onChange={(e) => setWeaponSlot(e.target.value as WeaponSlot)} title="Place de l'arme ajoutée">
              {Object.entries(WEAPON_SLOTS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                  {appearance.weapons.some((w) => w.slot === id) ? " (remplace)" : ""}
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
            <div key={id}>
              <div className="appearance-item">
                <span>{accessoryLabel(id)}</span>
                <span className="appearance-variants">
                  {colorButton(id)}
                  <button onClick={() => patch({ accessories: appearance.accessories.filter((a) => a !== id) })}>Retirer</button>
                </span>
              </div>
              {coloring === id && <ItemColorControls item={id} colors={colorsOf(id)} onChange={(colors) => setItemColors(id, colors)} />}
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
          <p className="lab-note">Placez armes et accessoires sur ce modèle dans l'onglet « Placement » (une arme se règle pour chaque place : changée de main, elle reprend le réglage de cette main).</p>

          <h4>Assets nécessaires</h4>
          <ul className="appearance-assets">
            {appearanceAssets(sanitizedAppearance(appearance)).map((asset) => (
              <li key={asset}>{asset}</li>
            ))}
          </ul>
          <button onClick={() => update(null)}>Supprimer cette apparence</button>
        </>
      )}
    </div>
  );
}

// Coupe de cheveux (une seule), barbe et moustache, et teinte. Une race du pack Fantasy Races a ses propres cheveux :
// une autre coupe les remplace, « Aucune » les retire (raceHair: false).
function HairControls({ appearance, race, gender, patch }: { appearance: Appearance; race: string; gender: string; patch: (changes: Partial<Appearance>) => void }) {
  const options = hairFor(race, gender);
  const cuts = options.filter((h) => h.kind === "cut");
  const facial = options.filter((h) => h.kind === "facial");
  const ownHair = isFantasyRace(race);
  const cut = appearance.hair.find((id) => cuts.some((h) => h.id === id)) ?? (ownHair && appearance.raceHair !== false ? "race" : "");
  const setCut = (value: string) => {
    const others = appearance.hair.filter((id) => !cuts.some((h) => h.id === id));
    patch({ hair: value && value !== "race" ? [...others, value] : others, raceHair: ownHair && value === "" ? false : undefined });
  };
  const label = (id: string) => id.replace(/^Hair_/, "").replace(/_Teen$/, "").replace(/_/g, " ");
  return (
    <>
      <h4>Cheveux</h4>
      <label className="appearance-row">
        Coupe
        <select value={cut} onChange={(e) => setCut(e.target.value)}>
          {ownHair && <option value="race">Celle de la race</option>}
          <option value="">Aucune (crâne rasé)</option>
          {cuts.map((h) => (
            <option key={h.id} value={h.id}>
              {label(h.id)}
            </option>
          ))}
        </select>
      </label>
      {facial.length > 0 && (
        <div className="appearance-checks">
          <span>Barbe et moustache</span>
          {facial.map((h) => (
            <label key={h.id}>
              <input
                type="checkbox"
                checked={appearance.hair.includes(h.id)}
                onChange={(e) => patch({ hair: e.target.checked ? [...appearance.hair, h.id] : appearance.hair.filter((id) => id !== h.id) })}
              />
              {label(h.id)}
            </label>
          ))}
        </div>
      )}
      <label className="appearance-row">
        Couleur
        {appearance.hairColor ? (
          <>
            <input type="color" value={appearance.hairColor} onChange={(e) => patch({ hairColor: e.target.value })} />
            <button onClick={() => patch({ hairColor: undefined })} title="Revenir à la texture grise d'origine">
              D'origine
            </button>
          </>
        ) : (
          <button onClick={() => patch({ hairColor: DEFAULT_HAIR_COLOR })}>Teindre</button>
        )}
      </label>
      {cut === "race" && <p className="lab-note">Les cheveux de la race gardent leurs couleurs ; la teinte vaut pour les sourcils et les poils ajoutés.</p>}
    </>
  );
}

// Noms des tenues dans l'éditeur.
const OUTFIT_NAMES: Record<string, string> = { Knight: "Chevalier", Noble: "Noble", Peasant: "Paysan", Ranger: "Rôdeur", Wizard: "Mage" };
// Couleur de pipette : elle en envoie une à chaque mouvement, on n'applique que la dernière, après une courte pause
// (chaque couleur recalcule une texture et reconstruit le personnage). L'application passe par le dernier apply reçu
// (l'apparence à jour, pas celle du moment où la pipette a bougé) ; un choix en attente est appliqué si la ligne
// disparaît, et abandonné si la valeur change d'ailleurs (retour à l'origine).
function useDelayedColor(value: string | undefined, apply: (color: string) => void): [string | undefined, (color: string) => void] {
  const [picked, setPicked] = useState(value);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const pending = useRef<string | null>(null);
  useEffect(() => {
    pending.current = null;
    setPicked(value);
  }, [value]);
  useEffect(() => {
    if (!picked || picked === value) return;
    pending.current = picked;
    const timer = setTimeout(() => {
      pending.current = null;
      applyRef.current(picked);
    }, 300);
    return () => clearTimeout(timer);
    // value change à chaque choix appliqué ; seule la couleur en cours de choix relance l'attente.
  }, [picked]);
  useEffect(
    () => () => {
      if (pending.current) applyRef.current(pending.current);
    },
    [],
  );
  return [picked, setPicked];
}

// Couleur proposée quand on active la teinte libre d'une tenue.
const DEFAULT_TINT = "#3a6fd8";

// Trois boutons pour choisir une variante de couleur du pack (1 à 3).
function VariantButtons({ value, onChange }: { value: number; onChange: (variant: number) => void }) {
  return (
    <span className="appearance-variants">
      {[1, 2, 3].map((n) => (
        <button key={n} className={value === n ? "lab-tab-active" : ""} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
    </span>
  );
}

// Couleurs : variante de chaque tenue portée (et teinte libre par-dessus), peau et cheveux d'une race.
function ColorControls({ appearance, race, hasSkins, patch }: { appearance: Appearance; race: string; hasSkins: boolean; patch: (changes: Partial<Appearance>) => void }) {
  const outfits = outfitsOf(appearance);
  const setOutfit = (outfit: string, color: OutfitColor) => patch({ outfitColors: { ...appearance.outfitColors, [outfit]: color } });
  // Toujours proposée pour une race : ses cheveux, et chez les elfes leurs cornes (même matériau).
  const raceHairShown = isFantasyRace(race);
  return (
    <>
      <h4>Couleurs</h4>
      {outfits.map((outfit) => (
        <OutfitColorRow key={outfit} outfit={outfit} color={appearance.outfitColors?.[outfit] ?? { variant: 1 }} onChange={(color) => setOutfit(outfit, color)} />
      ))}
      {hasSkins && (
        <div className="appearance-row">
          <span>Peau</span>
          <VariantButtons value={appearance.skin ?? 1} onChange={(skin) => patch({ skin })} />
        </div>
      )}
      {raceHairShown && (
        <div className="appearance-row">
          <span>Cheveux de la race</span>
          <VariantButtons value={appearance.raceHairColor ?? 1} onChange={(raceHairColor) => patch({ raceHairColor })} />
        </div>
      )}
      {outfits.length > 0 && <p className="lab-note">Une couleur de tenue vaut pour toutes ses pièces (elles partagent une texture).</p>}
    </>
  );
}

// Couleur d'une tenue : variante du pack, puis teinte libre : on choisit la couleur du tissu à remplacer parmi ses
// couleurs principales (pastilles), puis la nouvelle couleur.
function OutfitColorRow({ outfit, color, onChange }: { outfit: string; color: OutfitColor; onChange: (color: OutfitColor) => void }) {
  const [hues, setHues] = useState<{ hue: number; color: string }[]>([]);
  const texture = outfitTexture(outfit, color.variant);
  useEffect(() => {
    let current = true;
    setHues([]);
    if (texture) {
      void mainHues(texture)
        .then((list) => current && setHues(list))
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [texture]);
  const [tint, setTint] = useDelayedColor(color.tint, (next) => onChange({ ...color, tint: next }));
  return (
    <div className="appearance-outfit-color">
      <div className="appearance-row">
        <span>Tenue {OUTFIT_NAMES[outfit] ?? outfit}</span>
        <VariantButtons value={color.variant} onChange={(variant) => onChange({ variant })} />
        {!color.tint && (
          <button
            disabled={!hues.length}
            onClick={() => onChange({ ...color, tint: DEFAULT_TINT, tintFrom: hues[0].hue })}
            title="Remplacer une couleur du tissu"
          >
            Teinte libre
          </button>
        )}
      </div>
      {color.tint && (
        <div className="appearance-row">
          <span>Remplacer</span>
          <span className="appearance-variants">
            {hues.map((h) => (
              <button
                key={h.hue}
                className={`appearance-swatch ${color.tintFrom === h.hue ? "appearance-swatch-active" : ""}`}
                style={{ background: h.color }}
                title="Couleur du tissu à remplacer"
                onClick={() => onChange({ ...color, tintFrom: h.hue })}
              />
            ))}
            par
            <input type="color" value={tint ?? color.tint} onChange={(e) => setTint(e.target.value)} />
            <button onClick={() => onChange({ variant: color.variant })} title="Retirer la teinte">
              ×
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

// Couleurs d'une arme ou d'un accessoire : une ligne par zone (matériau, ou case de la palette Hearthfold), avec sa
// couleur d'origine, une couleur libre et les couleurs de la palette Hearthfold. Une arme tenue deux fois partage ses
// couleurs.
function ItemColorControls({ item, colors, onChange }: { item: string; colors: ItemColors; onChange: (colors: ItemColors) => void }) {
  const zones = colorZones(item);
  // Zone dont la palette est dépliée.
  const [open, setOpen] = useState<string | null>(null);
  const set = (zone: string, color: string | null) => {
    const next = { ...colors };
    if (color) next[zone] = color;
    else delete next[zone];
    onChange(next);
  };
  return (
    <div className="appearance-item-colors">
      {zones.map((zone) => (
        <div key={zone.id}>
          <ZoneColorRow
            label={zoneLabel(zones, zone.id)}
            zone={zone}
            value={colors[zone.id]}
            paletteOpen={open === zone.id}
            onTogglePalette={() => setOpen(open === zone.id ? null : zone.id)}
            onChange={(color) => set(zone.id, color)}
          />
          {open === zone.id && (
            <div className="appearance-palette">
              {CATALOG.palette.colors.map((color, n) => (
                <button
                  key={n}
                  className={`appearance-swatch ${colors[zone.id] === color ? "appearance-swatch-active" : ""}`}
                  style={{ background: color }}
                  title={color}
                  onClick={() => {
                    set(zone.id, color);
                    setOpen(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      {Object.keys(colors).length > 0 && <button onClick={() => onChange({})}>Toutes les couleurs d'origine</button>}
    </div>
  );
}

// Une zone de couleur : pastille d'origine, couleur choisie (pipette appliquée après une courte pause, voir
// useDelayedColor), palette, retour à l'origine.
function ZoneColorRow(props: {
  label: string;
  zone: ColorZone;
  value: string | undefined;
  paletteOpen: boolean;
  onTogglePalette: () => void;
  onChange: (color: string | null) => void;
}) {
  const { label, zone, value, onChange } = props;
  const [picked, setPicked] = useDelayedColor(value, onChange);
  return (
    <div className="appearance-row">
      <span className="appearance-variants">
        <span className="appearance-swatch appearance-swatch-static" style={{ background: zone.color }} title={`Couleur d'origine ${zone.color}`} />
        {label}
      </span>
      <span className="appearance-variants">
        <input type="color" value={picked ?? zone.color} onChange={(e) => setPicked(e.target.value)} title="Couleur libre" />
        <button className={props.paletteOpen ? "lab-tab-active" : ""} onClick={props.onTogglePalette} title="Couleurs de la palette Hearthfold">
          Palette
        </button>
      </span>
      {value ? (
        <button onClick={() => onChange(null)} title="Revenir à la couleur d'origine">
          ×
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// Place d'un instrument pendant qu'on en joue (onglet Placement).
const PLAY_LABEL = "Joué (chants)";

// Objet placé dans l'onglet « Placement » : le modèle, l'objet, et sa place (main, côté d'une paire).
export interface PlacementSelection {
  model: string;
  kind: "weapon" | "accessory";
  item: string;
  slot: string;
}

export const DEFAULT_PLACEMENT: PlacementSelection = { model: "Human_Male", kind: "weapon", item: CATALOG.weapons[0]?.id ?? "", slot: "right" };

// Apparence montrée pendant le placement : le personnage composé dans l'onglet Apparence (base) s'il a ce modèle, avec
// l'objet réglé en plus s'il ne le porte pas ; sinon le modèle nu (corps entier), avec le seul objet réglé.
export function placementAppearance(selection: PlacementSelection, base?: Appearance | null): Appearance {
  // Place « joué » d'un instrument : l'instrument à sa place habituelle (celle du personnage, sinon dans le dos).
  const playing = selection.kind === "weapon" && selection.slot === PLAY_SLOT;
  const slot = (playing ? (base?.model === selection.model && base.weapons.find((w) => w.item === selection.item)?.slot) || "back" : selection.slot) as WeaponSlot;
  if (base && base.model === selection.model) {
    const weapon = { item: selection.item, slot };
    // Une arme portée qu'on règle à une autre place n'apparaît qu'une fois, à cette place.
    const weapons =
      selection.kind === "weapon" && !base.weapons.some((w) => w.item === weapon.item && w.slot === weapon.slot)
        ? [...base.weapons.filter((w) => w.slot !== weapon.slot && w.item !== weapon.item), weapon]
        : base.weapons;
    const accessories =
      selection.kind === "accessory" && !base.accessories.includes(selection.item) ? [...base.accessories, selection.item] : base.accessories;
    return { ...base, weapons, accessories };
  }
  return {
    model: selection.model,
    headOnly: false,
    parts: [],
    hair: [],
    weapons: selection.kind === "weapon" ? [{ item: selection.item, slot }] : [],
    accessories: selection.kind === "accessory" ? [selection.item] : [],
  };
}

// Objets d'une apparence, à régler un par un dans l'onglet Placement (une paire : chaque côté).
export function placementItems(appearance: Appearance): { selection: PlacementSelection; label: string }[] {
  const items: { selection: PlacementSelection; label: string }[] = [];
  for (const weapon of appearance.weapons) {
    items.push({
      selection: { model: appearance.model, kind: "weapon", item: weapon.item, slot: weapon.slot },
      label: `${weaponLabel(weapon.item)} · ${WEAPON_SLOTS[weapon.slot].toLowerCase()}`,
    });
    // Un instrument : aussi sa place pendant les chants (une seule fois s'il est tenu deux fois).
    if (isInstrument(weapon.item) && appearance.weapons.find((w) => w.item === weapon.item) === weapon) {
      items.push({
        selection: { model: appearance.model, kind: "weapon", item: weapon.item, slot: PLAY_SLOT },
        label: `${weaponLabel(weapon.item)} · ${PLAY_LABEL.toLowerCase()}`,
      });
    }
  }
  for (const id of appearance.accessories) {
    const def = CATALOG.accessories.find((a) => a.id === id);
    if (!def) continue;
    const sides: [string, string][] = PAIRED_SOCKETS.has(def.socket) ? [["r", " · droite"], ["l", " · gauche"]] : [["c", ""]];
    for (const [slot, suffix] of sides) {
      items.push({ selection: { model: appearance.model, kind: "accessory", item: id, slot }, label: `${accessoryLabel(id)}${suffix}` });
    }
  }
  return items;
}

// Objet à régler en arrivant sur l'onglet Placement avec ce personnage : celui qu'on réglait s'il le porte encore, sinon
// son premier objet (ou son modèle, sans objet).
export function placementFor(current: PlacementSelection, appearance: Appearance | null): PlacementSelection {
  if (!appearance) return current;
  const items = placementItems(appearance).map((item) => item.selection);
  if (current.model === appearance.model && items.some((item) => placementKey(item) === placementKey(current))) return current;
  return items[0] ?? { ...current, model: appearance.model };
}

export function placementKey(selection: PlacementSelection): string {
  if (selection.kind === "weapon" && selection.slot === PLAY_SLOT) return playKey(selection.item);
  return selection.kind === "weapon" ? weaponKey({ item: selection.item, slot: selection.slot as WeaponSlot }) : accessoryKey(selection.item, selection.slot as "r" | "l" | "c");
}

function readMount(node: TransformNode): Mount {
  const rotation = node.rotationQuaternion ? node.rotationQuaternion.toEulerAngles() : node.rotation;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {
    // Une cape garde le nom de son os dans ses métadonnées (son parent direct est le cadre qui la tient droite).
    bone: (node.metadata as { mountBone?: string } | null)?.mountBone ?? (node.parent as TransformNode | null)?.name ?? "",
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
  // Personnage de l'onglet Apparence (classe et camp affichés), montré tel quel s'il a le modèle choisi.
  base: Appearance | null;
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
  // Placement lu sur l'objet, gardé seulement s'il est à la place réglée : un instrument entre les mains (chant en
  // cours) ne change pas sa place habituelle, ni l'inverse.
  const storeFrom = (target: TransformNode) => {
    const mount = readMount(target);
    if ((mount.bone === PLAY_FRAME) === latest.current.key.endsWith(`@${PLAY_SLOT}`)) store(mount);
  };

  // Taille lue une image plus tard : un instrument ne passe à sa place « joué » (ou n'en revient) qu'à l'image suivante,
  // et ses deux places partagent le même nœud.
  useEffect(() => {
    setScale(node?.scaling.x ?? 1);
    const frame = requestAnimationFrame(() => setScale(node?.scaling.x ?? 1));
    return () => cancelAnimationFrame(frame);
  }, [node, key]);

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
    const done = () => storeFrom(node);
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
      ...CATALOG.bodies.map((b) => ({ id: b.id, label: `${RACES[b.race] ?? b.race} ${GENDERS[b.gender].toLowerCase()}` })),
      ...CATALOG.monsters.map((m) => ({ id: monsterModel(m.id), label: `Monstre ${m.id}` })),
      ...Object.entries(CUSTOM_MODELS).map(([id, label]) => ({ id: customModel(id), label: `Modèle complet ${label}` })),
    ],
    [],
  );
  const accessory = selection.kind === "accessory" ? CATALOG.accessories.find((a) => a.id === selection.item) : null;
  const sides = accessory
    ? PAIRED_SOCKETS.has(accessory.socket)
      ? { r: "Droite", l: "Gauche" }
      : { c: "Unique" }
    : isInstrument(selection.item)
      ? { ...WEAPON_SLOTS, [PLAY_SLOT]: PLAY_LABEL }
      : WEAPON_SLOTS;
  const playing = selection.kind === "weapon" && selection.slot === PLAY_SLOT;
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
      <AbilityButtons {...props.abilities} />
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
      {props.base?.model === selection.model && (
        <>
          <p className="lab-note">Personnage de l'onglet Apparence (classe et camp affichés), avec sa tenue et tous ses objets.</p>
          <div className="appearance-abilities">
            {placementItems(props.base).map(({ selection: item, label }, i) => (
              <button
                key={`${placementKey(item)}-${i}`}
                className={placementKey(item) === key ? "lab-tab-active" : ""}
                onClick={() => setSelection(item)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
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
            <select
              value={selection.item}
              onChange={(e) => setSelection({ ...selection, item: e.target.value, slot: selection.slot === PLAY_SLOT && !isInstrument(e.target.value) ? "back" : selection.slot })}
            >
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
              onPointerUp={() => storeFrom(node)}
              onKeyUp={() => storeFrom(node)}
            />
            <span>{scale.toPrecision(3)}</span>
          </label>
          <p className="lab-note">
            Tirez les flèches (déplacer) ou les anneaux (tourner) sur l'objet.{" "}
            {playing
              ? "Pose de jeu figée : l'instrument suit les mains pendant les animations de jeu (chants), les armes en main sont cachées."
              : `Os : ${readMount(node).bone}.`}{" "}
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
    </div>
  );
}
