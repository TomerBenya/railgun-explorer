CREATE TABLE `token_prices_daily` (
	`date` text NOT NULL,
	`chain` text NOT NULL,
	`token_id` integer NOT NULL,
	`price_usd` real NOT NULL,
	PRIMARY KEY(`date`, `chain`, `token_id`),
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `daily_flows` ADD `total_deposits_usd` real;--> statement-breakpoint
ALTER TABLE `daily_flows` ADD `total_withdrawals_usd` real;--> statement-breakpoint
ALTER TABLE `daily_flows` ADD `net_flow_usd` real;--> statement-breakpoint
CREATE INDEX `events_token_id_idx` ON `events` (`token_id`);--> statement-breakpoint
CREATE INDEX `events_chain_idx` ON `events` (`chain`);--> statement-breakpoint
CREATE INDEX `events_chain_token_idx` ON `events` (`chain`,`token_id`);--> statement-breakpoint
CREATE INDEX `events_block_timestamp_idx` ON `events` (`block_timestamp`);