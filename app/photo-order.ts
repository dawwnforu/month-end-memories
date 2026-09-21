export type LocatedPhoto = { id: string; takenAt?: string | null; latitude?: number | null; longitude?: number | null };
export type PhotoOrder = "import" | "oldest" | "newest" | "location" | "smart";

export function distanceMeters(a: LocatedPhoto, b: LocatedPhoto) {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function orderPhotos<T extends LocatedPhoto>(photos: T[], order: PhotoOrder, radius = 100, hours = 3) {
  if (order === "import") return photos;
  const timed = [...photos].sort((a, b) => {
    if (!a.takenAt) return b.takenAt ? 1 : 0;
    if (!b.takenAt) return -1;
    return a.takenAt.localeCompare(b.takenAt) * (order === "newest" ? -1 : 1);
  });
  if (order === "oldest" || order === "newest") return timed;
  const groups: T[][] = [];
  for (const photo of timed) {
    const group = groups.find(([anchor]) => {
      if (distanceMeters(anchor, photo) > radius) return false;
      if (order === "location") return true;
      return Boolean(anchor.takenAt && photo.takenAt && anchor.takenAt.slice(0, 10) === photo.takenAt.slice(0, 10) &&
        Math.abs(Date.parse(anchor.takenAt + "Z") - Date.parse(photo.takenAt + "Z")) <= hours * 3600000);
    });
    if (group) group.push(photo);
    else groups.push([photo]);
  }
  if (order === "location") groups.sort((a, b) => Number(a[0].latitude == null) - Number(b[0].latitude == null));
  return groups.flat();
}
