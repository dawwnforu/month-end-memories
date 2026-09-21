import assert from "node:assert/strict";
import test from "node:test";
import { captureDate, readMetadata, archivePaths } from "../app/photo-batch.ts";
import { gpsExif, jpegWithExif } from "./exif-fixture.mjs";
import { zipSync, unzipSync } from "fflate";

test("GPS preserves hemisphere and rational precision in both byte orders; damaged GPS keeps time", () => {
  for (const little of [true, false]) {
    const exif = gpsExif({ latitude: -31.234567, longitude: -121.765432, little });
    const metadata = readMetadata(jpegWithExif([255, 216, 255, 217], exif));
    assert.ok(Math.abs(metadata.latitude + 31.234567) < 0.000001);
    assert.ok(Math.abs(metadata.longitude + 121.765432) < 0.000001);
    assert.equal(metadata.takenAt, "2026-09-20T10:00:00");
    new DataView(exif.buffer).setUint32(114, 0, little);
    const broken = readMetadata(jpegWithExif([255, 216, 255, 217], exif));
    assert.equal(broken.latitude, null);
    assert.equal(broken.takenAt, "2026-09-20T10:00:00");
  }
});

function exif(little, date = "2026:08:31 12:21:25") {
  const bytes = new Uint8Array(64);
  const v = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(little ? "II" : "MM"));
  const u16 = (at, value) => v.setUint16(at, value, little);
  const u32 = (at, value) => v.setUint32(at, value, little);
  u16(2, 42); u32(4, 8); u16(8, 1);
  u16(10, 0x8769); u16(12, 4); u32(14, 1); u32(18, 26);
  u16(26, 1); u16(28, 0x9003); u16(30, 2); u32(32, 20); u32(36, 44);
  bytes.set(new TextEncoder().encode(date), 44);
  return bytes;
}
function jpeg(data) {
  return Uint8Array.from([255, 216, 255, 225, 0, data.length + 8, 69, 120, 105, 102, 0, 0, ...data, 255, 217]);
}
test("capture time reads genuine EXIF in JPEG, PNG and WebP, rejects invalid metadata", () => {
  for (const little of [true, false]) {
    const data = exif(little);
    const png = new Uint8Array(20 + data.length);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(png.buffer).setUint32(8, data.length);
    png.set(new TextEncoder().encode("eXIf"), 12); png.set(data, 16);
    const webp = new Uint8Array(20 + data.length);
    webp.set(new TextEncoder().encode("RIFF"));
    webp.set(new TextEncoder().encode("WEBPEXIF"), 8);
    new DataView(webp.buffer).setUint32(16, data.length, true); webp.set(data, 20);
    for (const bytes of [jpeg(data), png, webp]) assert.equal(captureDate(bytes), "2026-08-31T12:21:25");
    assert.equal(captureDate(jpeg(exif(little, "2026:02:30 12:21:25"))), null);
    new DataView(data.buffer).setUint32(18, 999999, little);
    assert.equal(captureDate(jpeg(data)), null);
  }
  assert.equal(captureDate(new Uint8Array()), null);
  assert.equal(captureDate(new TextEncoder().encode("2026:08:31 12:21:25")), null);
  assert.equal(captureDate(jpeg(exif(true)).slice(0, 50)), null);
});

test("date folders and colliding filenames preserve every original byte in ZIP", () => {
  const paths = archivePaths([{ name: "A.jpg", takenAt: "2026-08-31T12:21:25" }, { name: "a.jpg", takenAt: "2026-08-31T12:21:25" }, { name: "../bad.png" }], true);
  assert.deepEqual(paths, ["2026-08-31/A.jpg", "2026-08-31/a (2).jpg", "日期未知/.._bad.png"]);
  const entries = Object.fromEntries(paths.map((path, i) => [path, new Uint8Array([i, 255, 0])]));
  assert.deepEqual(unzipSync(zipSync(entries, { level: 0 })), entries);
  assert.deepEqual(archivePaths([{ name: "a.jpg" }, { name: "a (2).jpg" }, { name: "a.jpg" }], false), ["a.jpg", "a (2).jpg", "a (3).jpg"]);
});
