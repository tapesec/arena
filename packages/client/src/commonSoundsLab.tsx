import { CLASS_LIST } from "@arena/shared";
import { MAX_CONCURRENT_SOUNDS, MIN_REPEAT_INTERVAL, MUSIC_LEVELS, RATE_JITTER, audio, type SoundName } from "./audio/AudioManager";
import { SOUND_RATE_JITTER } from "./game/abilityEffects";
import * as C from "./game/commonSounds";

// Onglet « Sons communs » de animation-lab.html : les sons du jeu qui ne dépendent pas d'une compétence réglée
// (voix, coups, pas, alertes, interface, musique) et leurs règles, en lecture seule. Tout est lu dans
// game/commonSounds.ts, que le jeu utilise : ce qui est affiché est ce qui est joué.

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
      title: "Incantation et alertes",
      rows: [
        { when: "Début d'une incantation", sounds: [{ sound: C.CAST_START_SOUND, volume: C.CAST_START_VOLUME_SELF }], detail: `la sienne ; celles des autres à ${percent(C.CAST_START_VOLUME_OTHERS)}, jusqu'à ${num(C.CAST_SOUND_RANGE)} m` },
        { when: "Incantation interrompue (la sienne)", sounds: [{ sound: C.ALERTS.interrupted }] },
        ...Object.entries(C.CONTROL_ALERTS).map(([kind, sound]) => ({ when: `On subit un ${kind}`, sounds: [{ sound }] })),
        { when: "Vie basse", sounds: [{ sound: C.ALERTS.lowHealth }], detail: `sous ${percent(C.LOW_HEALTH_RATIO)} de vie, toutes les ${num(C.HEARTBEAT_INTERVAL)} s` },
        { when: "Compétence de nouveau prête", sounds: [{ sound: C.ALERTS.abilityReady }], detail: `recharge d'au moins ${num(C.READY_SOUND_MIN_COOLDOWN)} s` },
        { when: "Sa propre mort", sounds: [{ sound: C.ALERTS.death }] },
        { when: "Compte à rebours (3 dernières secondes)", sounds: [{ sound: C.ALERTS.countdown }] },
        { when: "Début du combat", sounds: [{ sound: C.ALERTS.fightStart }] },
        { when: "Victoire", sounds: [{ sound: C.ALERTS.win }] },
        { when: "Défaite", sounds: [{ sound: C.ALERTS.lose }] },
      ],
      rules: ["Les alertes du joueur (toutes, sauf le début d'une incantation) passent toujours, même quand trop de sons jouent déjà."],
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
        `Variation : un son enregistré du jeu tire une de ses variantes au hasard et varie de ±${percent(RATE_JITTER)} en vitesse ; un son généré (castStart, evade, alertes, clic…) est toujours le même, sans réglage de vitesse ; une piste de son d'une compétence varie de ±${percent(SOUND_RATE_JITTER)}.`,
      ],
    },
  ];
}

export function CommonSoundsPane() {
  return (
    <div className="sound-pane common-sounds">
      <p className="lab-note">
        Sons du jeu qui ne dépendent pas d'une compétence, en lecture seule (réglés dans le code : game/commonSounds.ts). ▶ pour écouter
        (au volume et à la vitesse du jeu).
      </p>
      {sections().map((section) => (
        <section key={section.title}>
          <h3>{section.title}</h3>
          {section.rows.length > 0 && (
            <table>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.when}>
                    <td>{row.when}</td>
                    <td>
                      {row.sounds.map((played) => (
                        <span key={played.sound} className="common-sound">
                          <button title="Écouter" onClick={() => audio.play(played.sound, { volume: played.volume ?? 1, rate: played.rate ?? 1, priority: true })}>
                            ▶
                          </button>
                          <code>{played.sound}</code>
                          {played.volume !== undefined && played.volume !== 1 && <small> volume {percent(played.volume)}</small>}
                          {played.rate !== undefined && played.rate !== 1 && <small> vitesse ×{num(played.rate)}</small>}
                        </span>
                      ))}
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
