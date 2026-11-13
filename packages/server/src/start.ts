// Lancement en production (`npm start`), sous macOS, Linux ou Windows : NODE_ENV est posé avant de charger le serveur,
// qui le lit au chargement (les commandes réservées au développement sont refusées).
import { activeOverrides } from "./settings";

process.env.NODE_ENV = "production";
const overrides = activeOverrides();
if (overrides.length > 0) console.warn(`Attention, réglages de test actifs en production : ${overrides.join(", ")}.`);
await import("./index");
