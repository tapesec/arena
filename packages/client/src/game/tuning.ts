import { normalizeTuning } from "./abilityAnimations";
import animationTuning from "./animationTuning.json";

// Réglages des compétences (animationTuning.json, page animation-lab.html), au format actuel même si le fichier
// contient encore des réglages à l'ancien format (une seule animation).
export const TUNING = normalizeTuning(animationTuning);
