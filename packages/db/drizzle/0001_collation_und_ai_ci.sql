-- Nondeterministic ICU collation: case- AND accent-insensitive, Unicode root locale.
-- Applied to user-facing name columns so equality, ORDER BY, UNIQUE, and ILIKE
-- behave correctly without any app-side wrapping (PG 17+ supports ILIKE on
-- nondeterministic collations; this project runs PG 18).
CREATE COLLATION IF NOT EXISTS public.und_ai_ci (
  provider      = icu,
  locale        = 'und-u-ks-level1',
  deterministic = false
);
--> statement-breakpoint
ALTER TABLE "players"
  ALTER COLUMN "display_name" TYPE text COLLATE public.und_ai_ci;
--> statement-breakpoint
ALTER TABLE "clubs"
  ALTER COLUMN "name" TYPE text COLLATE public.und_ai_ci;
--> statement-breakpoint
ALTER TABLE "tournaments"
  ALTER COLUMN "name" TYPE text COLLATE public.und_ai_ci;
