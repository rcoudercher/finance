CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`currency` text NOT NULL,
	`description` text,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "assets_category_check" CHECK("assets"."category" in ('bank', 'investment', 'crypto', 'real_estate', 'cash', 'other')),
	CONSTRAINT "assets_currency_check" CHECK("assets"."currency" in ('EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD')),
	CONSTRAINT "assets_name_check" CHECK(length(trim("assets"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "valuations_source_check" CHECK("valuations"."source" in ('manual', 'import', 'api')),
	CONSTRAINT "valuations_date_check" CHECK("valuations"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "valuations_value_check" CHECK(typeof("valuations"."value") = 'integer' and abs("valuations"."value") <= 999999999999999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `valuations_asset_date_unique` ON `valuations` (`asset_id`,`date`);--> statement-breakpoint
CREATE INDEX `valuations_date_idx` ON `valuations` (`date`);