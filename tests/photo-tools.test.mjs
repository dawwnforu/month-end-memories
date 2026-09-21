import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { duplicateGroups, uniquePhotos, fingerprintImage } from "../app/photo-tools.ts";

test("packing emits each requested copy exactly once across multiple pages and rotations", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const packing = source.slice(source.indexOf("type Photo ="), source.indexOf("function loadBrowserImage"));
  const context = vm.createContext({});
  vm.runInContext(ts.transpileModule(packing, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  for (const allowRotation of [true, false]) {
    for (const [width, height] of [[210, 297], [297, 210]]) {
      const photos = Array.from({ length: 50 }, (_, i) => ({ id: `photo-${i}`, widthMm: 30 + i, heightMm: 40 + i, quantity: i % 3 + 1, manualRotation: i % 2 === 0 }));
      const layout = context.calculateLayout(photos, { margin: 5, gap: 2, allowRotation }, width, height);
      const keys = layout.pages.flatMap((page) => Array.from(page.placements, (p) => p.key));
      assert.ok(layout.pages.length > 1);
      assert.equal(layout.unplaced.length, 0);
      assert.equal(keys.length, photos.reduce((sum, p) => sum + p.quantity, 0));
      assert.equal(new Set(keys).size, keys.length);
    }
  }
});

test("content identity survives renaming; cleanup preserves first photo and intentional copies", () => {
  const first = { id: "a", name: "first.png", fingerprint: "pixels-a", quantity: 3, crop: { x: 0.1 } };
  const renamed = { id: "b", name: "renamed.png", fingerprint: "pixels-a", quantity: 1 };
  const sameName = { id: "c", name: "first.png", fingerprint: "pixels-b", quantity: 1 };
  const photos = [first, renamed, sameName];
  assert.deepEqual(duplicateGroups(photos), [[first, renamed]]);
  assert.deepEqual(uniquePhotos(photos), [first, sameName]);
  assert.equal(uniquePhotos(photos)[0], first);
  assert.equal(photos.length, 3); // Undo snapshot is untouched.
  assert.deepEqual(uniquePhotos([renamed, { ...renamed, id: "d" }]), [renamed]);
  assert.deepEqual(uniquePhotos([]), []);
});

test("decoded pixels detect metadata-only changes without merging different pixels or dimensions", async () => {
  const originalDocument = globalThis.document;
  let pixels;
  globalThis.document = { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage: (image) => { pixels = image.pixels; }, getImageData: () => ({ data: pixels }) }),
  }) };
  try {
    const image = { naturalWidth: 2, naturalHeight: 1, pixels: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) };
    const hash = await fingerprintImage(image);
    assert.equal(await fingerprintImage({ ...image, metadata: "different filename and EXIF" }), hash);
    assert.notEqual(await fingerprintImage({ ...image, naturalWidth: 1, naturalHeight: 2 }), hash);
    assert.notEqual(await fingerprintImage({ ...image, pixels: new Uint8ClampedArray(8) }), hash);
  } finally { globalThis.document = originalDocument; }
});
