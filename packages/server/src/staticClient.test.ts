import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CLIENT_DIST, clientFile, createClientServer } from "./staticClient";

test("production : les adresses mènent aux fichiers du client, et jamais en dehors ni vers un fichier caché", () => {
  assert.equal(clientFile("/"), join(CLIENT_DIST, "index.html"));
  assert.equal(clientFile("/assets/index-abc.js?v=1"), join(CLIENT_DIST, "assets/index-abc.js"));
  assert.equal(clientFile("/sounds/tuned/epee%201.m4a"), join(CLIENT_DIST, "sounds/tuned/epee 1.m4a"));
  assert.equal(clientFile("/../package.json"), null);
  assert.equal(clientFile("/%2e%2e/%2e%2e/etc/passwd"), null);
  assert.equal(clientFile("/%E0%A4%A"), null);
  assert.equal(clientFile("/.env"), null);
  assert.equal(clientFile("/sounds/%00x"), null);
});

// Petit serveur HTTP qui sert un faux client, comme en production.
let root = "";
let outside = "";
let server: Server;
let base = "";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "arena-client-"));
  outside = await mkdtemp(join(tmpdir(), "arena-outside-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<html>jeu</html>");
  await writeFile(join(root, "assets", "index-abc.js"), "console.log(1)");
  await writeFile(join(root, ".env"), "SECRET=1");
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(join(outside, "secret.txt"), join(root, "lien.txt"));
  const serve = createClientServer(root);
  server = createServer((req, res) =>
    serve(req, res, () => {
      res.statusCode = 404;
      res.end("suite");
    }),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("production : la page est servie avec son type et une validation de cache (304)", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(page.headers.get("cache-control"), "no-cache");
  assert.equal(await page.text(), "<html>jeu</html>");
  const again = await fetch(`${base}/`, { headers: { "If-None-Match": page.headers.get("etag")! } });
  assert.equal(again.status, 304);
  const asset = await fetch(`${base}/assets/index-abc.js`, { method: "HEAD" });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control")!, /immutable/);
});

test("production : fichier absent, caché ou lien vers l'extérieur → la requête passe à la suite (Colyseus)", async () => {
  for (const path of ["/absent.js", "/.env", "/lien.txt", "/assets/", "/matchmake/joinOrCreate/arena"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), "suite", path);
  }
});
