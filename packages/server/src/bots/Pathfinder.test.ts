import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAYER_RADIUS, START_ZONES, directionToInput, hasClearPath, inputToDirection, type Position } from "@arena/shared";
import { Pathfinder } from "./Pathfinder";

const pathfinder = new Pathfinder();

// Chaque tronçon du chemin doit être praticable par un personnage.
function assertWalkable(from: Position, path: Position[]) {
  let previous = from;
  for (const point of path) {
    assert.ok(hasClearPath(previous, point, PLAYER_RADIUS), `tronçon bloqué vers (${point.x}, ${point.z})`);
    previous = point;
  }
}

describe("Recherche de chemin", () => {
  it("va tout droit quand rien ne bloque", () => {
    // Zone ouverte de l'arène, autour de (37, 10).
    const path = pathfinder.findPath({ x: 38, z: 5 }, { x: 38, z: -5 });
    assert.deepEqual(path, [{ x: 38, z: -5 }]);
  });

  it("contourne une maison", () => {
    // Grande maison du hameau, en (14, 14) sur 8 × 8 m : le trajet direct la traverse.
    const from = { x: 8, z: 14 };
    const to = { x: 20, z: 14 };
    const path = pathfinder.findPath(from, to)!;
    assert.ok(path.length >= 2);
    assertWalkable(from, path);
    assert.deepEqual(path.at(-1), to);
  });

  it("relie les deux zones de départ", () => {
    const from = START_ZONES[0];
    const to = START_ZONES[1];
    const path = pathfinder.findPath(from, to)!;
    assert.ok(path, "aucun chemin trouvé");
    assertWalkable(from, path);
  });
});

describe("Conversion direction → commande", () => {
  it("oriente le personnage dans la direction voulue et le fait avancer", () => {
    const input = directionToInput({ x: 1, z: 0 });
    assert.ok(input.up && input.steer);
    assert.ok(Math.abs(input.yaw! - Math.PI / 2) < 1e-9);
  });

  it("la caméra libre du spectateur suit l'orientation de la caméra", () => {
    // Caméra tournée (yaw = 0) : "haut" de l'écran = +z, "droite" = +x.
    const up = inputToDirection({ up: true, down: false, left: false, right: false, yaw: 0 });
    const right = inputToDirection({ up: false, down: false, left: false, right: true, yaw: 0 });
    assert.ok(Math.abs(up.x) < 1e-9 && Math.abs(up.z - 1) < 1e-9);
    assert.ok(Math.abs(right.x - 1) < 1e-9 && Math.abs(right.z) < 1e-9);
  });
});
