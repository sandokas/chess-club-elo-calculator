import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { requireAuth, requireClubRole, type ClubRole } from "../lib/auth/rbac.js";

interface ClubParams {
  clubId: string;
}

export async function registerLeaderboardRoutes(app: FastifyInstance) {
  const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "true";

  const conditionalRequireAuth = REQUIRE_AUTH ? requireAuth : async () => {};
  const conditionalRequireClubRole = (roles: ClubRole[]) => REQUIRE_AUTH
    ? ((request: any, reply: any) => requireClubRole(request, reply, roles))
    : async () => {};

  // Leaderboard route
  app.get<{ Params: ClubParams; Querystring: { activeOnly?: string; limit?: string } }>("/clubs/:clubId/leaderboard", { preHandler: [conditionalRequireAuth, conditionalRequireClubRole(["owner", "admin", "organizer", "member"])] }, async (request) => {
    const activeOnly = request.query.activeOnly !== 'false';
    const limit = Math.min(parseInt(request.query.limit || '10', 10), 100);
    const result = await app.db.execute(sql`
      SELECT
        p.id,
        p.display_name AS "displayName",
        p.active,
        pr.elo,
        pr.glicko_rating AS "glickoRating",
        pr.games_played AS "gamesPlayed",
        pr.last_game_date AS "lastGameDate",
        COUNT(m.id)::int AS "completedMatches",
        COUNT(CASE WHEN (m.white_player_id = p.id AND m.result = 1) OR (m.black_player_id = p.id AND m.result = 0) THEN 1 END)::int AS wins,
        COUNT(CASE WHEN m.result = 0.5 THEN 1 END)::int AS draws,
        COUNT(CASE WHEN (m.white_player_id = p.id AND m.result = 0) OR (m.black_player_id = p.id AND m.result = 1) THEN 1 END)::int AS losses
      FROM players p
      JOIN player_ratings pr ON pr.player_id = p.id
      LEFT JOIN matches m
        ON m.club_id = p.club_id
       AND m.result IS NOT NULL
       AND m.black_player_id IS NOT NULL
       AND (m.white_player_id = p.id OR m.black_player_id = p.id)
      WHERE p.club_id = ${request.params.clubId} ${activeOnly ? sql`AND p.active = true` : sql``}
      GROUP BY p.id, pr.player_id
      ORDER BY pr.elo DESC, p.display_name ASC
      LIMIT ${limit}
    `);
    return { leaderboard: result.rows };
  });
}
