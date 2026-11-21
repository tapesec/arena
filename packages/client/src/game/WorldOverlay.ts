import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ClassId } from "@arena/shared";
import RAMPART_ICON from "../icons/rampart.svg?raw";
import { abilityColor, abilityIcon } from "../abilityBar";

// Durée de vie d'un texte flottant et distance parcourue vers le haut, en pixels.
const TEXT_DURATION = 1.2;
const TEXT_RISE = 45;
// Hauteur au-dessus des pieds où apparaissent textes et indicateurs.
// Au-dessus de la tête des personnages agrandis (2,2 m).
const BADGE_HEIGHT = 2.6;
const INDICATOR_HEIGHT = 3.1;
const TEXT_HEIGHT = 3.35;
// Bulle de parole d'un bot (réponse à un ordre) : durée d'affichage, dont le fondu final, et hauteur de sa pointe.
const BUBBLE_DURATION = 2.5;
const BUBBLE_FADE = 0.4;
const BUBBLE_HEIGHT = 3.5;
// Au-delà, les textes les plus anciens disparaissent (évite d'encombrer l'écran en 8v8).
const MAX_TEXTS = 60;
// Regroupement des textes d'une même tête (décidé le 2026-11-21) : un même texte (Root, Immunisé…) n'est pas répété
// pendant DUPLICATE_WINDOW secondes ; les dégâts (ou soins) non critiques arrivés en MERGE_WINDOW secondes s'additionnent
// en un seul chiffre ; les autres textes s'empilent, chacun sur sa ligne (LINE_HEIGHT pixels), au lieu de se superposer.
const DUPLICATE_WINDOW = 0.5;
const MERGE_WINDOW = 0.35;
const LINE_HEIGHT = 18;
const MAX_LINES = 6;
const AMOUNT = /^([+-])(\d+)$/;

export type FloatingTextStyle = "damageDealt" | "damageTaken" | "heal" | "info" | "control";
// Rempart : icône bleue sur un joueur de son camp, rouge sur un adversaire.
export type StatusIndicator = "mez" | "stun" | "taunt" | "nearSight" | "rampartAlly" | "rampartEnemy";

// Near sight : deux yeux fermés (paupière et cils), dessinés en SVG.
const CLOSED_EYE =
  '<svg viewBox="0 0 24 14" width="22" height="13"><path d="M2 4 Q12 13 22 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
  '<path d="M6 8.2 L4.5 11.5 M12 9.6 L12 13 M18 8.2 L19.5 11.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

interface FloatingText {
  element: HTMLDivElement;
  anchor: TransformNode;
  age: number;
  // Petit décalage horizontal aléatoire, et ligne dans la pile des textes de la même tête (0 en bas).
  offsetX: number;
  line: number;
  text: string;
  style: FloatingTextStyle;
  big: boolean;
  // Montant d'un chiffre de dégâts ou de soin non critique, que les suivants viennent additionner.
  amount: number | null;
}

interface Indicator {
  element: HTMLDivElement;
  anchor: TransformNode;
  kind: StatusIndicator;
}

interface Badge {
  element: HTMLDivElement;
  anchor: TransformNode;
  // Contenu affiché (classe, texte, camp, état), pour ne toucher au DOM que s'il change.
  key: string;
}

// Incantation d'un ennemi, sous son nom (décidé le 2026-11-21) : on voit qui prépare quoi sans le cibler. La progression
// avance localement entre deux mises à jour du serveur (20 par seconde).
interface CastPlate {
  element: HTMLDivElement;
  fill: HTMLDivElement;
  anchor: TransformNode;
  abilityId: string;
  elapsed: number;
  duration: number;
}

interface Bubble {
  element: HTMLDivElement;
  anchor: TransformNode;
  age: number;
}

// Camp d'un joueur vu par le joueur local : son texte au-dessus de la tête est bleu ou rouge.
// « self » : son propre personnage (pseudo doré, avec un chevron au-dessus pour le repérer dans la mêlée).
export type Side = "ally" | "enemy" | "self";
// Marque de la cible du joueur au-dessus de son pseudo : ennemie (rouge), alliée (vert), ou cachée par un obstacle (gris).
export type TargetMark = "enemy" | "ally" | "blocked";

// Couche HTML posée sur le canvas : badges de classe, textes flottants (dégâts, soins…)
// et indicateurs de contrôle au-dessus des têtes. Pilotée par la boucle de jeu, pas par React, pour rester légère.
export class WorldOverlay {
  private texts: FloatingText[] = [];
  private pool: HTMLDivElement[] = [];
  private indicators = new Map<string, Indicator>();
  private badges = new Map<string, Badge>();
  private bubbles = new Map<string, Bubble>();
  private casts = new Map<string, CastPlate>();
  private projected = new Vector3();
  private worldPos = new Vector3();

  constructor(
    private container: HTMLElement,
    private scene: Scene,
  ) {}

  // delay : secondes avant l'apparition (par exemple le temps de vol d'un projectile).
  addText(anchor: TransformNode, text: string, style: FloatingTextStyle, big = false, delay = 0) {
    const age = -delay;
    // Même tête, même moment (un texte qui attend un projectile ne se mêle pas à un texte immédiat).
    const near = (other: FloatingText, window: number) =>
      other.anchor === anchor && other.age < 0 === age < 0 && Math.abs(other.age - age) < window;
    const match = AMOUNT.exec(text);
    if (match && Number(match[2]) === 0) return;
    const amount = match && !big ? Number(match[2]) : null;
    if (amount !== null) {
      // Un chiffre du même genre vient d'apparaître sur cette tête : on l'additionne.
      const merged = this.texts.find((other) => other.amount !== null && other.style === style && near(other, MERGE_WINDOW));
      if (merged) {
        merged.amount! += amount;
        merged.text = `${match![1]}${merged.amount}`;
        merged.element.textContent = merged.text;
        return;
      }
    } else if (!match && this.texts.some((other) => other.text === text && other.style === style && near(other, DUPLICATE_WINDOW))) {
      // Un même libellé (Root, Immunisé…) ne se répète pas ; un critique de même valeur, lui, s'affiche.
      return;
    }
    if (this.texts.length >= MAX_TEXTS) this.recycle(this.texts.shift()!);
    // Première ligne où le texte ne recouvre aucun texte de cette tête, compte tenu de leur montée.
    const rise = (other: FloatingText) => (Math.max(0, other.age) / TEXT_DURATION) * TEXT_RISE + other.line * LINE_HEIGHT;
    const neighbours = this.texts.filter((other) => other.anchor === anchor).map(rise);
    const start = (Math.max(0, age) / TEXT_DURATION) * TEXT_RISE;
    let line = 0;
    while (line < MAX_LINES && neighbours.some((y) => Math.abs(y - (start + line * LINE_HEIGHT)) < LINE_HEIGHT)) line++;
    const element = this.pool.pop() ?? document.createElement("div");
    element.className = `float-text float-${style}${big ? " float-big" : ""}`;
    element.textContent = text;
    this.container.appendChild(element);
    element.style.opacity = "0";
    this.texts.push({ element, anchor, age, offsetX: (Math.random() - 0.5) * 24, line, text, style, big, amount });
  }

  // Affiche (ou retire, avec null) l'indicateur de contrôle d'un joueur.
  setIndicator(playerId: string, anchor: TransformNode, kind: StatusIndicator | null) {
    // Un indicateur (Zzz, étoiles, !!!…) prend la place du chevron (de son propre personnage ou de la cible), juste au-dessus
    // du pseudo.
    this.badges.get(playerId)?.element.classList.toggle("nameplate-has-indicator", !!kind);
    const current = this.indicators.get(playerId);
    if (current?.kind === kind) return;
    current?.element.remove();
    this.indicators.delete(playerId);
    if (!kind) return;

    const element = document.createElement("div");
    element.className = `status-indicator status-${kind}${kind.startsWith("rampart") ? " status-rampart" : ""}`;
    // Chaque lettre ou étoile est un élément à part, pour pouvoir l'animer en décalé.
    if (kind === "rampartAlly" || kind === "rampartEnemy") {
      // Protégé par le Rempart : l'icône du sort (une tour crénelée).
      const span = document.createElement("span");
      span.innerHTML = RAMPART_ICON;
      element.appendChild(span);
    } else if (kind === "nearSight") {
      for (let i = 0; i < 2; i++) {
        const span = document.createElement("span");
        span.innerHTML = CLOSED_EYE;
        element.appendChild(span);
      }
    } else {
      const symbols = { mez: ["Z", "z", "z"], stun: ["★", "★", "★"], taunt: ["!", "!", "!"] }[kind];
      for (const symbol of symbols) {
        const span = document.createElement("span");
        span.textContent = symbol;
        element.appendChild(span);
      }
    }
    this.container.appendChild(element);
    this.indicators.set(playerId, { element, anchor, kind });
  }

  // Au-dessus de la tête : un texte coloré selon le camp (le pseudo d'un allié, la classe d'un ennemi).
  setBadge(playerId: string, anchor: TransformNode, classId: ClassId | "", label: string, side: Side, alive: boolean, target: TargetMark | null = null) {
    const key = `${classId}|${label}|${side}|${alive}|${target}`;
    const current = this.badges.get(playerId);
    if (current?.key === key) return;
    current?.element.remove();
    this.badges.delete(playerId);
    if (!classId) return;

    const element = document.createElement("div");
    element.className = `nameplate nameplate-${side}${alive ? "" : " nameplate-dead"}`;
    // Chevron : celui de la cible (plus gros, animé, à sa couleur), sinon celui de son propre personnage (doré, fixe).
    if (alive && (target || side === "self")) {
      const chevron = document.createElement("span");
      chevron.className = target ? `nameplate-chevron nameplate-target nameplate-target-${target}` : "nameplate-chevron";
      chevron.textContent = "▼";
      element.append(chevron);
    }
    const text = document.createElement("span");
    text.className = "nameplate-label";
    text.textContent = label;
    element.append(text);
    this.container.appendChild(element);
    this.badges.set(playerId, { element, anchor, key });
  }

  // Affiche (ou retire, avec un abilityId vide) l'incantation d'un joueur sous son nom.
  setCast(playerId: string, anchor: TransformNode, abilityId: string, elapsed: number, duration: number) {
    const current = this.casts.get(playerId);
    if (!abilityId || duration <= 0) {
      current?.element.remove();
      this.casts.delete(playerId);
      return;
    }
    if (current?.abilityId === abilityId) {
      // Recalage sur le serveur s'il est en avance, ou nettement en retard (nouvelle incantation du même sort).
      // Une valeur proche de zéro alors que la barre est avancée : le sort a été relancé.
      if (elapsed > current.elapsed || elapsed < current.elapsed - 0.3 || (elapsed < 0.1 && current.elapsed > 0.2)) {
        current.elapsed = elapsed;
      }
      current.duration = duration;
      return;
    }
    current?.element.remove();
    const element = document.createElement("div");
    element.className = "world-cast";
    const icon = document.createElement("span");
    icon.className = "world-cast-icon";
    icon.style.color = abilityColor(abilityId);
    const svg = abilityIcon(abilityId);
    if (svg) icon.innerHTML = svg;
    else icon.style.display = "none";
    const bar = document.createElement("div");
    bar.className = "world-cast-bar";
    const fill = document.createElement("div");
    fill.className = "world-cast-fill";
    fill.style.background = abilityColor(abilityId);
    bar.append(fill);
    element.append(icon, bar);
    this.container.appendChild(element);
    this.casts.set(playerId, { element, fill, anchor, abilityId, elapsed, duration });
  }

  // Bulle de parole au-dessus d'un joueur (un bot qui répond à un ordre, ou l'ordre lui-même au-dessus du joueur) :
  // elle remplace la précédente.
  say(playerId: string, anchor: TransformNode, text: string) {
    this.bubbles.get(playerId)?.element.remove();
    const element = document.createElement("div");
    element.className = "speech-bubble";
    element.textContent = text;
    element.style.opacity = "0";
    this.container.appendChild(element);
    this.bubbles.set(playerId, { element, anchor, age: 0 });
  }

  // Les textes rattachés à un joueur disparu sont retirés à la prochaine mise à jour.
  removePlayer(playerId: string) {
    this.indicators.get(playerId)?.element.remove();
    this.indicators.delete(playerId);
    this.badges.get(playerId)?.element.remove();
    this.badges.delete(playerId);
    this.bubbles.get(playerId)?.element.remove();
    this.bubbles.delete(playerId);
    this.casts.get(playerId)?.element.remove();
    this.casts.delete(playerId);
  }

  update(dt: number) {
    for (const text of [...this.texts]) {
      text.age += dt;
      if (text.age >= TEXT_DURATION || text.anchor.isDisposed()) {
        this.removeText(text);
        continue;
      }
      if (text.age < 0) continue;
      const progress = text.age / TEXT_DURATION;
      const screen = this.toScreen(text.anchor, TEXT_HEIGHT);
      if (!screen) {
        text.element.style.opacity = "0";
        continue;
      }
      text.element.style.transform =
        `translate(${screen.x + text.offsetX}px, ${screen.y - progress * TEXT_RISE - text.line * LINE_HEIGHT}px) translate(-50%, -50%)`;
      // Pleinement visible, puis s'estompe sur le dernier tiers.
      text.element.style.opacity = String(progress < 0.66 ? 1 : 1 - (progress - 0.66) / 0.34);
    }

    for (const indicator of this.indicators.values()) {
      const screen = this.toScreen(indicator.anchor, INDICATOR_HEIGHT);
      indicator.element.style.opacity = screen ? "1" : "0";
      if (screen) indicator.element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
    }

    for (const badge of this.badges.values()) {
      const screen = this.toScreen(badge.anchor, BADGE_HEIGHT);
      badge.element.style.display = screen ? "" : "none";
      if (screen) badge.element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
    }

    for (const cast of this.casts.values()) {
      cast.elapsed = Math.min(cast.duration, cast.elapsed + dt);
      const screen = this.toScreen(cast.anchor, BADGE_HEIGHT);
      cast.element.style.display = screen ? "" : "none";
      if (!screen) continue;
      // Juste sous le nom.
      cast.element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, 0) translateY(10px)`;
      cast.fill.style.width = `${(cast.elapsed / cast.duration) * 100}%`;
    }

    for (const [playerId, bubble] of this.bubbles) {
      bubble.age += dt;
      if (bubble.age >= BUBBLE_DURATION || bubble.anchor.isDisposed()) {
        bubble.element.remove();
        this.bubbles.delete(playerId);
        continue;
      }
      const screen = this.toScreen(bubble.anchor, BUBBLE_HEIGHT);
      const fade = Math.min(1, (BUBBLE_DURATION - bubble.age) / BUBBLE_FADE);
      bubble.element.style.opacity = screen ? String(fade) : "0";
      // La pointe de la bulle est au-dessus de la tête.
      if (screen) bubble.element.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%) translateY(-8px)`;
    }
  }

  dispose() {
    for (const text of this.texts) text.element.remove();
    for (const indicator of this.indicators.values()) indicator.element.remove();
    for (const badge of this.badges.values()) badge.element.remove();
    for (const bubble of this.bubbles.values()) bubble.element.remove();
    this.bubbles.clear();
    for (const cast of this.casts.values()) cast.element.remove();
    this.casts.clear();
    this.texts = [];
    this.indicators.clear();
    this.badges.clear();
  }

  // Position à l'écran (en pixels CSS) d'un point situé à "height" au-dessus de l'ancre, ou null s'il est hors champ.
  private toScreen(anchor: TransformNode, height: number): { x: number; y: number } | null {
    const camera = this.scene.activeCamera;
    if (!camera) return null;
    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const renderHeight = engine.getRenderHeight();
    this.worldPos.copyFrom(anchor.getAbsolutePosition());
    this.worldPos.y += height;
    Vector3.ProjectToRef(
      this.worldPos,
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(width, renderHeight),
      this.projected,
    );
    if (this.projected.z < 0 || this.projected.z > 1) return null;
    // Le canvas peut être rendu à une résolution différente de sa taille affichée.
    const canvas = engine.getRenderingCanvas()!;
    return {
      x: (this.projected.x * canvas.clientWidth) / width,
      y: (this.projected.y * canvas.clientHeight) / renderHeight,
    };
  }

  private removeText(text: FloatingText) {
    this.texts = this.texts.filter((t) => t !== text);
    this.recycle(text);
  }

  // Les éléments sont réutilisés plutôt que recréés à chaque texte.
  private recycle(text: FloatingText) {
    text.element.remove();
    this.pool.push(text.element);
  }
}
