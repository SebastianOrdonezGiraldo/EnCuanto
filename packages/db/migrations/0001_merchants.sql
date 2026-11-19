CREATE TYPE "public"."merchant_source_type" AS ENUM('affiliate_feed', 'official_api', 'partner_feed', 'manual');--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"brand_color" text,
	"platform" text,
	"source_type" "merchant_source_type" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"terms_reviewed_at" timestamp with time zone,
	"affiliate_template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_slug_unique" UNIQUE("slug")
);
