CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "auth_provider" AS ENUM ('password', 'google');
CREATE TYPE "club_role" AS ENUM ('owner', 'admin', 'organizer', 'member');
CREATE TYPE "invite_status" AS ENUM ('pending', 'accepted', 'expired', 'revoked');
CREATE TYPE "tournament_format" AS ENUM ('manual', 'swiss');
CREATE TYPE "tournament_status" AS ENUM ('draft', 'active', 'completed');
CREATE TYPE "round_status" AS ENUM ('scheduled', 'active', 'completed');
CREATE TYPE "match_status" AS ENUM ('scheduled', 'completed', 'void');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320) NOT NULL,
  "name" text NOT NULL,
  "avatar_url" text,
  "email_verified" boolean DEFAULT false NOT NULL,
  "password_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "auth_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" "auth_provider" NOT NULL,
  "provider_subject" text NOT NULL,
  "email" varchar(320) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "clubs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" varchar(120) NOT NULL,
  "description" text,
  "city" text,
  "country" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "club_memberships" (
  "club_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "club_role" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "club_memberships_club_id_user_id_pk" PRIMARY KEY("club_id","user_id")
);

CREATE TABLE "club_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "club_id" uuid NOT NULL,
  "email" varchar(320) NOT NULL,
  "role" "club_role" NOT NULL,
  "invited_by_user_id" uuid,
  "token_hash" text NOT NULL,
  "status" "invite_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "players" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "club_id" uuid NOT NULL,
  "linked_user_id" uuid,
  "display_name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "legacy_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "player_ratings" (
  "player_id" uuid PRIMARY KEY NOT NULL,
  "club_id" uuid NOT NULL,
  "elo" double precision NOT NULL,
  "glicko_rating" double precision NOT NULL,
  "glicko_rd" double precision NOT NULL,
  "glicko_vol" double precision NOT NULL,
  "games_played" integer DEFAULT 0 NOT NULL,
  "last_game_date" date,
  "last_game_match_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "tournaments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "club_id" uuid NOT NULL,
  "name" text NOT NULL,
  "starts_on" date NOT NULL,
  "format" "tournament_format" DEFAULT 'manual' NOT NULL,
  "status" "tournament_status" DEFAULT 'draft' NOT NULL,
  "legacy_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "tournament_players" (
  "tournament_id" uuid NOT NULL,
  "player_id" uuid NOT NULL,
  "seed" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tournament_players_tournament_id_player_id_pk" PRIMARY KEY("tournament_id","player_id")
);

CREATE TABLE "rounds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tournament_id" uuid NOT NULL,
  "number" integer NOT NULL,
  "status" "round_status" DEFAULT 'scheduled' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "club_id" uuid NOT NULL,
  "tournament_id" uuid NOT NULL,
  "round_id" uuid,
  "white_player_id" uuid NOT NULL,
  "black_player_id" uuid NOT NULL,
  "result" double precision,
  "played_on" date NOT NULL,
  "board_number" integer,
  "status" "match_status" DEFAULT 'scheduled' NOT NULL,
  "legacy_id" integer,
  "white_elo_before" double precision,
  "white_elo_after" double precision,
  "black_elo_before" double precision,
  "black_elo_after" double precision,
  "white_glicko_rating_before" double precision,
  "white_glicko_rating_after" double precision,
  "white_glicko_rd_before" double precision,
  "white_glicko_rd_after" double precision,
  "white_glicko_vol_before" double precision,
  "white_glicko_vol_after" double precision,
  "black_glicko_rating_before" double precision,
  "black_glicko_rating_after" double precision,
  "black_glicko_rd_before" double precision,
  "black_glicko_rd_after" double precision,
  "black_glicko_vol_before" double precision,
  "black_glicko_vol_after" double precision,
  "white_last_played_before" date,
  "black_last_played_before" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE cascade;
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "club_invites" ADD CONSTRAINT "club_invites_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE cascade;
ALTER TABLE "club_invites" ADD CONSTRAINT "club_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE set null;
ALTER TABLE "players" ADD CONSTRAINT "players_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE cascade;
ALTER TABLE "players" ADD CONSTRAINT "players_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE set null;
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE cascade;
ALTER TABLE "player_ratings" ADD CONSTRAINT "player_ratings_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE cascade;
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE cascade;
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE cascade;
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE cascade;
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE cascade;
ALTER TABLE "matches" ADD CONSTRAINT "matches_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE cascade;
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE cascade;
ALTER TABLE "matches" ADD CONSTRAINT "matches_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE set null;
ALTER TABLE "matches" ADD CONSTRAINT "matches_white_player_id_players_id_fk" FOREIGN KEY ("white_player_id") REFERENCES "players"("id") ON DELETE restrict;
ALTER TABLE "matches" ADD CONSTRAINT "matches_black_player_id_players_id_fk" FOREIGN KEY ("black_player_id") REFERENCES "players"("id") ON DELETE restrict;

CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
CREATE UNIQUE INDEX "auth_identities_provider_subject_unique" ON "auth_identities" ("provider","provider_subject");
CREATE UNIQUE INDEX "auth_identities_user_provider_unique" ON "auth_identities" ("user_id","provider");
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" ("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE UNIQUE INDEX "clubs_slug_unique" ON "clubs" ("slug");
CREATE INDEX "club_memberships_club_id_idx" ON "club_memberships" ("club_id");
CREATE INDEX "club_memberships_user_id_idx" ON "club_memberships" ("user_id");
CREATE UNIQUE INDEX "club_invites_token_hash_unique" ON "club_invites" ("token_hash");
CREATE INDEX "club_invites_club_email_idx" ON "club_invites" ("club_id","email");
CREATE UNIQUE INDEX "players_club_display_name_unique" ON "players" ("club_id","display_name");
CREATE UNIQUE INDEX "players_club_legacy_id_unique" ON "players" ("club_id","legacy_id");
CREATE UNIQUE INDEX "players_club_linked_user_unique" ON "players" ("club_id","linked_user_id");
CREATE INDEX "player_ratings_club_id_idx" ON "player_ratings" ("club_id");
CREATE UNIQUE INDEX "tournaments_club_name_unique" ON "tournaments" ("club_id","name");
CREATE UNIQUE INDEX "tournaments_club_legacy_id_unique" ON "tournaments" ("club_id","legacy_id");
CREATE INDEX "tournament_players_player_id_idx" ON "tournament_players" ("player_id");
CREATE UNIQUE INDEX "rounds_tournament_number_unique" ON "rounds" ("tournament_id","number");
CREATE UNIQUE INDEX "matches_club_legacy_id_unique" ON "matches" ("club_id","legacy_id");
CREATE INDEX "matches_tournament_id_idx" ON "matches" ("tournament_id");
CREATE INDEX "matches_round_id_idx" ON "matches" ("round_id");
CREATE INDEX "matches_white_player_id_idx" ON "matches" ("white_player_id");
CREATE INDEX "matches_black_player_id_idx" ON "matches" ("black_player_id");
