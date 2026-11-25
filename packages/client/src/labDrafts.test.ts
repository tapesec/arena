import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFileChanges, rebaseDraft, sortedKeys } from "./labDrafts";

test("brouillon repris : ses changements restent, ceux du fichier arrivent ailleurs", () => {
  const base = { a: 1, b: 2, c: 3 };
  const draft = { a: 10, b: 2, c: 3 };
  // Depuis : Claude a modifié b, supprimé c et ajouté d dans le fichier.
  const file = { a: 1, b: 20, d: 4 };
  assert.deepEqual(rebaseDraft({ base, draft }, file), { a: 10, b: 20, d: 4 });
  // Le brouillon l'emporte sur un élément qu'il a lui-même modifié.
  assert.deepEqual(rebaseDraft({ base, draft }, { ...file, a: 5 }), { a: 10, b: 20, d: 4 });
  // Sans brouillon : le fichier tel quel.
  assert.equal(rebaseDraft(null, file), file);
});

test("fichier relu : les changements arrivent dans la version enregistrée et dans le brouillon non modifié", () => {
  const saved = { a: 1, b: 2 };
  const draft = { a: 10, b: 2 };
  assert.equal(mergeFileChanges(saved, draft, { a: 1, b: 2 }), null);
  // Un élément retiré du fichier n'est pas retiré pendant qu'on règle (seulement à l'enregistrement).
  assert.equal(mergeFileChanges(saved, draft, { a: 1 }), null);
  assert.deepEqual(mergeFileChanges(saved, draft, { a: 5, b: 3, c: 7 }), {
    saved: { a: 5, b: 3, c: 7 },
    draft: { a: 10, b: 3, c: 7 },
  });
});

test("clés triées", () => {
  assert.deepEqual(Object.keys(sortedKeys({ b: 1, a: 2, c: 3 })), ["a", "b", "c"]);
});
