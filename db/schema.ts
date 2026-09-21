import { sqliteTable, text, real, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const photoRecords = sqliteTable("photo_records", {
  workspace: text("workspace").notNull(),
  id: text("id").notNull(),
  name: text("name").notNull(),
  importIndex: integer("import_index").notNull(),
  fingerprint: text("fingerprint").notNull(),
  takenAt: text("taken_at"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  naturalWidth: integer("natural_width").notNull(),
  naturalHeight: integer("natural_height").notNull(),
  widthMm: real("width_mm").notNull(),
  heightMm: real("height_mm").notNull(),
  quantity: integer("quantity").notNull(),
  edits: text("edits").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspace, table.id] }),
  index("photos_time").on(table.workspace, table.takenAt),
  index("photos_location").on(table.workspace, table.latitude, table.longitude),
  index("photos_fingerprint").on(table.workspace, table.fingerprint),
]);
