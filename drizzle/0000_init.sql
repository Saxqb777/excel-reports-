CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"client_name" text,
	"description" text,
	"theme" jsonb NOT NULL,
	"schema_map" jsonb NOT NULL,
	"layout" jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_upload_id" text,
	"share_token" text NOT NULL,
	"share_password_hash" text,
	"share_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_rows" (
	"upload_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"cells" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"storage_kind" text NOT NULL,
	"storage_ref" text,
	"file_bytes" "bytea",
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sheet_name" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schema_snapshot" jsonb NOT NULL,
	"snapshot" jsonb,
	"quality" jsonb,
	"insights" jsonb,
	"anomalies" jsonb,
	"status" text DEFAULT 'ready' NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "upload_rows" ADD CONSTRAINT "upload_rows_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_share_token_idx" ON "projects" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "upload_rows_upload_idx" ON "upload_rows" USING btree ("upload_id","row_no");--> statement-breakpoint
CREATE INDEX "uploads_project_idx" ON "uploads" USING btree ("project_id","version_no");