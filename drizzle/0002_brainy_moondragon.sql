CREATE TABLE IF NOT EXISTS `relayer_fee_revenue_daily` (
	`date` text NOT NULL,
	`chain` text NOT NULL,
	`relayer_address` text NOT NULL,
	`token_id` integer NOT NULL,
	`total_fee_wei` text NOT NULL,
	`total_fee_normalized` real DEFAULT 0 NOT NULL,
	`tx_count` integer DEFAULT 0 NOT NULL,
	`avg_fee_normalized` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `chain`, `relayer_address`, `token_id`),
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE no action
);
