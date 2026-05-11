import { Pool } from "pg";

export interface Player {
  id: string;
  displayName: string;
  elo: number;
  points: number;
  buchholz: number;
  sonnebornBerger: number;
  whiteCount: number;
  blackCount: number;
  droppedOutRound: number | null;
  opponents: Set<string>;
}

export interface Match {
  whitePlayerId: string;
  blackPlayerId: string;
  boardNumber: number;
}

export interface SwissPairingOptions {
  pairingMethod: "seeded_by_rating" | "random";
  roundNumber: number;
}

/**
 * Generate Swiss pairings for a round
 */
export async function generateSwissPairings(
  pool: Pool,
  tournamentId: string,
  roundNumber: number,
  options: SwissPairingOptions
): Promise<Match[]> {
  // Get all tournament players with their stats
  const playersResult = await pool.query(
    `
      SELECT
        tp.player_id AS "playerId",
        p.display_name AS "displayName",
        pr.elo,
        COALESCE(SUM(CASE WHEN m.result = 1 THEN 1 WHEN m.result = 0.5 THEN 0.5 WHEN m.result = 0 THEN 0 END), 0) AS points,
        tp.white_count AS "whiteCount",
        tp.black_count AS "blackCount",
        tp.dropped_out_round AS "droppedOutRound"
      FROM tournament_players tp
      JOIN players p ON p.id = tp.player_id
      JOIN player_ratings pr ON pr.player_id = tp.player_id
      LEFT JOIN matches m ON (m.white_player_id = tp.player_id OR m.black_player_id = tp.player_id)
        AND m.tournament_id = $1
        AND m.status = 'completed'
      WHERE tp.tournament_id = $1
        AND (tp.dropped_out_round IS NULL OR tp.dropped_out_round >= $2)
      GROUP BY tp.player_id, p.display_name, pr.elo, tp.white_count, tp.black_count, tp.dropped_out_round
    `,
    [tournamentId, roundNumber]
  );

  const players: Player[] = playersResult.rows.map((row) => ({
    id: row.playerId,
    displayName: row.displayName,
    elo: row.elo,
    points: parseFloat(row.points) || 0,
    buchholz: 0,
    sonnebornBerger: 0,
    whiteCount: row.whiteCount || 0,
    blackCount: row.blackCount || 0,
    droppedOutRound: row.droppedOutRound,
    opponents: new Set<string>(),
  }));

  // Calculate tiebreakers (Buchholz, Sonneborn-Berger)
  for (const player of players) {
    const opponentsResult = await pool.query(
      `
        SELECT
          CASE WHEN m.white_player_id = $1 THEN m.black_player_id ELSE m.white_player_id END AS "opponentId",
          m.result,
          (SELECT COALESCE(SUM(CASE WHEN m2.result = 1 THEN 1 WHEN m2.result = 0.5 THEN 0.5 WHEN m2.result = 0 THEN 0 END), 0)
           FROM matches m2
           WHERE (m2.white_player_id = CASE WHEN m.white_player_id = $1 THEN m.black_player_id ELSE m.white_player_id END
                  OR m2.black_player_id = CASE WHEN m.white_player_id = $1 THEN m.black_player_id ELSE m.white_player_id END)
             AND m2.tournament_id = $2
             AND m2.status = 'completed') AS "opponentPoints"
        FROM matches m
        WHERE (m.white_player_id = $1 OR m.black_player_id = $1)
          AND m.tournament_id = $2
          AND m.status = 'completed'
      `,
      [player.id, tournamentId]
    );

    let buchholz = 0;
    let sonnebornBerger = 0;

    for (const row of opponentsResult.rows) {
      player.opponents.add(row.opponentId);
      buchholz += parseFloat(row.opponentPoints) || 0;

      if (row.result === 1) {
        sonnebornBerger += parseFloat(row.opponentPoints) || 0;
      } else if (row.result === 0.5) {
        sonnebornBerger += (parseFloat(row.opponentPoints) || 0) / 2;
      }
    }

    player.buchholz = buchholz;
    player.sonnebornBerger = sonnebornBerger;
  }

  // Generate pairings based on round number
  if (roundNumber === 1) {
    return generateFirstRoundPairings(players, options);
  } else {
    return generateSubsequentRoundPairings(players, roundNumber, pool, tournamentId);
  }
}

/**
 * Generate pairings for round 1
 */
function generateFirstRoundPairings(
  players: Player[],
  options: SwissPairingOptions
): Match[] {
  const matches: Match[] = [];

  if (options.pairingMethod === "seeded_by_rating") {
    // Sort by ELO descending
    const sortedPlayers = [...players].sort((a, b) => b.elo - a.elo);
    
    // Pair highest vs lowest, second highest vs second lowest, etc.
    for (let i = 0; i < sortedPlayers.length / 2; i++) {
      const whitePlayer = sortedPlayers[i];
      const blackPlayer = sortedPlayers[sortedPlayers.length - 1 - i];
      
      matches.push({
        whitePlayerId: whitePlayer.id,
        blackPlayerId: blackPlayer.id,
        boardNumber: i + 1,
      });
    }
  } else {
    // Random pairings
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    
    for (let i = 0; i < shuffled.length / 2; i++) {
      matches.push({
        whitePlayerId: shuffled[i * 2].id,
        blackPlayerId: shuffled[i * 2 + 1].id,
        boardNumber: i + 1,
      });
    }
  }

  return matches;
}

/**
 * Generate pairings for subsequent rounds
 */
async function generateSubsequentRoundPairings(
  players: Player[],
  roundNumber: number,
  pool: Pool,
  tournamentId: string
): Promise<Match[]> {
  const matches: Match[] = [];

  // Sort players by points, then Buchholz, then Sonneborn-Berger, then ELO
  const sortedPlayers = [...players].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
    if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
    return b.elo - a.elo;
  });

  // Group players by points
  const pointGroups: Map<number, Player[]> = new Map();
  for (const player of sortedPlayers) {
    const group = pointGroups.get(player.points) || [];
    group.push(player);
    pointGroups.set(player.points, group);
  }

  let boardNumber = 1;
  const pairedPlayers = new Set<string>();

  // Process each point group
  for (const [points, groupPlayers] of pointGroups.entries()) {
    // Sort within group by standings
    groupPlayers.sort((a, b) => {
      if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
      return b.elo - a.elo;
    });

    // Pair players within the group
    for (let i = 0; i < groupPlayers.length; i += 2) {
      if (i + 1 >= groupPlayers.length) break;

      const player1 = groupPlayers[i];
      const player2 = groupPlayers[i + 1];

      if (pairedPlayers.has(player1.id) || pairedPlayers.has(player2.id)) {
        continue;
      }

      // Check if they've played before
      const hasPlayedBefore = await havePlayersPlayedTogether(pool, player1.id, player2.id, tournamentId);
      if (hasPlayedBefore) {
        // Try to find alternative pairing
        continue;
      }

      // Determine who plays white based on color balance
      const player1ColorBalance = player1.whiteCount - player1.blackCount;
      const player2ColorBalance = player2.whiteCount - player2.blackCount;

      let whitePlayerId: string;
      let blackPlayerId: string;

      if (player1ColorBalance > player2ColorBalance) {
        // Player1 has more whites, should play black
        whitePlayerId = player2.id;
        blackPlayerId = player1.id;
      } else if (player2ColorBalance > player1ColorBalance) {
        // Player2 has more whites, should play black
        whitePlayerId = player1.id;
        blackPlayerId = player2.id;
      } else {
        // Equal balance, alternate from last game
        whitePlayerId = player1.id;
        blackPlayerId = player2.id;
      }

      matches.push({
        whitePlayerId,
        blackPlayerId,
        boardNumber: boardNumber++,
      });

      pairedPlayers.add(player1.id);
      pairedPlayers.add(player2.id);
    }
  }

  // Handle unpaired players by cross-group pairing
  const unpairedPlayers = sortedPlayers.filter((p) => !pairedPlayers.has(p.id));
  for (let i = 0; i < unpairedPlayers.length / 2; i++) {
    const player1 = unpairedPlayers[i];
    const player2 = unpairedPlayers[unpairedPlayers.length - 1 - i];

    if (pairedPlayers.has(player1.id) || pairedPlayers.has(player2.id)) {
      continue;
    }

    const hasPlayedBefore = await havePlayersPlayedTogether(pool, player1.id, player2.id, tournamentId);
    if (hasPlayedBefore) {
      continue;
    }

    const player1ColorBalance = player1.whiteCount - player1.blackCount;
    const player2ColorBalance = player2.whiteCount - player2.blackCount;

    let whitePlayerId: string;
    let blackPlayerId: string;

    if (player1ColorBalance > player2ColorBalance) {
      whitePlayerId = player2.id;
      blackPlayerId = player1.id;
    } else {
      whitePlayerId = player1.id;
      blackPlayerId = player2.id;
    }

    matches.push({
      whitePlayerId,
      blackPlayerId,
      boardNumber: boardNumber++,
    });

    pairedPlayers.add(player1.id);
    pairedPlayers.add(player2.id);
  }

  return matches;
}

/**
 * Check if two players have played together in this tournament
 */
async function havePlayersPlayedTogether(
  pool: Pool,
  player1Id: string,
  player2Id: string,
  tournamentId: string
): Promise<boolean> {
  const result = await pool.query(
    `
      SELECT id FROM matches
      WHERE tournament_id = $1
        AND ((white_player_id = $2 AND black_player_id = $3)
             OR (white_player_id = $3 AND black_player_id = $2))
      LIMIT 1
    `,
    [tournamentId, player1Id, player2Id]
  );

  return result.rows.length > 0;
}
