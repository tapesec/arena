import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { audio } from "./audio/AudioManager";
import samples from "./audio/samples.json";
import catalog from "./audio/soundCatalog.json";
import { SOUNDS, type SoundId } from "./audio/sounds";
import "./styles.css";

// Catalogue des sons (http://localhost:5173/soundboard.html), en développement seulement : tous les sons
// disponibles, écoutables d'un clic, avec le nom à copier dans le tableur et l'indication de ceux déjà joués
// par le jeu. Les fichiers bruts sont produits par scripts/build-sound-catalog.mjs (public/dev-sounds).

interface CatalogFile {
  name: string;
  pack: string;
  file: string;
  duration: number;
}

type Kind = "group" | "file" | "generated";

interface SoundItem {
  // Le nom à copier : identifiant du groupe ou du son généré, ou nom du fichier brut.
  id: string;
  label: string;
  kind: Kind;
  pack: string;
  files: CatalogFile[];
  // Lignes du code du jeu qui jouent ce son (vide : pas encore utilisé).
  uses: string[];
}

const FILES = catalog as CatalogFile[];
const GROUPS = Object.entries(samples.groups) as [string, { label: string; category: string; files: string[] }][];

// Motif "dossier/nom*.ext" de samples.json → expression régulière sur le chemin du fichier.
const patternRegex = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);

// Code source du jeu, pour savoir quels sons il joue (les définitions des sons et cette page ne comptent pas).
const SOURCES = Object.entries(
  import.meta.glob<string>(["./**/*.ts", "./**/*.tsx", "!./audio/**", "!./soundboard.tsx"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);
// Lignes qui jouent un son : celles où le code attend un nom de son (sound: "…", play("…"), un tableau typé
// SoundName comme les gestes d'arme par classe). Un même mot peut nommer autre chose (la compétence "heal",
// l'écran "classSelect") : ailleurs, il ne compte pas.
const SOUND_LINE = /\b(?:sound|pain|healed)\s*:|\bplay(?:At|Sample)?\(|\bSoundName\b/;
const SOUND_LINES: string[] = [];
for (const [path, source] of SOURCES) {
  let typedBlock = false;
  for (const line of source.split("\n")) {
    if (/\bSoundName\b.*=\s*\{\s*$/.test(line)) typedBlock = true;
    if (typedBlock || SOUND_LINE.test(line)) SOUND_LINES.push(`${path.replace("./", "")} : ${line.trim()}`);
    if (typedBlock && /^\s*\};?\s*$/.test(line)) typedBlock = false;
  }
}
const usesOf = (id: string) => SOUND_LINES.filter((line) => new RegExp(`["'\`]${id}["'\`]`).test(line));

function buildItems(): SoundItem[] {
  const grouped = new Set<string>();
  const items: SoundItem[] = GROUPS.map(([id, group]) => {
    const regexes = group.files.map(patternRegex);
    const files = FILES.filter((f) => regexes.some((r) => r.test(f.file)));
    for (const f of files) grouped.add(f.name);
    return { id, label: group.label, kind: "group", pack: `Jeu · ${group.category}`, files, uses: usesOf(id) };
  });
  // Fichiers qui ne font encore partie d'aucun groupe : à copier dans le tableur pour en faire un son du jeu.
  for (const file of FILES) {
    if (grouped.has(file.name)) continue;
    const label = file.file.split("/").pop()!;
    items.push({ id: file.name, label, kind: "file", pack: file.pack, files: [file], uses: [] });
  }
  for (const id of Object.keys(SOUNDS) as SoundId[]) {
    items.push({ id, label: SOUNDS[id].label, kind: "generated", pack: "Sons générés (rétro)", files: [], uses: usesOf(id) });
  }
  return items;
}

const ITEMS = buildItems();
const PACKS = [...new Set(ITEMS.map((item) => item.pack))];
const formatDuration = (s: number) => `${s.toFixed(1).replace(".", ",")} s`;

function Soundboard() {
  const [volume, setVolume] = useState(audio.settings.volume);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pack, setPack] = useState("Tous");
  const [usage, setUsage] = useState<"all" | "yes" | "no">("all");
  const [search, setSearch] = useState("");
  const playing = useRef<HTMLAudioElement | null>(null);

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ITEMS.filter(
      (item) =>
        (pack === "Tous" || item.pack === pack) &&
        (usage === "all" || (usage === "yes") === item.uses.length > 0) &&
        (!query || `${item.id} ${item.label} ${item.files.map((f) => f.file).join(" ")}`.toLowerCase().includes(query)),
    );
  }, [pack, usage, search]);

  const play = (item: SoundItem) => {
    audio.unlock();
    playing.current?.pause();
    if (item.kind === "generated") audio.play(item.id as SoundId, { priority: true, original: true });
    else if (item.kind === "group") void audio.playSample(item.id, { priority: true });
    else {
      const element = new Audio(`/dev-sounds/${item.id}.m4a`);
      element.volume = volume;
      void element.play();
      playing.current = element;
    }
    setLastPlayed(item.id);
  };

  const copy = (id: string) => {
    void navigator.clipboard?.writeText(id);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };

  const used = ITEMS.filter((item) => item.uses.length > 0).length;

  return (
    <div className="soundboard">
      <h1>Sons</h1>
      <p className="screen-hint">
        Cliquer sur un son pour l'écouter, sur <strong>Copier</strong> pour copier son nom (à coller dans la colonne Son
        du tableur). <span className="sound-badge sound-badge-used">En jeu</span> : le jeu le joue déjà (survoler pour
        voir où). Les groupes du jeu réunissent plusieurs variantes, tirées au hasard ; les autres sons sont les
        fichiers bruts des packs, pas encore dans le jeu. {ITEMS.length} sons, dont {used} en jeu.
      </p>
      <div className="soundboard-toolbar">
        <label>
          Pack
          <select value={pack} onChange={(e) => setPack(e.target.value)}>
            <option>Tous</option>
            {PACKS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          En jeu
          <select value={usage} onChange={(e) => setUsage(e.target.value as "all" | "yes" | "no")}>
            <option value="all">Tous</option>
            <option value="yes">Oui</option>
            <option value="no">Non</option>
          </select>
        </label>
        <input type="search" placeholder="Rechercher (nom, fichier)" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="soundboard-volume">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              audio.setVolume(Number(e.target.value));
            }}
          />
        </label>
        <span>{shown.length} sons</span>
      </div>
      {PACKS.filter((p) => shown.some((item) => item.pack === p)).map((p) => (
        <section key={p}>
          <h2>{p}</h2>
          <div className="soundboard-grid">
            {shown
              .filter((item) => item.pack === p)
              .map((item) => (
                <div
                  key={`${item.kind}-${item.id}`}
                  role="button"
                  tabIndex={0}
                  className={`sound-button ${item.uses.length ? "sound-button-used" : ""} ${lastPlayed === item.id ? "sound-button-last" : ""}`}
                  title={[...item.files.map((f) => f.file), ...item.uses.slice(0, 6).map((u) => `▶ ${u}`)].join("\n")}
                  onClick={() => play(item)}
                  onKeyDown={(e) => e.key === "Enter" && play(item)}
                >
                  <span className="sound-label">{item.label}</span>
                  <span className="sound-id">{item.id}</span>
                  <span className="sound-meta">
                    {item.uses.length > 0 && <span className="sound-badge sound-badge-used">En jeu</span>}
                    {item.files.length > 1 && <span>{item.files.length} variantes</span>}
                    {item.files.length > 0 && <span>{formatDuration(Math.max(...item.files.map((f) => f.duration)))}</span>}
                    <button
                      className="sound-copy"
                      onClick={(e) => {
                        e.stopPropagation();
                        copy(item.id);
                      }}
                    >
                      {copied === item.id ? "Copié !" : "Copier"}
                    </button>
                  </span>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Soundboard />
  </StrictMode>,
);
