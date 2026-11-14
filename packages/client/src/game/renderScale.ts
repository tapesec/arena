import type { Engine } from "@babylonjs/core/Engines/engine";

// Résolution du rendu : sur un écran haute densité (Retina, mise à l'échelle Windows), le jeu calcule l'image à la
// densité de l'écran, plafonnée à 2, pour une image nette. Si l'appareil ne suit pas (moins de MIN_FPS images/s
// pendant LOW_SECONDS secondes de suite, onglet visible), il descend d'un cran : 2, puis 1,5, puis 1 (un pixel calculé
// par pixel CSS). Si la baisse ne fait pas remonter nettement les images/s (au moins GAIN), ce n'est pas le nombre de
// pixels qui freine (processeur chargé, par exemple) : il revient au cran précédent et n'adapte plus. Pas de remontée
// sinon pendant la partie (pas de va-et-vient).
//
// Les images/s mesurées pendant la partie (préparation et combat) sont envoyées au serveur pour la télémétrie
// (stats()).
//
// En développement, ?dpr=1 | 1.5 | 2 fixe la densité (sans adaptation) et un encadré affiche la résolution et les i/s.

const MAX_SCALE = 2;
const LOWER_STEPS = [1.5, 1];
const MIN_FPS = 50;
const LOW_SECONDS = 4;
const GAIN = 1.15;
// Secondes mesurées après une baisse pour juger de son effet.
const CHECK_SECONDS = 3;
// Pas de mesure juste après le début de la partie ou un changement de résolution (compilation des shaders,
// chargement des textures).
const SETTLE_SECONDS = 5;

export interface RenderStats {
  dpr: number;
  scale: number;
  // Images/s moyennes et 10e centile des relevés d'une seconde (les passages difficiles).
  fps: number;
  fpsLow: number;
  // Baisses de résolution tentées, et 1 si la dernière a été annulée faute d'effet (le processeur freine).
  drops: number;
  reverted: number;
}

export class RenderScale {
  private dpr = currentDpr();
  private readonly forced: number | null;
  private levels: number[] = [];
  // Cran courant dans levels (0 : densité de l'écran).
  private level = 0;
  private drops = 0;
  private reverted = 0;
  private settle = SETTLE_SECONDS;
  private lowFps: number[] = [];
  // Après une baisse : images/s d'avant, et relevés d'après.
  private check: { before: number; after: number[] } | null = null;
  private adapting = true;
  // Mesure en cours : partie (préparation, combat) et onglet visible.
  private active = false;
  private samples: number[] = [];
  private timer: ReturnType<typeof setInterval>;
  private densityQuery: MediaQueryList | null = null;
  private devBox: HTMLDivElement | null = null;

  // isMeasuring : préparation et combat (ailleurs, chargement ou fin de partie, rien n'est mesuré).
  constructor(
    private engine: Engine,
    private isMeasuring: () => boolean,
  ) {
    const forced = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("dpr")) : NaN;
    this.forced = forced > 0 && forced <= 3 ? forced : null;
    this.updateLevels();
    if (import.meta.env.DEV) {
      this.devBox = document.createElement("div");
      this.devBox.style.cssText =
        "position:fixed;top:8px;right:8px;z-index:9999;padding:6px 10px;background:rgba(0,0,0,.75);color:#fff;font:12px/1.4 monospace;border-radius:4px;pointer-events:none";
      document.body.append(this.devBox);
    }
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private get scale(): number {
    return this.levels[this.level];
  }

  stats(): RenderStats | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      dpr: this.dpr,
      scale: this.scale,
      fps: Math.round(average(this.samples)),
      fpsLow: Math.round(sorted[Math.floor(sorted.length * 0.1)]),
      drops: this.drops,
      reverted: this.reverted,
    };
  }

  dispose() {
    clearInterval(this.timer);
    this.densityQuery?.removeEventListener("change", this.handleDensityChange);
    this.devBox?.remove();
  }

  // Crans de densité pour l'écran courant, en gardant le cran atteint. Une densité trop proche de la précédente ne fait
  // pas un cran (1,1 → 1 n'économise presque rien). La densité change quand la fenêtre passe sur un autre écran ou
  // avec le zoom du navigateur : on la surveille.
  private updateLevels() {
    const start = this.forced ?? Math.min(this.dpr, MAX_SCALE);
    this.levels = [start, ...LOWER_STEPS.filter((step) => step <= start / 1.2)];
    this.level = Math.min(this.level, this.levels.length - 1);
    this.engine.setHardwareScalingLevel(1 / this.scale);
    this.densityQuery?.removeEventListener("change", this.handleDensityChange);
    this.densityQuery = typeof matchMedia === "function" ? matchMedia(`(resolution: ${this.dpr}dppx)`) : null;
    this.densityQuery?.addEventListener("change", this.handleDensityChange);
  }

  private handleDensityChange = () => {
    this.dpr = currentDpr();
    this.check = null;
    this.restartMeasure();
    this.updateLevels();
  };

  private restartMeasure() {
    this.settle = SETTLE_SECONDS;
    this.lowFps = [];
  }

  private setLevel(level: number) {
    this.level = level;
    this.restartMeasure();
    this.engine.setHardwareScalingLevel(1 / this.scale);
  }

  private tick() {
    const fps = this.engine.getFps();
    if (this.devBox) {
      this.devBox.textContent = `densité ${this.scale} (écran ${this.dpr}${this.forced ? ", fixée" : ""}) · rendu ${this.engine.getRenderWidth()}×${this.engine.getRenderHeight()} · ${fps.toFixed(0)} i/s`;
    }
    // Onglet caché : le navigateur ralentit l'affichage, la mesure n'aurait pas de sens. Au retour (ou au début de la
    // partie), les i/s de Babylon sont encore faussés par la pause : on attend avant de mesurer.
    const active = this.isMeasuring() && document.visibilityState === "visible";
    if (active && !this.active) this.restartMeasure();
    this.active = active;
    if (!active || !Number.isFinite(fps)) return;
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    this.samples.push(fps);
    if (this.forced !== null || !this.adapting) return;
    if (this.check) {
      this.check.after.push(fps);
      if (this.check.after.length < CHECK_SECONDS) return;
      if (average(this.check.after) < this.check.before * GAIN) {
        this.reverted = 1;
        this.adapting = false;
        this.setLevel(this.level - 1);
      }
      this.check = null;
      return;
    }
    this.lowFps = fps < MIN_FPS ? [...this.lowFps, fps] : [];
    if (this.lowFps.length >= LOW_SECONDS && this.level + 1 < this.levels.length) {
      this.check = { before: average(this.lowFps), after: [] };
      this.drops++;
      this.setLevel(this.level + 1);
    }
  }
}

function currentDpr(): number {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.round(dpr * 100) / 100;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
