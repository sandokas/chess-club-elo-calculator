-- Allow black_player_id to be null for virtual bye matches
ALTER TABLE "matches" ALTER COLUMN "black_player_id" DROP NOT NULL;

-- Ensure white_count and black_count are NOT NULL
ALTER TABLE "tournament_players" ALTER COLUMN "white_count" SET NOT NULL;
ALTER TABLE "tournament_players" ALTER COLUMN "black_count" SET NOT NULL;
