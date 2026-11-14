import manifest from "./assets-manifest.json";

// Adresse des assets (modèles, sons, musique), désignés par leur chemin dans public/ (« models/characters/lame.glb »).
// En développement, Vite les sert depuis public/. En production, scripts/deploy-assets.ts les envoie dans le bucket
// servi par Cloudflare sous un nom à empreinte (« lame.3f9a…glb », mis en cache pour toujours) et note la
// correspondance dans assets-manifest.json ; un asset absent du manifeste est demandé au serveur du jeu.
// (import.meta.env n'existe que sous Vite : ce module est aussi chargé par le script de déploiement, sous Node.)
const ASSETS_BASE: string = (import.meta.env?.VITE_ASSETS_URL ?? "https://assets.winorwipe.com/").replace(/\/?$/, "/");
const FILES: Readonly<Record<string, string>> = manifest;

export function assetUrl(path: string): string {
  const published = import.meta.env?.DEV ? undefined : FILES[path];
  return published ? ASSETS_BASE + encodePath(published) : `/${encodePath(path)}`;
}

// Chaque segment est encodé (noms de sons avec espaces ou caractères spéciaux), pas les « / ».
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
