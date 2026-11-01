CREATE TABLE `rates` (
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`rate` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`currency`, `date`),
	CONSTRAINT "rates_currency_check" CHECK("rates"."currency" in ('BTC')),
	CONSTRAINT "rates_date_check" CHECK("rates"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "rates_rate_check" CHECK("rates"."rate" glob '[0-9]*' and "rates"."rate" not glob '*[^0-9.]*')
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`currency` text NOT NULL,
	`description` text,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "assets_category_check" CHECK("__new_assets"."category" in ('bank', 'investment', 'crypto', 'real_estate', 'cash', 'other')),
	CONSTRAINT "assets_currency_check" CHECK("__new_assets"."currency" in ('EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'BTC')),
	CONSTRAINT "assets_name_check" CHECK(length(trim("__new_assets"."name")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_assets`("id", "name", "category", "currency", "description", "color", "created_at", "updated_at") SELECT "id", "name", "category", "currency", "description", "color", "created_at", "updated_at" FROM `assets`;--> statement-breakpoint
DROP TABLE `assets`;--> statement-breakpoint
ALTER TABLE `__new_assets` RENAME TO `assets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;