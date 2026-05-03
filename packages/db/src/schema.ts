import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const authProviderEnum = pgEnum("auth_provider", ["password", "google"]);
export const clubRoleEnum = pgEnum("club_role", ["owner", "admin", "organizer", "member"]);
export const inviteStatusEnum = pgEnum("invite_status", ["pending", "accepted", "expired", "revoked"]);
export const tournamentFormatEnum = pgEnum("tournament_format", ["manual", "swiss"]);
export const tournamentStatusEnum = pgEnum("tournament_status", ["draft", "active", "completed"]);
export const roundStatusEnum = pgEnum("round_status", ["scheduled", "active", "completed"]);
export const matchStatusEnum = pgEnum("match_status", ["scheduled", "completed", "void"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    emailVerified: boolean("email_verified").notNull().default(false),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email)
  })
);

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: authProviderEnum("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    providerSubjectUnique: uniqueIndex("auth_identities_provider_subject_unique").on(table.provider, table.providerSubject),
    userProviderUnique: uniqueIndex("auth_identities_user_provider_unique").on(table.userId, table.provider)
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    userIdx: index("sessions_user_id_idx").on(table.userId)
  })
);

export const clubs = pgTable(
  "clubs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    description: text("description"),
    city: text("city"),
    country: text("country"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    slugUnique: uniqueIndex("clubs_slug_unique").on(table.slug)
  })
);

export const clubMemberships = pgTable(
  "club_memberships",
  {
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: clubRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clubId, table.userId] }),
    clubIdx: index("club_memberships_club_id_idx").on(table.clubId),
    userIdx: index("club_memberships_user_id_idx").on(table.userId)
  })
);

export const clubInvites = pgTable(
  "club_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    role: clubRoleEnum("role").notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull(),
    status: inviteStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("club_invites_token_hash_unique").on(table.tokenHash),
    clubEmailIdx: index("club_invites_club_email_idx").on(table.clubId, table.email)
  })
);

export const players = pgTable(
  "players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    linkedUserId: uuid("linked_user_id").references(() => users.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    active: boolean("active").notNull().default(true),
    legacyId: integer("legacy_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    clubNameUnique: uniqueIndex("players_club_display_name_unique").on(table.clubId, table.displayName),
    clubLegacyUnique: uniqueIndex("players_club_legacy_id_unique").on(table.clubId, table.legacyId),
    clubLinkedUserUnique: uniqueIndex("players_club_linked_user_unique").on(table.clubId, table.linkedUserId)
  })
);

export const playerRatings = pgTable(
  "player_ratings",
  {
    playerId: uuid("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    elo: doublePrecision("elo").notNull(),
    glickoRating: doublePrecision("glicko_rating").notNull(),
    glickoRd: doublePrecision("glicko_rd").notNull(),
    glickoVol: doublePrecision("glicko_vol").notNull(),
    gamesPlayed: integer("games_played").notNull().default(0),
    lastGameDate: date("last_game_date"),
    lastGameMatchId: uuid("last_game_match_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    clubIdx: index("player_ratings_club_id_idx").on(table.clubId)
  })
);

export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startsOn: date("starts_on").notNull(),
    format: tournamentFormatEnum("format").notNull().default("manual"),
    status: tournamentStatusEnum("status").notNull().default("draft"),
    legacyId: integer("legacy_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    clubNameUnique: uniqueIndex("tournaments_club_name_unique").on(table.clubId, table.name),
    clubLegacyUnique: uniqueIndex("tournaments_club_legacy_id_unique").on(table.clubId, table.legacyId)
  })
);

export const tournamentPlayers = pgTable(
  "tournament_players",
  {
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    seed: integer("seed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tournamentId, table.playerId] }),
    playerIdx: index("tournament_players_player_id_idx").on(table.playerId)
  })
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: roundStatusEnum("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    tournamentRoundUnique: uniqueIndex("rounds_tournament_number_unique").on(table.tournamentId, table.number)
  })
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").references(() => rounds.id, { onDelete: "set null" }),
    whitePlayerId: uuid("white_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    blackPlayerId: uuid("black_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "restrict" }),
    result: doublePrecision("result"),
    playedOn: date("played_on").notNull(),
    boardNumber: integer("board_number"),
    status: matchStatusEnum("status").notNull().default("scheduled"),
    legacyId: integer("legacy_id"),
    whiteEloBefore: doublePrecision("white_elo_before"),
    whiteEloAfter: doublePrecision("white_elo_after"),
    blackEloBefore: doublePrecision("black_elo_before"),
    blackEloAfter: doublePrecision("black_elo_after"),
    whiteGlickoRatingBefore: doublePrecision("white_glicko_rating_before"),
    whiteGlickoRatingAfter: doublePrecision("white_glicko_rating_after"),
    whiteGlickoRdBefore: doublePrecision("white_glicko_rd_before"),
    whiteGlickoRdAfter: doublePrecision("white_glicko_rd_after"),
    whiteGlickoVolBefore: doublePrecision("white_glicko_vol_before"),
    whiteGlickoVolAfter: doublePrecision("white_glicko_vol_after"),
    blackGlickoRatingBefore: doublePrecision("black_glicko_rating_before"),
    blackGlickoRatingAfter: doublePrecision("black_glicko_rating_after"),
    blackGlickoRdBefore: doublePrecision("black_glicko_rd_before"),
    blackGlickoRdAfter: doublePrecision("black_glicko_rd_after"),
    blackGlickoVolBefore: doublePrecision("black_glicko_vol_before"),
    blackGlickoVolAfter: doublePrecision("black_glicko_vol_after"),
    whiteLastPlayedBefore: date("white_last_played_before"),
    blackLastPlayedBefore: date("black_last_played_before"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    clubLegacyUnique: uniqueIndex("matches_club_legacy_id_unique").on(table.clubId, table.legacyId),
    tournamentIdx: index("matches_tournament_id_idx").on(table.tournamentId),
    roundIdx: index("matches_round_id_idx").on(table.roundId),
    whitePlayerIdx: index("matches_white_player_id_idx").on(table.whitePlayerId),
    blackPlayerIdx: index("matches_black_player_id_idx").on(table.blackPlayerId)
  })
);

export const schema = {
  users,
  authIdentities,
  sessions,
  clubs,
  clubMemberships,
  clubInvites,
  players,
  playerRatings,
  tournaments,
  tournamentPlayers,
  rounds,
  matches
};
