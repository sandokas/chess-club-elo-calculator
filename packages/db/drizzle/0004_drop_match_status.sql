-- Drop the matches.status column and match_status enum.
-- Completion is now derived from result IS NOT NULL.
ALTER TABLE "matches" DROP COLUMN IF EXISTS "status";
DROP TYPE IF EXISTS "match_status";
