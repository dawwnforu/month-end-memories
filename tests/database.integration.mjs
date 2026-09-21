import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.PHOTO_TEST_URL || "http://localhost:3000";
const token = randomBytes(32).toString("hex");
const other = randomBytes(32).toString("hex");
const call = (method, body, suffix = "", owner = token) => fetch(`${base}/api/photos${suffix}`, { method, headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const rows = Array.from({ length: 320 }, (_, i) => ({ id: `test-${i}`, name: `photo-${i}.jpg`, fingerprint: `hash-${i}`, takenAt: `2026-09-${String(i % 20 + 1).padStart(2, "0")}T12:30:00`, latitude: 31.234567, longitude: 121.345678, naturalWidth: 4000, naturalHeight: 3000, widthMm: 70.1, heightMm: 52.6, quantity: 1, edits: JSON.stringify({ crop: { x: 0, y: 0, width: 1, height: 1 } }) }));
try {
  const started = performance.now();
  const saved = await call("PUT", rows);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await saved.json()).saved, 320);
  const loaded = await (await call("GET")).json();
  assert.equal(loaded.photos.length, 320);
  assert.equal(loaded.photos[0].widthMm, 70.1);
  assert.equal(loaded.photos[0].latitude, 31.234567);
  assert.ok(!("workspace" in loaded.photos[0]) && !("src" in loaded.photos[0]));
  const filtered = await (await call("GET", undefined, "?from=2026-09-10&to=2026-09-12&sort=newest")).json();
  assert.equal(filtered.photos.length, 48);
  assert.equal(filtered.photos[0].takenAt, "2026-09-12T12:30:00");
  assert.deepEqual((await (await call("GET", undefined, "", other)).json()).photos, []);
  assert.equal((await call("PUT", [{ ...rows[0], latitude: 999 }])).status, 400);
  assert.equal((await call("PUT", [rows[0], rows[0]])).status, 400);
  assert.equal((await (await call("GET")).json()).photos.length, 320);
  assert.equal((await fetch(`${base}/api/photos`)).status, 401);
  console.log(`Database: 320 records, exact dimensions/GPS, indexed date query, workspace isolation and invalid-write preservation passed in ${(performance.now() - started).toFixed(0)} ms`);
} finally { assert.equal((await call("PUT", [])).status, 200); }
