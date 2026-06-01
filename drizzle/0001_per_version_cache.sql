ALTER TABLE "packages" DROP CONSTRAINT "packages_ecosystem_name_unique";--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "security_refreshed_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_ecosystem_name_version_unique" UNIQUE("ecosystem","name","version");