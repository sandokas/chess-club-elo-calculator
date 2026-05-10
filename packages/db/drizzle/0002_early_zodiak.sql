CREATE TYPE "public"."pairing_method" AS ENUM('seeded_by_rating', 'random');--> statement-breakpoint
ALTER TABLE "tournaments" ALTER COLUMN "starts_on" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournaments" ALTER COLUMN "starts_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "starts_on" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD COLUMN "dropped_out_round" integer;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD COLUMN "white_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD COLUMN "black_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "total_rounds" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "pairing_method" "pairing_method" DEFAULT 'seeded_by_rating';