CREATE TYPE "public"."match_review_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('pending', 'auto', 'manual', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."offer_availability" AS ENUM('in_stock', 'out_of_stock', 'preorder', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."offer_condition" AS ENUM('new', 'used', 'refurbished');--> statement-breakpoint
CREATE TABLE "ai_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"input_hash" text NOT NULL,
	"variant_ids" uuid[] NOT NULL,
	"context" text,
	"response" jsonb,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"candidate_variant_id" uuid NOT NULL,
	"score" real NOT NULL,
	"status" "match_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbound_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"user_id" uuid,
	"session_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"q_normalized" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"results_count" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"accessory" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"gtin" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"category_id" uuid,
	"canonical_name" text NOT NULL,
	"model_number" text,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('spanish'::regconfig, public.immutable_unaccent(coalesce("products"."canonical_name", '') || ' ' || coalesce("products"."model_number", '')))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_run_status" DEFAULT 'running' NOT NULL,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_upserted" integer DEFAULT 0 NOT NULL,
	"items_price_changed" integer DEFAULT 0 NOT NULL,
	"items_quarantined" integer DEFAULT 0 NOT NULL,
	"error_summary" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarantined_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"sync_run_id" uuid,
	"record_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quarantined_records_merchant_hash_unique" UNIQUE("merchant_id","record_hash")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"variant_id" uuid,
	"external_id" text NOT NULL,
	"title_raw" text NOT NULL,
	"url" text NOT NULL,
	"image_url" text,
	"seller_name" text,
	"is_marketplace" boolean DEFAULT false NOT NULL,
	"condition" "offer_condition" DEFAULT 'new' NOT NULL,
	"availability" "offer_availability" DEFAULT 'unknown' NOT NULL,
	"price" bigint NOT NULL,
	"list_price" bigint,
	"currency" text DEFAULT 'COP' NOT NULL,
	"gtin" text,
	"brand" text,
	"model_number" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"match_status" "match_status" DEFAULT 'pending' NOT NULL,
	"match_confidence" real,
	CONSTRAINT "offers_merchant_external_unique" UNIQUE("merchant_id","external_id"),
	CONSTRAINT "offers_price_positive" CHECK ("offers"."price" > 0),
	CONSTRAINT "offers_list_price_gte_price" CHECK ("offers"."list_price" is null or "offers"."list_price" >= "offers"."price")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"offer_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"list_price" bigint,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_history_offer_id_observed_at_pk" PRIMARY KEY("offer_id","observed_at")
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"user_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"offer_id" uuid,
	"price_at_save" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_variant_id_pk" PRIMARY KEY("user_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"target_price" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "provider_config" jsonb;--> statement-breakpoint
ALTER TABLE "ai_comparisons" ADD CONSTRAINT "ai_comparisons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reviews" ADD CONSTRAINT "match_reviews_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reviews" ADD CONSTRAINT "match_reviews_candidate_variant_id_product_variants_id_fk" FOREIGN KEY ("candidate_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reviews" ADD CONSTRAINT "match_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_clicks" ADD CONSTRAINT "outbound_clicks_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_clicks" ADD CONSTRAINT "outbound_clicks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantined_records" ADD CONSTRAINT "quarantined_records_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantined_records" ADD CONSTRAINT "quarantined_records_sync_run_id_provider_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."provider_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_comparisons_input_hash_idx" ON "ai_comparisons" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "match_reviews_status_idx" ON "match_reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbound_clicks_offer_created_idx" ON "outbound_clicks" USING btree ("offer_id","created_at");--> statement-breakpoint
CREATE INDEX "search_queries_created_at_idx" ON "search_queries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_gtin_unique" ON "product_variants" USING btree ("gtin") WHERE "product_variants"."gtin" is not null;--> statement-breakpoint
CREATE INDEX "product_variants_product_id_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_search_tsv_idx" ON "products" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "products_canonical_name_trgm_idx" ON "products" USING gin ("canonical_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_brand_id_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "provider_sync_runs_merchant_started_idx" ON "provider_sync_runs" USING btree ("merchant_id","started_at");--> statement-breakpoint
CREATE INDEX "quarantined_records_created_at_idx" ON "quarantined_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "offers_variant_id_idx" ON "offers" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "offers_gtin_idx" ON "offers" USING btree ("gtin");--> statement-breakpoint
CREATE INDEX "offers_match_status_idx" ON "offers" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX "offers_last_seen_at_idx" ON "offers" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "price_alerts_user_id_idx" ON "price_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_alerts_variant_active_idx" ON "price_alerts" USING btree ("variant_id","active");