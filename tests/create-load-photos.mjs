import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { gpsExif, jpegWithExif } from "./exif-fixture.mjs";

await mkdir("outputs/load-photos", { recursive: true });
for (let i = 0; i < 320; i++) {
  const jpeg = await sharp({ create: { width: 3072, height: 2048, channels: 3, background: { r: (i % 20) * 12, g: Math.floor(i / 20) * 15, b: 120 } } }).jpeg({ quality: 85 }).toBuffer();
  const date = `2026:09:20 ${String(8 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`;
  await writeFile(`outputs/load-photos/photo-${String(i).padStart(3, "0")}.jpg`, jpegWithExif(jpeg, gpsExif({ date, latitude: i % 3 === 1 ? 32 : 31 })));
}
console.log("Created 320 distinct 3072 x 2048 JPEG photos with capture time and A-B-A GPS metadata");
