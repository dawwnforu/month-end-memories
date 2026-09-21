import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { photoRecords } from "../../../db/schema";

async function workspace(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (v) => v.toString(16).padStart(2, "0")).join("");
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const owner = await workspace(request);
  if (!owner) return reply({ error: "需要工作区凭据" }, 401);
  const query = new URL(request.url).searchParams;
  const conditions = [eq(photoRecords.workspace, owner)];
  for (const [key, operator] of [["from", gte], ["to", lte]] as const) {
    const date = query.get(key);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply({ error: "日期格式无效" }, 400);
    if (date) conditions.push(operator(photoRecords.takenAt, date + (key === "to" ? "T23:59:59" : "T00:00:00")));
  }
  const offset = Number(query.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return reply({ error: "分页无效" }, 400);
  const ordering = query.get("sort") === "newest" ? desc(photoRecords.takenAt) : query.get("sort") === "oldest" ? asc(photoRecords.takenAt) : asc(photoRecords.importIndex);
  try {
    const { getDb } = await import("../../../db");
    const unknownLast = query.get("sort") === "newest" || query.get("sort") === "oldest" ? sql`${photoRecords.takenAt} IS NULL` : asc(photoRecords.importIndex);
    const rows = await getDb().select().from(photoRecords).where(and(...conditions)).orderBy(unknownLast, ordering, asc(photoRecords.importIndex)).limit(500).offset(offset);
    return reply({ photos: rows.map(({ workspace: _workspace, ...photo }) => { void _workspace; return photo; }), nextOffset: rows.length === 500 ? offset + 500 : null });
  } catch { return reply({ error: "照片数据库暂不可用" }, 503); }
}

export async function PUT(request: Request) {
  const owner = await workspace(request);
  if (!owner) return reply({ error: "需要工作区凭据" }, 401);
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return reply({ error: "来源无效" }, 403);
  const raw = await request.text();
  if (raw.length > 2_000_000) return reply({ error: "单次数据过大" }, 413);
  let photos;
  try { photos = JSON.parse(raw); } catch { return reply({ error: "数据格式无效" }, 400); }
  if (!Array.isArray(photos) || photos.length > 2000) return reply({ error: "最多支持 2000 条照片记录" }, 400);
  const ids = new Set<string>();
  const numeric = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  for (const p of photos) {
    if (!p || typeof p.id !== "string" || !/^[\w-]{1,80}$/.test(p.id) || ids.has(p.id) || typeof p.name !== "string" || p.name.length > 1024 || typeof p.fingerprint !== "string" || p.fingerprint.length > 200 ||
      !numeric(p.naturalWidth, 1, 100000) || !numeric(p.naturalHeight, 1, 100000) || !numeric(p.widthMm, 1, 2000) || !numeric(p.heightMm, 1, 2000) || !Number.isInteger(p.quantity) || !numeric(p.quantity, 1, 999) ||
      (p.takenAt != null && (typeof p.takenAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(p.takenAt) || !Number.isFinite(Date.parse(p.takenAt + "Z")))) ||
      (p.latitude != null && !numeric(p.latitude, -90, 90)) || (p.longitude != null && !numeric(p.longitude, -180, 180)) || typeof p.edits !== "string" || p.edits.length > 2048) return reply({ error: "照片字段无效" }, 400);
    ids.add(p.id);
  }
  try {
    const { getDb } = await import("../../../db");
    const db = getDb();
    await db.batch([db.delete(photoRecords).where(eq(photoRecords.workspace, owner)), ...photos.map((p, importIndex) => db.insert(photoRecords).values({ workspace: owner, id: p.id, name: p.name, importIndex, fingerprint: p.fingerprint, takenAt: p.takenAt ?? null, latitude: p.latitude ?? null, longitude: p.longitude ?? null, naturalWidth: p.naturalWidth, naturalHeight: p.naturalHeight, widthMm: p.widthMm, heightMm: p.heightMm, quantity: p.quantity, edits: p.edits }))]);
    return reply({ saved: photos.length });
  } catch { return reply({ error: "数据库保存失败，原图仍保留在本机" }, 503); }
}
