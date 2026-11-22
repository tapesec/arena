import { useState } from "react";
import { CLASS_LIST } from "@arena/shared";
import { MAX_CONCURRENT_SOUNDS, MIN_REPEAT_INTERVAL, MUSIC_LEVELS, NO_SOUND, RATE_JITTER, audio, type CommonSoundChoice, type CommonSoundChoices, type SoundName } from "./audio/AudioManager";
import { GAME_SOUND } from "./audio/soundEdits";
import { SOUND_RATE_JITTER } from "./game/abilityEffects";
import { ABILITY_SOUNDS } from "./game/codeSounds";
import * as C from "./game/commonSounds";
import { abilityName } from "./i18n";

// Onglet « Sons communs » de animation-lab.html : les sons du jeu qui ne dépendent pas d'une compétence réglée
// (voix, coups, pas, alertes, interface, musique) et leurs règles. Tout est lu dans game/commonSounds.ts, que le jeu
// utilise : ce qui est affiché est ce qui est joué. Chaque son peut être remplacé par un autre (catalogue ou jeu),
// avec son volume, sa vitesse et son début : choix enregistrés dans audio/commonSounds.json, appliqués par
// AudioManager.play partout où ce son est joué.

interface Played {
  sound: SoundName;
  volume?: number;
  rate?: number;
}

interface Row {
  when: string;
  sounds: Played[];
  detail?: string;
}

interface Section {
  title: string;
  rows: Row[];
  rules?: string[];
}

const percent = (value: number) => `${Math.round(value * 100)} %`;
const num = (value: number) => String(value).replace(".", ",");
const className = (id: string) => CLASS_LIST.find((c) => c.id === id)?.name ?? id;
const cue = (c: C.Voice["death"]): Played => ({ sound: c.sound, volume: c.volume, rate: c.rate });

function sections(): Section[] {
  const voices = Object.entries(C.VOICES);
  return [
    {
      title: "Voix des personnages",
      rows: voices.flatMap(([classId, voice]) => [
        { when: `${className(classId)} : douleur`, sounds: [{ sound: voice.pain, volume: C.VOICE_VOLUME }] },
        { when: `${className(classId)} : mort`, sounds: [{ ...cue(voice.death), volume: (voice.death.volume ?? 1) * C.VOICE_VOLUME }] },
        ...(voice.healed ? [{ when: `${className(classId)} : soigné`, sounds: [{ sound: voice.healed, volume: C.VOICE_VOLUME * C.HEALED_VOLUME }] }] : []),
      ]),
      rules: [
        `Cri de douleur quand le personnage prend des dégâts sans mourir : au plus une fois toutes les ${num(C.PAIN_INTERVAL)} s, et seulement ${percent(C.PAIN_CHANCE)} du temps, ${num(C.HIT_DELAY)} s après le coup.`,
        `Soupir quand il est soigné : au plus une fois toutes les ${num(C.HEALED_INTERVAL)} s (seules les voix qui en ont un).`,
        "La voix dépend de la classe, pas du modèle 3D.",
      ],
    },
    {
      title: "Coups",
      rows: [
        ...Object.entries(C.SWINGS).map(([classId, sound]) => ({
          when: `Geste de l'arme : ${className(classId)}`,
          sounds: [{ sound, volume: C.SWING_VOLUME }],
        })),
        { when: "Coup qui porte (mêlée)", sounds: [C.HIT], detail: `${num(C.HIT_DELAY)} s après le geste` },
        { when: "Coup critique ou dans le dos", sounds: [C.HEAVY_HIT], detail: "plus grave et plus fort" },
        { when: "Bloqué", sounds: [{ sound: C.BLOCK_SOUND }] },
        { when: "Esquivé", sounds: [{ sound: C.EVADE_SOUND }] },
        { when: "Absorbé (bulle)", sounds: [{ sound: C.ABSORB_SOUND }] },
      ],
      rules: [
        `Geste de l'arme à chaque attaque automatique, et au lancement des techniques de mêlée (${[...C.MELEE_ABILITIES].join(", ")}).`,
        "Une technique (ou le Coup de pied) qui a une piste de son réglée dans l'éditeur ne joue plus ces sons communs : une piste au geste du lanceur remplace le geste de l'arme, une piste à l'impact remplace le coup qui porte.",
      ],
    },
    {
      title: "Pas",
      rows: [
        { when: "Sur les pavés de la place", sounds: [{ sound: C.STEP_SOUNDS.stone, volume: C.STEP_VOLUME_SELF }] },
        { when: "Sur l'herbe", sounds: [{ sound: C.STEP_SOUNDS.grass, volume: C.STEP_VOLUME_SELF }] },
        { when: "Sur la terre des chemins", sounds: [{ sound: C.STEP_SOUNDS.dirt, volume: C.STEP_VOLUME_SELF }] },
      ],
      rules: [
        `Un pas toutes les ${num(C.RUN_STRIDE)} m en course, toutes les ${num(C.WALK_STRIDE)} m en marche (course au-delà de ${num(C.RUN_SPEED)} m/s).`,
        `Volume : ${percent(C.STEP_VOLUME_SELF)} pour ses propres pas, ${percent(C.STEP_VOLUME_OTHERS)} pour ceux des autres, entendus jusqu'à ${num(C.STEP_RANGE)} m.`,
      ],
    },
    {
      title: "Alertes",
      rows: [
        ...Object.entries(C.CONTROL_ALERTS).map(([kind, sound]) => ({ when: `On subit un ${kind}`, sounds: [{ sound }] })),
        { when: "Vie basse", sounds: [{ sound: C.ALERTS.lowHealth }], detail: `sous ${percent(C.LOW_HEALTH_RATIO)} de vie, toutes les ${num(C.HEARTBEAT_INTERVAL)} s` },
        { when: "Compétence de nouveau prête", sounds: [{ sound: C.ALERTS.abilityReady }], detail: `recharge d'au moins ${num(C.READY_SOUND_MIN_COOLDOWN)} s` },
        { when: "Sa propre mort", sounds: [{ sound: C.ALERTS.death }] },
        { when: "Élimination d'un adversaire (sceau brisé)", sounds: [{ sound: C.ALERTS.killEnemy }], detail: "quand le sceau se fend" },
        { when: "Élimination d'un allié (sceau brisé)", sounds: [{ sound: C.ALERTS.killAlly }], detail: "quand le sceau se fend" },
        { when: "Dernier survivant d'une équipe", sounds: [{ sound: C.ALERTS.lastStanding }], detail: "avec son bandeau" },
        { when: "Compte à rebours (3 dernières secondes)", sounds: [{ sound: C.ALERTS.countdown }] },
        { when: "Début du combat", sounds: [{ sound: C.ALERTS.fightStart }] },
        { when: "Victoire", sounds: [{ sound: C.ALERTS.win }] },
        { when: "Défaite", sounds: [{ sound: C.ALERTS.lose }] },
      ],
      rules: ["Les alertes du joueur passent toujours, même quand trop de sons jouent déjà."],
    },
    {
      title: "Interface et musique",
      rows: [
        { when: "Clic sur un bouton", sounds: [{ sound: C.UI_SOUNDS.click }] },
        { when: "Choix d'une classe", sounds: [{ sound: C.UI_SOUNDS.classSelect }] },
      ],
      rules: [
        `Musique des menus : « ${C.MUSIC.menu} » (volume ${percent(MUSIC_LEVELS.normal)}).`,
        `Musique de partie : « ${C.MUSIC.match} », douce pendant la préparation et à la fin (${percent(MUSIC_LEVELS.soft)}), normale en combat (${percent(MUSIC_LEVELS.normal)}).`,
      ],
    },
    {
      title: "Règles générales",
      rows: [],
      rules: [
        `Distance : plein volume jusqu'à ${num(C.FULL_VOLUME_DISTANCE)} m de la caméra, puis plus faible sur ${num(C.FADE_DISTANCE)} m, jamais sous ${percent(C.MIN_DISTANT_VOLUME)}.`,
        `Gauche/droite : selon la place à l'écran, entièrement d'un côté à ${num(C.PAN_WIDTH)} m.`,
        `Au plus ${MAX_CONCURRENT_SOUNDS} sons en même temps ; un même son n'est pas rejoué à moins de ${num(MIN_REPEAT_INTERVAL)} s (un sort de zone ne joue son impact qu'une fois).`,
        `Variation : un son enregistré du jeu tire une de ses variantes au hasard et varie de ±${percent(RATE_JITTER)} en vitesse ; un son généré (evade, absorb, alertes, clic…) est toujours le même, sans réglage de vitesse ; une piste de son d'une compétence varie de ±${percent(SOUND_RATE_JITTER)}.`,
      ],
    },
  ];
}

type Choices = { group: string; options: { id: string; label: string }[] }[];

export function CommonSoundsPane(props: {
  choices: CommonSoundChoices;
  saved: CommonSoundChoices;
  onChange: (choices: CommonSoundChoices) => void;
  // Mêmes listes que les pistes de son des compétences (animationLab).
  soundChoices: (filter: string, current: string) => Choices;
  soundLabel: (recipe: string) => string;
  soundDuration: (recipe: string) => number;
  isSynthSound: (recipe: string) => boolean;
}) {
  const { choices, saved, onChange } = props;
  const [editing, setEditing] = useState<SoundName | null>(null);
  const all = sections();
  // Lignes où sert chaque son : un son remplacé l'est partout où il est joué.
  // Les sons des compétences prévus dans le code passent aussi par ce remplacement.
  const usedIn = (sound: SoundName) => [
    ...all.flatMap((section) => section.rows.filter((row) => row.sounds.some((p) => p.sound === sound)).map((row) => row.when)),
    ...Object.entries(ABILITY_SOUNDS)
      .filter(([, cues]) => [...(cues.cast ?? []), ...(cues.impact ?? [])].some((cue) => cue.sound === sound))
      .map(([abilityId]) => `${abilityName(abilityId)} (compétence, tant qu'elle n'a pas ses sons réglés)`),
  ];
  return (
    <div className="sound-pane common-sounds">
      <p className="lab-note">
        Sons du jeu qui ne dépendent pas d'une compétence (game/commonSounds.ts). ▶ pour écouter (au volume et à la vitesse du jeu) ; ✎ pour
        remplacer un son, ou régler son volume, sa vitesse et son début. Un son remplacé l'est partout où il est joué.
      </p>
      {all.map((section) => (
        <section key={section.title}>
          <h3>{section.title}</h3>
          {section.rows.length > 0 && (
            <table>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.when}>
                    <td>{row.when}</td>
                    <td>
                      {row.sounds.map((played) => {
                        const choice = choices[played.sound];
                        const changed = JSON.stringify(choice) !== JSON.stringify(saved[played.sound]);
                        return (
                          <span key={played.sound} className="common-sound-cell">
                            <span className={`common-sound${choice ? " common-sound-replaced" : ""}`}>
                              <button
                                title={choice?.recipe === NO_SOUND ? "Son retiré : rien n'est joué" : "Écouter"}
                                disabled={choice?.recipe === NO_SOUND}
                                onClick={() => audio.play(played.sound, { volume: played.volume ?? 1, rate: played.rate ?? 1, priority: true })}>
                                ▶
                              </button>
                              {choice?.recipe === NO_SOUND ? (
                                <>
                                  <s>{played.sound}</s>
                                  <small> retiré (aucun son)</small>
                                </>
                              ) : choice ? (
                                <>
                                  <code>{props.soundLabel(choice.recipe)}</code>
                                  {choice.variants?.length ? <small> + {choice.variants.length} variante{choice.variants.length > 1 ? "s" : ""}</small> : null}
                                  {choice.jitter && <small> · vitesse variable</small>}
                                  <small> au lieu de {played.sound}</small>
                                </>
                              ) : (
                                <code>{played.sound}</code>
                              )}
                              {played.volume !== undefined && played.volume !== 1 && <small> volume {percent(played.volume)}</small>}
                              {played.rate !== undefined && played.rate !== 1 && <small> vitesse ×{num(played.rate)}</small>}
                              {changed && <small className="common-sound-draft"> (non enregistré)</small>}
                              <button
                                title="Remplacer ou régler ce son"
                                className={editing === played.sound ? "lab-tab-active" : ""}
                                onClick={() => setEditing(editing === played.sound ? null : played.sound)}
                              >
                                ✎
                              </button>
                            </span>
                            {editing === played.sound && (
                              <CommonSoundEditor
                                sound={played.sound}
                                choice={choice}
                                alsoIn={usedIn(played.sound).filter((when) => when !== row.when)}
                                onChange={(next) => {
                                  const rest = { ...choices };
                                  delete rest[played.sound];
                                  onChange(next ? { ...rest, [played.sound]: next } : rest);
                                }}
                                soundChoices={props.soundChoices}
                                soundDuration={props.soundDuration}
                                isSynthSound={props.isSynthSound}
                              />
                            )}
                          </span>
                        );
                      })}
                    </td>
                    <td className="lab-hint">{row.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {section.rules && (
            <ul>
              {section.rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

// Réglage d'un son commun : son de remplacement (ou le sien) et ses variantes tirées au hasard, volume, vitesse (fixe,
// et qui varie un peu à chaque fois si coché), début. Sans réglage (son d'origine seul, valeurs par défaut), le choix
// est retiré.
function CommonSoundEditor(props: {
  sound: SoundName;
  choice: CommonSoundChoice | undefined;
  alsoIn: string[];
  onChange: (choice: CommonSoundChoice | null) => void;
  soundChoices: (filter: string, current: string) => Choices;
  soundDuration: (recipe: string) => number;
  isSynthSound: (recipe: string) => boolean;
}) {
  const own = `${GAME_SOUND}${props.sound}`;
  const current: CommonSoundChoice = props.choice ?? { recipe: own };
  const [filter, setFilter] = useState("");
  const removed = current.recipe === NO_SOUND;
  const recipes = removed ? [] : [current.recipe, ...(current.variants ?? [])];
  // Réglages qui ont un effet : la vitesse sauf sur un son rétro (généré), le début seulement sur les sons du
  // catalogue (durée connue).
  const hasRate = recipes.some((recipe) => !props.isSynthSound(recipe));
  const hasSkip = recipes.length > 0 && recipes.every((recipe) => !recipe.startsWith(GAME_SOUND));
  const shortest = Math.min(...recipes.map(props.soundDuration));

  const update = (patch: Partial<CommonSoundChoice>) => {
    const merged = { ...current, ...patch };
    // Son retiré : rien d'autre à régler.
    if (merged.recipe === NO_SOUND) {
      props.onChange({ recipe: NO_SOUND });
      return;
    }
    const all = [merged.recipe, ...(merged.variants ?? [])];
    // Valeurs par défaut et réglages sans effet retirés (le fichier ne garde que ce qui change), clés toujours dans
    // le même ordre.
    const next: CommonSoundChoice = { recipe: merged.recipe };
    if (merged.variants?.length) next.variants = merged.variants;
    if (merged.volume !== undefined && merged.volume !== 1) next.volume = merged.volume;
    const rated = all.some((recipe) => !props.isSynthSound(recipe));
    if (rated && merged.rate !== undefined && merged.rate !== 1) next.rate = merged.rate;
    if (merged.skip && all.every((recipe) => !recipe.startsWith(GAME_SOUND))) next.skip = merged.skip;
    if (rated && merged.jitter) next.jitter = true;
    const untouched = next.recipe === own && Object.keys(next).length === 1;
    props.onChange(untouched ? null : next);
  };
  const setRecipes = (list: string[]) => update({ recipe: list[0], variants: list.slice(1) });
  // Écoute d'un son précis du réglage (choisi dans une liste), au volume et à la vitesse réglés.
  const listen = (recipe: string) => {
    if (recipe === NO_SOUND) return;
    const options = { volume: current.volume ?? 1, rate: current.rate ?? 1, priority: true };
    if (recipe === own) audio.play(props.sound, { ...options, original: true });
    else void audio.playTrack(recipe, { ...options, offset: hasSkip ? (current.skip ?? 0) : 0 });
  };
  // Variante ajoutée : le son suivant du même pack, pas encore pris (les pas numérotés se suivent).
  const nextVariant = () => {
    const last = recipes[recipes.length - 1];
    const group = props.soundChoices("", last).find(({ options }) => options.some(({ id }) => id === last));
    const options = group?.options.map(({ id }) => id) ?? [];
    const after = [...options.slice(options.indexOf(last) + 1), ...options];
    return after.find((id) => !recipes.includes(id)) ?? last;
  };
  const select = (value: string, onPick: (value: string) => void, withNone: boolean) => (
    <select
      value={value}
      onChange={(e) => {
        onPick(e.target.value);
        listen(e.target.value);
      }}
    >
      <option value={own}>{`${props.sound} (son d'origine)`}</option>
      {withNone && <option value={NO_SOUND}>Aucun son (retiré)</option>}
      {props.soundChoices(filter, value).map(({ group, options }) => (
        <optgroup key={group} label={group}>
          {options
            .filter(({ id }) => id !== own)
            .map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
  const slider = (label: string, key: "volume" | "rate", min: number, max: number) => (
    <label className="lab-offset" title="Double-clic : 100 %">
      {label} {key === "volume" ? percent(current[key] ?? 1) : `×${num(Number((current[key] ?? 1).toFixed(2)))}`}
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={current[key] ?? 1}
        onChange={(e) => update({ [key]: Number(e.target.value) })}
        onDoubleClick={() => update({ [key]: 1 })}
      />
    </label>
  );
  return (
    <div className="common-sound-editor">
      <div className="lab-controls">
        <input type="search" placeholder="Chercher un son" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {removed && (
          <label>
            Son {select(NO_SOUND, (value) => update({ recipe: value, variants: [], skip: 0 }), true)}
          </label>
        )}
      </div>
      {recipes.map((recipe, i) => (
        <div key={i} className="lab-controls common-sound-variant">
          <label>
            {i === 0 ? "Son" : `Variante ${i + 1}`}{" "}
            {select(recipe, (value) => (i === 0 && value === NO_SOUND ? update({ recipe: NO_SOUND }) : setRecipes(recipes.map((r, j) => (j === i ? value : r)))), i === 0)}
          </label>
          <button title="Écouter ce son" onClick={() => listen(recipe)}>
            ▶
          </button>
          {recipes.length > 1 && (
            <button title="Enlever ce son des variantes" onClick={() => setRecipes(recipes.filter((_, j) => j !== i))}>
              ×
            </button>
          )}
        </div>
      ))}
      {!removed && (
        <div className="lab-controls">
          <button title="Un autre son, tiré au hasard avec les autres (jamais deux fois de suite le même)" onClick={() => setRecipes([...recipes, nextVariant()])}>
            + Variante
          </button>
          <button title="Écouter comme en jeu (variante au hasard)" onClick={() => audio.playChoice(props.sound, current, { priority: true })}>
            ▶ Comme en jeu
          </button>
          {slider("Volume", "volume", 0, 2)}
          {hasRate && slider("Vitesse", "rate", 0.5, 2)}
          {hasRate && (
            <label title={`La vitesse varie de ±${percent(RATE_JITTER)} à chaque fois : un son répété (les pas) ne sonne jamais pareil`}>
              <input type="checkbox" checked={!!current.jitter} onChange={(e) => update({ jitter: e.target.checked })} /> Faire varier la vitesse
            </label>
          )}
          {hasSkip && (
            <label className="lab-offset" title="Le début du son est sauté · double-clic : depuis le début">
              Commencer à {num(Number((current.skip ?? 0).toFixed(2)))} s
              <input
                type="range"
                min={0}
                max={Math.max(0.05, shortest - 0.05)}
                step={0.01}
                value={current.skip ?? 0}
                onChange={(e) => update({ skip: Number(e.target.value) })}
                onDoubleClick={() => update({ skip: 0 })}
              />
            </label>
          )}
        </div>
      )}
      <div className="lab-controls">
        <button disabled={removed} onClick={() => props.onChange({ recipe: NO_SOUND })} title="Plus aucun son à cet endroit du jeu">
          Retirer
        </button>
        <button disabled={!props.choice} onClick={() => props.onChange(null)}>
          Son d'origine
        </button>
      </div>
      {props.alsoIn.length > 0 && <p className="lab-hint">Ce son sert aussi à : {props.alsoIn.join(", ")}.</p>}
    </div>
  );
}
