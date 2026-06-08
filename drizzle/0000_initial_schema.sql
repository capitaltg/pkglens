CREATE TYPE "public"."ecosystem" AS ENUM('npm', 'pypi', 'maven');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ecosystem" "ecosystem" NOT NULL,
	"name" text NOT NULL,
	"bull_job_id" text,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" integer NOT NULL,
	"size_data" jsonb NOT NULL,
	"dep_tree" jsonb NOT NULL,
	"score_data" jsonb NOT NULL,
	"vulnerabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"maintenance_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ecosystem" "ecosystem" NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"analyzed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "packages_ecosystem_name_unique" UNIQUE("ecosystem","name")
);
--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;