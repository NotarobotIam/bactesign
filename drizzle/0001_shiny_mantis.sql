CREATE TABLE `molecules` (
	`id` text PRIMARY KEY NOT NULL,
	`name_key` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `molecules_name_key_unique` ON `molecules` (`name_key`);