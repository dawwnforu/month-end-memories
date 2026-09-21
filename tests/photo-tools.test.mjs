import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { duplicateGroups, uniquePhotos, fingerprintImage, originalPhotoName, suspectedDuplicateGroups } from "../app/photo-tools.ts";

test("export timestamps reveal suspected duplicates without automatically deleting different pixels", () => {
  const first = { name: "MVIMG_20260829_165518_44_2026-09-20_17-07-31_696.jpg", fingerprint: "a" };
  const second = { name: "MVIMG_20260829_165518_44_2026-09-20_21-26-33_510.jpg", fingerprint: "b" };
  const different = { name: "MVIMG_20260829_165519_44_2026-09-20_21-26-33_510.jpg", fingerprint: "c" };
  assert.equal(originalPhotoName(first.name), originalPhotoName(second.name));
  assert.deepEqual(suspectedDuplicateGroups([first, second, different]), [[first, second]]);
  assert.deepEqual(uniquePhotos([first, second]), [first, second]);
  assert.deepEqual(suspectedDuplicateGroups([first, { ...second, fingerprint: "a" }]), []);
  assert.equal(originalPhotoName("photo (1).PNG"), originalPhotoName("photo.png"));
  assert.notEqual(originalPhotoName("IMG_20260829_165518.jpg"), originalPhotoName("IMG_20260829_165519.jpg"));
});

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

test("manual suspected-group cleanup retains the first photo, unrelated photos and an undo snapshot", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const implementation = source.slice(source.indexOf("  function removeDuplicates("), source.indexOf("  function rememberForUndo("));
  const first = { id: "a", fingerprint: "a", quantity: 2 };
  const extra = { id: "b", fingerprint: "b", quantity: 1 };
  const other = { id: "c", fingerprint: "c", quantity: 1 };
  const original = [first, extra, other];
  let undo;
  let updated;
  const context = vm.createContext({
    photosRef: { current: original }, uniquePhotos,
    rememberForUndo: () => { undo = [...context.photosRef.current]; },
    setPhotos: (next) => { updated = next; },
    setSelectedPlacementKey() {}, setCropEditor() {}, setMessage() {},
  });
  vm.runInContext(ts.transpileModule(implementation, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.removeDuplicates([first, extra]);
  assert.deepEqual(updated, [first, other]);
  assert.deepEqual(undo, original);
  assert.equal(updated[0].quantity, 2);
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
