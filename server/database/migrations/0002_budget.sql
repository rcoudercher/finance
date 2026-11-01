CREATE TABLE `budget_amounts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `budget_items`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "budget_amounts_month_check" CHECK("budget_amounts"."month" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "budget_amounts_amount_check" CHECK(typeof("budget_amounts"."amount") = 'integer' and "budget_amounts"."amount" >= 0 and "budget_amounts"."amount" <= 999999999999999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_amounts_item_month_unique` ON `budget_amounts` (`item_id`,`month`);--> statement-breakpoint
CREATE INDEX `budget_amounts_month_idx` ON `budget_amounts` (`month`);--> statement-breakpoint
CREATE TABLE `budget_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "budget_items_kind_check" CHECK("budget_items"."kind" in ('income', 'expense')),
	CONSTRAINT "budget_items_name_check" CHECK(length(trim("budget_items"."name")) > 0)
);
