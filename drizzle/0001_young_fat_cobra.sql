DROP INDEX `events_tx_hash_log_index_unique`;--> statement-breakpoint
ALTER TABLE `events` ADD `chain` text;--> statement-breakpoint
UPDATE `events` SET `chain` = 'ethereum' WHERE `chain` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `events_chain_tx_hash_log_index_unique` ON `events` (`chain`,`tx_hash`,`log_index`);--> statement-breakpoint
DROP INDEX `tokens_address_unique`;--> statement-breakpoint
ALTER TABLE `tokens` ADD `chain` text;--> statement-breakpoint
UPDATE `tokens` SET `chain` = 'ethereum' WHERE `chain` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_chain_address_unique` ON `tokens` (`chain`,`address`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_daily_flows` (
	`date` text NOT NULL,
	`chain` text NOT NULL,
	`token_id` integer NOT NULL,
	`total_deposits` real DEFAULT 0 NOT NULL,
	`total_withdrawals` real DEFAULT 0 NOT NULL,
	`net_flow` real DEFAULT 0 NOT NULL,
	`deposit_tx_count` integer DEFAULT 0 NOT NULL,
	`withdrawal_tx_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `chain`, `token_id`),
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_daily_flows`("date", "chain", "token_id", "total_deposits", "total_withdrawals", "net_flow", "deposit_tx_count", "withdrawal_tx_count") SELECT "date", 'ethereum', "token_id", "total_deposits", "total_withdrawals", "net_flow", "deposit_tx_count", "withdrawal_tx_count" FROM `daily_flows`;--> statement-breakpoint
DROP TABLE `daily_flows`;--> statement-breakpoint
ALTER TABLE `__new_daily_flows` RENAME TO `daily_flows`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_relayer_stats_daily` (
	`date` text NOT NULL,
	`chain` text NOT NULL,
	`num_active_relayers` integer DEFAULT 0 NOT NULL,
	`top_5_share` real DEFAULT 0 NOT NULL,
	`hhi` real DEFAULT 0 NOT NULL,
	`relayer_tx_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `chain`)
);
--> statement-breakpoint
INSERT INTO `__new_relayer_stats_daily`("date", "chain", "num_active_relayers", "top_5_share", "hhi", "relayer_tx_count") SELECT "date", 'ethereum', "num_active_relayers", "top_5_share", "hhi", "relayer_tx_count" FROM `relayer_stats_daily`;--> statement-breakpoint
DROP TABLE `relayer_stats_daily`;--> statement-breakpoint
ALTER TABLE `__new_relayer_stats_daily` RENAME TO `relayer_stats_daily`;