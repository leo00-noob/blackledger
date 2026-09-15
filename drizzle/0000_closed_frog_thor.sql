CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`public_summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_user_provider_unique` ON `connections` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `connections_user_idx` ON `connections` (`user_id`);--> statement-breakpoint
CREATE TABLE `cost_basis_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`symbol` text NOT NULL,
	`average_entry_usd` real NOT NULL,
	`note` text DEFAULT 'Manual override' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_basis_user_provider_symbol_unique` ON `cost_basis_overrides` (`user_id`,`provider`,`symbol`);--> statement-breakpoint
CREATE INDEX `cost_basis_user_idx` ON `cost_basis_overrides` (`user_id`);--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_net_usd` real DEFAULT 0 NOT NULL,
	`external_flow_usd` real DEFAULT 0 NOT NULL,
	`payload_json` text NOT NULL,
	`synced_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_user_synced_idx` ON `portfolio_snapshots` (`user_id`,`synced_at`);--> statement-breakpoint
CREATE INDEX `snapshots_connection_synced_idx` ON `portfolio_snapshots` (`connection_id`,`synced_at`);