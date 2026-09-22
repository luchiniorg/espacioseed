CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`category_label` text NOT NULL,
	`description` text,
	`price` integer DEFAULT 0 NOT NULL,
	`stock` integer DEFAULT 10 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`image_url` text,
	`link` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);