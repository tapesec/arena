import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

// En production, le serveur de jeu sert aussi la page du jeu (client construit par `npm run build`) : une seule adresse
// pour la page et les parties. CLIENT_DIST permet de pointer ailleurs (chemin absolu, ou relatif à packages/server :
// `npm start` y lance le serveur).
export const CLIENT_DIST = resolve(process.env.CLIENT_DIST ?? fileURLToPath(new URL("../../client/dist", import.meta.url)));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".bin": "application/octet-stream",
};

// Le chemin est dans le dossier root (ou est le dossier lui-même).
function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

// Fichier demandé par l'adresse (la racine donne index.html), ou null s'il sort du dossier root ou vise un fichier
// caché (.env, .DS_Store…).
export function clientFile(urlPath: string, root = CLIENT_DIST): string | null {
  let path: string;
  try {
    path = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(root, `.${path}`);
  if (!inside(root, file)) return null;
  if (file.slice(root.length).split(sep).some((part) => part.startsWith("."))) return null;
  return file;
}

// Intergiciel (express) qui sert les fichiers du dossier root et laisse passer le reste (requêtes de Colyseus).
// Validation de cache (Last-Modified, ETag : réponse 304 si le navigateur a déjà la bonne version) ; les fichiers de
// Vite portent une empreinte dans leur nom (assets/) et ne changent jamais.
export function createClientServer(root = CLIENT_DIST) {
  let realRoot: Promise<string> | null = null;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const file = clientFile(req.url ?? "/", root);
    if (!file) return next();
    realRoot ??= realpath(root).catch(() => root);
    void (async () => {
      // Un lien symbolique ne doit pas mener hors du dossier.
      const [base, real] = await Promise.all([realRoot!, realpath(file)]);
      if (!inside(base, real)) return next();
      const info = await stat(real);
      if (!info.isFile()) return next();
      const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      const lastModified = new Date(Math.floor(info.mtimeMs / 1000) * 1000).toUTCString();
      res.setHeader("Content-Type", CONTENT_TYPES[extname(real).toLowerCase()] ?? "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("ETag", etag);
      res.setHeader("Last-Modified", lastModified);
      res.setHeader("Cache-Control", inside(resolve(root, "assets"), file) ? "public, max-age=31536000, immutable" : "no-cache");
      const since = req.headers["if-modified-since"];
      const fresh =
        req.headers["if-none-match"] === etag ||
        (!req.headers["if-none-match"] && !!since && Date.parse(since) >= Date.parse(lastModified));
      if (fresh) {
        res.statusCode = 304;
        return res.end();
      }
      res.setHeader("Content-Length", info.size);
      if (req.method === "HEAD") return res.end();
      // pipeline ferme le fichier si le joueur part en cours de route, et une erreur de lecture (build relancé pendant
      // que le serveur tourne) ne fait pas tomber le serveur.
      pipeline(createReadStream(real), res, () => {});
    })().catch(() => {
      if (!res.headersSent) next();
      else res.destroy();
    });
  };
}
