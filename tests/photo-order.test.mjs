import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { orderPhotos, distanceMeters } from "../app/photo-order.ts";

test("smart ordering groups nearby A-B-A, preserving day/time boundaries and unknown metadata", () => {
  const a = { id: "a", takenAt: "2026-09-20T10:00:00", latitude: 31, longitude: 121 };
  const b = { ...a, id: "b", takenAt: "2026-09-20T10:15:00", latitude: 32 };
  const a2 = { ...a, id: "a2", takenAt: "2026-09-20T10:30:00", latitude: 31.0001 };
  const late = { ...a, id: "late", takenAt: "2026-09-20T20:30:00" };
  const nextDay = { ...a, id: "next", takenAt: "2026-09-21T10:30:00" };
  const unknown = { id: "unknown" };
  const photos = [a, b, a2, late, nextDay, unknown];
  assert.deepEqual(orderPhotos(photos, "smart").map(p => p.id), ["a", "a2", "b", "late", "next", "unknown"]);
  assert.deepEqual(orderPhotos(photos, "location").map(p => p.id), ["a", "a2", "late", "next", "b", "unknown"]);
  assert.deepEqual(orderPhotos(photos, "newest").map(p => p.id), ["next", "late", "a2", "b", "a", "unknown"]);
  assert.equal(orderPhotos(photos, "import"), photos);
  assert.ok(distanceMeters(a, a2) < 30);
});

test("320 photos: strict columns preserve order, orientation, bounds, copies and centred alignment", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const packing = source.slice(source.indexOf("type Photo ="), source.indexOf("function loadBrowserImage"));
  const context = vm.createContext({});
  vm.runInContext(ts.transpileModule(packing, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const photos = Array.from({ length: 320 }, (_, i) => ({ id: `photo-${i}`, widthMm: 30 + i % 40, heightMm: 40 + i % 60, quantity: i % 10 === 0 ? 2 : 1, manualRotation: false }));
  for (const strictColumns of [false, true]) {
    const start = performance.now();
    const layout = context.calculateLayout(photos, { margin: 5, gap: 2, allowRotation: false, strictColumns, columns: 2, sortingEnabled: true, photoOrder: "smart" }, 210, 297);
    const placements = Array.from(layout.pages).flatMap(page => Array.from(page.placements));
    assert.deepEqual(placements.map(p => p.photoId), photos.flatMap(p => Array(p.quantity).fill(p.id)));
    assert.equal(layout.unplaced.length, 0);
    for (const page of layout.pages) {
      for (const p of page.placements) {
        assert.equal(p.rotated, false);
        assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.width <= 200.001 && p.y + p.height <= 287.001);
        if (strictColumns) assert.ok([49.5, 150.5].some(center => Math.abs(p.x + p.width / 2 - center) < 0.001));
        for (const other of page.placements) if (other !== p) assert.ok(p.x + p.width <= other.x + 0.001 || other.x + other.width <= p.x + 0.001 || p.y + p.height <= other.y + 0.001 || other.y + other.height <= p.y + 0.001);
      }
    }
    console.log(`320-photo ${strictColumns ? "columns" : "ordered rows"}: ${layout.pages.length} pages, ${(performance.now() - start).toFixed(1)} ms`);
  }
  const oversized = context.calculateLayout([{ ...photos[0], widthMm: 150 }], { margin: 5, gap: 2, allowRotation: false, strictColumns: true, columns: 2 }, 210, 297);
  assert.equal(oversized.unplaced.length, 2);
});
