ALTER TABLE `molecules` ADD `structure_key` text;--> statement-breakpoint
ALTER TABLE `molecules` ADD `pubchem_cid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `molecules_structure_key_unique` ON `molecules` (`structure_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `molecules_pubchem_cid_unique` ON `molecules` (`pubchem_cid`);