export function gpsExif({ date = "2026:09:20 10:00:00", latitude = 31, longitude = 121, little = true } = {}) {
  const data = new Uint8Array(178);
  const view = new DataView(data.buffer);
  const u16 = (at, n) => view.setUint16(at, n, little);
  const u32 = (at, n) => view.setUint32(at, n, little);
  const entry = (at, tag, type, count, value) => { u16(at, tag); u16(at + 2, type); u32(at + 4, count); u32(at + 8, value); };
  data.set(new TextEncoder().encode(little ? "II" : "MM"));
  u16(2, 42); u32(4, 8); u16(8, 2);
  entry(10, 0x8769, 4, 1, 38); entry(22, 0x8825, 4, 1, 56);
  u16(38, 1); entry(40, 0x9003, 2, 20, 158);
  u16(56, 4);
  entry(58, 1, 2, 2, 0); data[66] = latitude < 0 ? 83 : 78;
  entry(70, 2, 5, 3, 110);
  entry(82, 3, 2, 2, 0); data[90] = longitude < 0 ? 87 : 69;
  entry(94, 4, 5, 3, 134);
  for (const [offset, value] of [[110, latitude], [134, longitude]]) {
    const degrees = Math.floor(Math.abs(value)), minutes = (Math.abs(value) - degrees) * 60;
    u32(offset, degrees); u32(offset + 4, 1);
    u32(offset + 8, Math.floor(minutes)); u32(offset + 12, 1);
    u32(offset + 16, Math.round((minutes % 1) * 60 * 1000000)); u32(offset + 20, 1000000);
  }
  data.set(new TextEncoder().encode(date), 158);
  return data;
}
export function jpegWithExif(jpeg, tiff) {
  const size = tiff.length + 8;
  return Uint8Array.from([...jpeg.slice(0, 2), 255, 225, size >> 8, size & 255, 69, 120, 105, 102, 0, 0, ...tiff, ...jpeg.slice(2)]);
}
