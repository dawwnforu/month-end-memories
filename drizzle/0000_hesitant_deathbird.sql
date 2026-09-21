CREATE TABLE IF NOT EXISTS `photo_records` (
	`workspace` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`import_index` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`taken_at` text,
	`latitude` real,
	`longitude` real,
	`natural_width` integer NOT NULL,
	`natural_height` integer NOT NULL,
	`width_mm` real NOT NULL,
	`height_mm` real NOT NULL,
	`quantity` integer NOT NULL,
	`edits` text NOT NULL,
	PRIMARY KEY(`workspace`, `id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `photos_time` ON `photo_records` (`workspace`,`taken_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `photos_location` ON `photo_records` (`workspace`,`latitude`,`longitude`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `photos_fingerprint` ON `photo_records` (`workspace`,`fingerprint`);
