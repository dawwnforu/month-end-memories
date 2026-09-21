// Read DateTimeOriginal only: filesystem and export dates are not capture dates.
export function captureDate(bytes: Uint8Array): string | null {
  return readMetadata(bytes).takenAt;
}

export function readMetadata(bytes: Uint8Array) {
  const metadata: { takenAt: string | null; latitude: number | null; longitude: number | null } = { takenAt: null, latitude: null, longitude: null };
  metadata.takenAt = readExif(bytes, metadata);
  return metadata;
}

function readExif(bytes: Uint8Array, metadata: { latitude: number | null; longitude: number | null }): string | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
    function tiff(start: number, end: number): string | null {
      if (ascii(start, 6) === "Exif\0\0") start += 6;
      const endian = ascii(start, 2);
      if (endian !== "II" && endian !== "MM") return null;
      const little = endian === "II";
      const read = (offset: number, size: 2 | 4) => {
        if (offset < start || offset + size > end) throw new Error("Invalid EXIF offset");
        return size === 2 ? view.getUint16(offset, little) : view.getUint32(offset, little);
      };
      if (read(start + 2, 2) !== 42) return null;
      function entry(ifd: number, tag: number) {
        const count = read(ifd, 2);
        for (let i = 0; i < count; i++) {
          const at = ifd + 2 + i * 12;
          read(at + 8, 4);
          if (read(at, 2) === tag) return at;
        }
        return null;
      }
      const root = start + read(start + 4, 4);
      try {
        const gpsPointer = entry(root, 0x8825);
        if (gpsPointer !== null && read(gpsPointer + 2, 2) === 4 && read(gpsPointer + 4, 4) === 1) {
          const gps = start + read(gpsPointer + 8, 4);
          const coordinate = (tag: number, negative: string, positive: string, limit: number) => {
            const value = entry(gps, tag), ref = entry(gps, tag - 1);
            if (value === null || ref === null || read(value + 2, 2) !== 5 || read(value + 4, 4) !== 3 || read(ref + 2, 2) !== 2 || read(ref + 4, 4) !== 2) return null;
            const direction = ascii(ref + 8, 1);
            if (direction !== negative && direction !== positive) return null;
            const offset = start + read(value + 8, 4);
            const values = [0, 8, 16].map((n) => read(offset + n, 4) / read(offset + n + 4, 4));
            if (values.some((n) => !Number.isFinite(n)) || values[1] >= 60 || values[2] >= 60) return null;
            const result = values[0] + values[1] / 60 + values[2] / 3600;
            return result <= limit ? result * (direction === negative ? -1 : 1) : null;
          };
          const latitude = coordinate(2, "S", "N", 90), longitude = coordinate(4, "W", "E", 180);
          if (latitude !== null && longitude !== null) { metadata.latitude = latitude; metadata.longitude = longitude; }
        }
      } catch { /* A damaged GPS block does not invalidate capture time. */ }
      const pointer = entry(root, 0x8769);
      if (pointer === null || read(pointer + 2, 2) !== 4 || read(pointer + 4, 4) !== 1) return null;
      const date = entry(start + read(pointer + 8, 4), 0x9003);
      if (date === null || read(date + 2, 2) !== 2 || read(date + 4, 4) !== 20) return null;
      const offset = start + read(date + 8, 4);
      if (offset < start || offset + 20 > end) return null;
      const raw = ascii(offset, 19);
      if (!/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
      const value = raw.slice(0, 10).replace(/:/g, "-") + "T" + raw.slice(11);
      const parsed = new Date(value + "Z");
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value ? value : null;
    }
    if (view.getUint16(0) === 0xffd8) {
      for (let pos = 2; pos + 4 <= bytes.length;) {
        if (bytes[pos++] !== 255) return null;
        while (bytes[pos] === 255) pos++;
        const marker = bytes[pos++];
        if (marker === 0xda || marker === 0xd9) break;
        const size = view.getUint16(pos);
        if (size < 2 || pos + size > bytes.length) return null;
        if (marker === 0xe1 && ascii(pos + 2, 6) === "Exif\0\0") {
          const value = tiff(pos + 2, pos + size);
          if (value) return value;
        }
        pos += size;
      }
    } else if (ascii(1, 3) === "PNG") {
      for (let pos = 8; pos + 12 <= bytes.length;) {
        const size = view.getUint32(pos);
        if (pos + size + 12 > bytes.length) return null;
        if (ascii(pos + 4, 4) === "eXIf") return tiff(pos + 8, pos + 8 + size);
        pos += size + 12;
      }
    } else if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
      for (let pos = 12; pos + 8 <= bytes.length;) {
        const size = view.getUint32(pos + 4, true);
        if (pos + size + 8 > bytes.length) return null;
        if (ascii(pos, 4) === "EXIF") return tiff(pos + 8, pos + 8 + size);
        pos += 8 + size + (size % 2);
      }
    }
  } catch { /* Missing or damaged metadata must not prevent photo import. */ }
  return null;
}

export function archivePaths(photos: { name: string; takenAt?: string | null }[], byDate: boolean) {
  const used = new Set<string>();
  return photos.map((photo) => {
    const name = (photo.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "photo")
      .replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i, "_$1");
    const folder = byDate ? `${photo.takenAt?.slice(0, 10) || "日期未知"}/` : "";
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let path = folder + name;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${folder}${stem} (${n})${extension}`;
    used.add(path.toLowerCase());
    return path;
  });
}
