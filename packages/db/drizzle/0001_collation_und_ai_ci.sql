-- Nondeterministic ICU collation: case- AND accent-insensitive, Unicode root locale.
-- Applied to user-facing name columns so equality, ORDER BY, and UNIQUE behave
-- correctly without any app-side wrapping.
--
-- NOTE on pattern matching (verified PG 18.4): PostgreSQL does NOT support ILIKE
-- on nondeterministic collations -- it raises:
--   ERROR: nondeterministic collations are not supported for ILIKE
-- Use plain LIKE: the collation already provides case + accent insensitivity,
-- so LIKE behaves like an accent-insensitive ILIKE on these columns. Always
-- pair user-supplied LIKE patterns with escapeLikePattern() from
-- apps/api/src/lib/validators.ts and an explicit ESCAPE '\' clause to prevent
-- wildcard injection.
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
