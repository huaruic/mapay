CREATE TYPE "public"."task_status" AS ENUM('pending', 'planning', 'executing', 'integrating', 'completed', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('planned', 'paying', 'paid', 'invoking', 'ok', 'failed');
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" numeric PRIMARY KEY NOT NULL,
	"owner_address" varchar(42) NOT NULL,
	"operator_address" varchar(42) NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"balance_wei" numeric DEFAULT '0' NOT NULL,
	"max_per_call_wei" numeric NOT NULL,
	"daily_spend_cap_wei" numeric NOT NULL,
	"daily_spent_wei" numeric DEFAULT '0' NOT NULL,
	"daily_reset_at" bigint,
	"total_budget_wei" numeric DEFAULT '0' NOT NULL,
	"total_spent_wei" numeric DEFAULT '0' NOT NULL,
	"current_reputation" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"passport_token_id" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "chain_cursor" (
	"contract_address" varchar(42) PRIMARY KEY NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"head_block" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "operator_keys" (
	"agent_id" numeric PRIMARY KEY NOT NULL,
	"encrypted_privkey" "bytea" NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"kdf_params" jsonb,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "ratings" (
	"agent_id" numeric NOT NULL,
	"task_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_agent_id_task_id_pk" PRIMARY KEY("agent_id","task_id")
);

--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_events_task_seq_uq" UNIQUE("task_id","seq")
);

--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" numeric NOT NULL,
	"on_chain_task_id" varchar(66),
	"parent_task_id" uuid,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"prompt" text NOT NULL,
	"prompt_hash" varchar(66),
	"salt" varchar(66),
	"result_text" text,
	"result_hash" varchar(66),
	"plan_json" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"step_idx" integer NOT NULL,
	"tool_id" numeric NOT NULL,
	"tool_version" integer NOT NULL,
	"amount_wei" numeric NOT NULL,
	"status" "tool_call_status" DEFAULT 'planned' NOT NULL,
	"tx_hash" varchar(66),
	"receipt_id" varchar(66),
	"attempt" integer DEFAULT 0 NOT NULL,
	"input_json" jsonb,
	"input_hash" varchar(66),
	"output_json" jsonb,
	"output_hash" varchar(66),
	"http_status" integer,
	"provider_latency_ms" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_task_step_uq" UNIQUE("task_id","step_idx")
);

--> statement-breakpoint
CREATE TABLE "tools" (
	"id" numeric PRIMARY KEY NOT NULL,
	"provider_address" varchar(42) NOT NULL,
	"payout_address" varchar(42) NOT NULL,
	"version" integer NOT NULL,
	"price_per_call_wei" numeric NOT NULL,
	"schema_hash" varchar(66) NOT NULL,
	"schema_json" jsonb,
	"endpoint" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"total_revenue_wei" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "users" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_address");
--> statement-breakpoint
CREATE INDEX "tasks_agent_idx" ON "tasks" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");
--> statement-breakpoint
CREATE INDEX "tasks_on_chain_idx" ON "tasks" USING btree ("on_chain_task_id");
--> statement-breakpoint
CREATE INDEX "tool_calls_task_idx" ON "tool_calls" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "tools_provider_idx" ON "tools" USING btree ("provider_address");
--> statement-breakpoint
CREATE INDEX "tools_enabled_idx" ON "tools" USING btree ("enabled");