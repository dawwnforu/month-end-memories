export function duplicateGroups<T extends { fingerprint: string }>(photos: T[]) {
  const groups = new Map<string, T[]>();
  for (const photo of photos) {
    const group = groups.get(photo.fingerprint) ?? [];
    group.push(photo);
    groups.set(photo.fingerprint, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function uniquePhotos<T extends { fingerprint: string }>(photos: T[]) {
  const seen = new Set<string>();
  return photos.filter((photo) => {
    if (seen.has(photo.fingerprint)) return false;
    seen.add(photo.fingerprint);
    return true;
  });
}

export async function fingerprintImage(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法检查图片内容");
  try {
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const digest = await crypto.subtle.digest("SHA-256", pixels.data);
    return `${canvas.width}x${canvas.height}:` + Array.from(
      new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  } finally {
    canvas.width = canvas.height = 0;
  }
}
