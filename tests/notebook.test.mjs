import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { resizeInNotebook, outsideNotebook } from "../app/notebook-geometry.ts";

test("notebook resize converts rotated gestures into physical dimensions and respects aspect lock", () => {
  assert.deepEqual(resizeInNotebook(60, 40, 30, 20, 0, true), { width: 90, height: 60 });
  assert.deepEqual(resizeInNotebook(60, 40, -20, 30, 90, true), { width: 90, height: 60 });
  assert.deepEqual(resizeInNotebook(60, 40, 30, 0, 0, false), { width: 90, height: 40 });
  const small = resizeInNotebook(60, 40, -1000, -1000, 0, true);
  assert.deepEqual(small, { width: 15, height: 10 });
  const large = resizeInNotebook(60, 40, 1000, 1000, 0, true);
  assert.equal(large.width, 400);
  assert.ok(large.height <= 400);
});

test("page overflow accounts for photo rotation and measured book dimensions", () => {
  assert.equal(outsideNotebook(74, 105, 70, 50, 0, 148, 210), false);
  assert.equal(outsideNotebook(20, 105, 70, 50, 0, 148, 210), true);
  assert.equal(outsideNotebook(74, 105, 180, 70, 0, 148, 210), true);
  assert.equal(outsideNotebook(74, 105, 180, 70, 90, 148, 210), false);
  assert.equal(outsideNotebook(74, 105, 180, 70, 45, 148, 210), true);
});

test("notebook size edits update the same photo model used by printing and create an undo step", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  function resizeForNotebook(");
  const end = source.indexOf("\n  return (", start);
  const original = [{ id: "a", widthMm: 70, heightMm: 50, quantity: 2, crop: { x: 0.1 } }, { id: "b", widthMm: 30, heightMm: 40 }];
  let next = original;
  let undoCount = 0;
  const context = vm.createContext({ photosRef: { current: original }, roundMm: (value) => Math.round(value * 10) / 10,
    rememberForUndo: () => { undoCount += 1; }, setPhotos: (update) => { next = update(next); }, setMessage() {},
  });
  vm.runInContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.resizeForNotebook("a", 90, 60);
  assert.equal(next[0].widthMm, 90);
  assert.equal(next[0].heightMm, 60);
  assert.equal(next[0].quantity, 2);
  assert.equal(next[0].crop, original[0].crop);
  assert.equal(next[1], original[1]);
  assert.equal(undoCount, 1);
  context.resizeForNotebook("a", NaN, 60);
  context.resizeForNotebook("a", 900, 60);
  assert.equal(undoCount, 1);
});
