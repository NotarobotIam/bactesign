CREATE TABLE `molecule_sources` (
	`source_key` text PRIMARY KEY NOT NULL,
	`database_name` text NOT NULL,
	`identifier` text NOT NULL,
	`molecule_id` text NOT NULL
);
