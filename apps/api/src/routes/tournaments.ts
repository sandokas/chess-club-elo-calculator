import type { FastifyInstance } from "fastify";
import { eq, and, sql, asc, desc, isNull, count } from "drizzle-orm";
import { tournaments, tournamentPlayers, matches } from "@chess-club/db";
import { createTournamentSchema, listTournamentsQuerySchema, updateTournamentSchema, type ListTournamentsQuery } from "../lib/schemas/tournament.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { parsePaginationParams, parseSortParams, parseStringFilter, escapeLikePattern, validateTournamentStatus } from "../lib/validators.js";
import { createNotFoundError, createValidationError } from "../lib/errors.js";
import { listTournaments, getTournamentById, getTournamentStandings } from "../services/tournaments.js";

type ClubParams = {
  clubId: string;
};

type TournamentParams = {
  id: string;
};

export async function registerTournamentRoutes(app: FastifyInstance) {
  // List tournaments for a club
  app.get<{ Params: ClubParams; Querystring: ListTournamentsQuery }>("/clubs/:clubId/tournaments", { preHandler: [app.auth.requireClubRole("member")] }, async (request, reply) => {
    const { clubId } = request.params;
    const query = parseQuery(listTournamentsQuerySchema, request.query);
    const { page, limit } = parsePaginationParams(query);
    const allowedSortColumns = ['name', 'startsOn', 'status', 'playerCount', 'matchCount'];
    const { sortBy, sortOrder } = parseSortParams(
      { ...query, sortBy: query.sortBy || "startsOn" },
      allowedSortColumns
    );

    const filters = [];
    const tname = parseStringFilter(query.name);
    if (tname) {
      filters.push(
        sql`${tournaments.name} LIKE ${`%${escapeLikePattern(tname)}%`} ESCAPE '\\'`
      );
    }
    const status = validateTournamentStatus(query.status);
    if (status) {
      filters.push(eq(tournaments.status, status as 'draft' | 'active' | 'completed'));
    }

    const result = await listTournaments(app.db, clubId, page, limit, sortBy, sortOrder, filters);
    return reply.send(result);
  });

  // Create tournament
  app.post<{ Params: ClubParams; Body: { name: string; startsOn?: string; format?: string; totalRounds?: number; pairingMethod?: string } }>("/clubs/:clubId/tournaments", { preHandler: [app.auth.requireClubRole("organizer")] }, async (request, reply) => {
    const body = parseBody(createTournamentSchema, request.body);
    const { name, startsOn, format, totalRounds, pairingMethod } = body;
    const { clubId } = request.params;

    // Validate: only one tournament can be ongoing at a time
    const ongoingTournamentResult = await app.db.select({ id: tournaments.id }).from(tournaments)
      .where(and(
        eq(tournaments.clubId, clubId),
        sql`${tournaments.status} IN ('draft', 'active')`
      ))
      .limit(1);
    if (ongoingTournamentResult.length > 0) {
      throw createValidationError("Cannot create tournament: there is already an ongoing tournament in this club");
    }

    const result = await app.db.execute(sql`
      INSERT INTO tournaments (club_id, name, starts_on, format, total_rounds, pairing_method, status)
      VALUES (${clubId}, ${name.trim()}, ${startsOn ? new Date(startsOn) : null}, ${format || "manual"}, ${totalRounds || null}, ${pairingMethod || "seeded_by_rating"}, 'draft')
      RETURNING id, name, starts_on AS "startsOn", format, status, total_rounds AS "totalRounds", pairing_method AS "pairingMethod", legacy_id AS "legacyId", created_at AS "createdAt", club_id AS "clubId"
    `);

    return reply.status(201).send({ tournament: result.rows[0] });
  });

  // Get tournament detail
  app.get<{ Params: TournamentParams }>("/tournaments/:id", { preHandler: [app.auth.requireTournamentClubRole("member")] }, async (request, reply) => {
    const result = await getTournamentById(app.db, request.params.id);
    if (!result) {
      throw createNotFoundError("Tournament not found");
    }
    return reply.send(result);
  });

  // Update tournament
  app.put<{ Params: TournamentParams; Body: { name?: string; startsOn?: string; status?: string; totalRounds?: number | null; pairingMethod?: string } }>("/tournaments/:id", { preHandler: [app.auth.requireTournamentClubRole("organizer")] }, async (request, reply) => {
    const body = parseBody(updateTournamentSchema, request.body);
    const { name, startsOn, status, totalRounds, pairingMethod } = body;
    const { id } = request.params;

    const currentResult = await app.db.select({ id: tournaments.id, status: tournaments.status, name: tournaments.name, startsOn: tournaments.startsOn }).from(tournaments).where(eq(tournaments.id, id)).limit(1);

    const [current] = currentResult;
    if (!current) {
      throw createNotFoundError("Tournament not found");
    }

    if (current.status === "completed" && (name !== undefined || startsOn !== undefined)) {
      throw createValidationError("Cannot edit name or startsOn when tournament is completed. Revert status to active first.");
    }

    // Prevent completing tournament if matches have no results
    if (status === "completed") {
      const incompleteMatchesResult = await app.db.select({ count: sql`COUNT(*)`.mapWith(Number) }).from(matches).where(and(eq(matches.tournamentId, id), isNull(matches.result)));
      
      const incompleteCount = incompleteMatchesResult[0]?.count || 0;
      if (incompleteCount > 0) {
        throw createValidationError(`Cannot complete tournament: ${incompleteCount} match(es) do not have results set`);
      }
    }

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (startsOn !== undefined) updateData.startsOn = new Date(startsOn);
    if (status !== undefined) updateData.status = status as "draft" | "active" | "completed";
    if (totalRounds !== undefined) updateData.totalRounds = totalRounds;
    if (pairingMethod !== undefined) updateData.pairingMethod = pairingMethod as "seeded_by_rating" | "random";

    if (Object.keys(updateData).length === 0) {
      throw createValidationError("No fields to update");
    }

    // Map camelCase field names to snake_case column names
    const columnMap: Record<string, string> = {
      name: "name",
      startsOn: "starts_on",
      format: "format",
      status: "status",
      totalRounds: "total_rounds",
      pairingMethod: "pairing_method"
    };

    // Build dynamic SET clause with proper column names
    const setClauses = Object.entries(updateData).map(([k, v]) => {
      const columnName = columnMap[k] || k;
      return sql`${sql.identifier(columnName)} = ${v}`;
    });
    const result = await app.db.execute(sql`
      UPDATE tournaments
      SET ${sql.join([...setClauses, sql`updated_at = NOW()`], sql`, `)}
      WHERE id = ${id}
      RETURNING id, name, starts_on AS "startsOn", format, status, total_rounds AS "totalRounds", pairing_method AS "pairingMethod", legacy_id AS "legacyId", created_at AS "createdAt", club_id AS "clubId"
    `);

    return reply.status(200).send({ tournament: result.rows[0] });
  });

  // Delete tournament
  app.delete<{ Params: TournamentParams }>("/tournaments/:id", { preHandler: [app.auth.requireTournamentClubRole("organizer")] }, async (request, reply) => {
    const { id } = request.params;
    const currentResult = await app.db.select({ id: tournaments.id, status: tournaments.status }).from(tournaments).where(eq(tournaments.id, id)).limit(1);

    if (currentResult.length === 0) {
      throw createNotFoundError("Tournament not found");
    }

    if (!currentResult[0] || currentResult[0].status !== "draft") {
      throw createValidationError("Can only delete tournaments in draft status");
    }

    await app.db.delete(tournaments).where(eq(tournaments.id, id));

    return reply.status(200).send({ message: "Tournament deleted successfully" });
  });

  // Get tournament standings
  app.get<{ Params: TournamentParams }>("/tournaments/:id/standings", { preHandler: [app.auth.requireTournamentClubRole("member")] }, async (request, reply) => {
    const result = await getTournamentStandings(app.db, request.params.id);
    return reply.send(result);
  });
}
