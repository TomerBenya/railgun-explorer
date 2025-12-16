CREATE TABLE IF NOT EXISTS `daily_token_diversity` (
	`date` text NOT NULL,
	`chain` text NOT NULL,
	`unique_token_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `chain`)
);
