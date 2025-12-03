CREATE TABLE `daily_flows` (
	`date` text NOT NULL,
	`token_id` integer NOT NULL,
	`total_deposits` real DEFAULT 0 NOT NULL,
	`total_withdrawals` real DEFAULT 0 NOT NULL,
	`net_flow` real DEFAULT 0 NOT NULL,
	`deposit_tx_count` integer DEFAULT 0 NOT NULL,
	`withdrawal_tx_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `token_id`),
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`block_number` integer NOT NULL,
	`block_timestamp` integer NOT NULL,
	`contract_name` text NOT NULL,
	`event_name` text NOT NULL,
	`event_type` text NOT NULL,
	`token_id` integer,
	`raw_amount_wei` text,
	`amount_normalized` real,
	`relayer_address` text,
	`from_address` text,
	`to_address` text,
	`metadata_json` text,
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_tx_hash_log_index_unique` ON `events` (`tx_hash`,`log_index`);--> statement-breakpoint
CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `relayer_stats_daily` (
	`date` text PRIMARY KEY NOT NULL,
	`num_active_relayers` integer DEFAULT 0 NOT NULL,
	`top_5_share` real DEFAULT 0 NOT NULL,
	`hhi` real DEFAULT 0 NOT NULL,
	`relayer_tx_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`symbol` text,
	`decimals` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_address_unique` ON `tokens` (`address`);